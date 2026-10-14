import asyncio
import os
from collections.abc import AsyncIterator
from dataclasses import dataclass
from types import TracebackType
from typing import Any, Self

import psycopg
import pytest
from conftest import NOW

from thirdeye.layers import (
    LayerCache,
    build_layer,
    listen_for_layers,
    reconnect_delay,
)
from thirdeye.reads import SnapshotRecord

ROW: dict[str, Any] = {
    "id": "earthquakes:1",
    "category": "earthquake",
    "lon": 90.0,
    "lat": 23.0,
    "t_start": "2026-10-14T05:00:00+00:00",
    "t_end": None,
    "severity": 4.1,
    "confidence": "observed",
    "attrs": {},
}


def snapshot(*rows: dict[str, Any]) -> SnapshotRecord:
    return SnapshotRecord(payload=list(rows), fetched_at=NOW)


class TestBuildLayer:
    def test_same_content_same_etag(self) -> None:
        a = build_layer("earthquakes", snapshot(ROW))
        b = build_layer("earthquakes", snapshot(ROW))
        assert a.etag == b.etag
        assert a.last_modified == NOW

    def test_new_content_new_etag(self) -> None:
        a = build_layer("earthquakes", snapshot(ROW))
        b = build_layer("earthquakes", snapshot({**ROW, "severity": 4.2}))
        assert a.etag != b.etag

    def test_bad_rows_are_rejected(self) -> None:
        with pytest.raises(ValueError, match="lat"):
            build_layer("earthquakes", snapshot({**ROW, "lat": None}))


class TestLayerCache:
    async def test_concurrent_requests_load_once(self) -> None:
        calls = 0

        async def load(module_id: str) -> SnapshotRecord:
            nonlocal calls
            calls += 1
            await asyncio.sleep(0.01)
            return snapshot(ROW)

        cache = LayerCache(load)
        results = await asyncio.gather(*(cache.get("earthquakes") for _ in range(10)))
        assert calls == 1
        assert len({r.etag for r in results}) == 1

    async def test_invalidate_reloads(self) -> None:
        severities = iter([4.0, 5.0])

        async def load(module_id: str) -> SnapshotRecord:
            return snapshot({**ROW, "severity": next(severities)})

        cache = LayerCache(load)
        first = await cache.get("earthquakes")
        cache.invalidate("earthquakes")
        second = await cache.get("earthquakes")
        assert first.etag != second.etag

    async def test_update_during_a_load_is_not_lost(self) -> None:
        started = asyncio.Event()
        release = asyncio.Event()
        loads = 0

        async def load(module_id: str) -> SnapshotRecord:
            nonlocal loads
            loads += 1
            if loads == 1:
                started.set()
                await release.wait()
            return snapshot(ROW)

        cache = LayerCache(load)
        pending = asyncio.create_task(cache.get("earthquakes"))
        await started.wait()
        cache.invalidate("earthquakes")
        release.set()
        await pending
        await cache.get("earthquakes")
        assert loads == 2

    async def test_invalidate_all(self) -> None:
        loads: list[str] = []

        async def load(module_id: str) -> SnapshotRecord:
            loads.append(module_id)
            return snapshot(ROW)

        cache = LayerCache(load)
        await cache.get("a")
        await cache.get("b")
        cache.invalidate()
        await cache.get("a")
        await cache.get("b")
        assert loads == ["a", "b", "a", "b"]


def test_reconnect_delay_doubles_and_caps() -> None:
    assert [reconnect_delay(n) for n in (1, 2, 3, 6, 100)] == [1, 2, 4, 30, 30]


@dataclass
class FakeNotify:
    channel: str
    payload: str
    pid: int = 1


class FakeListenConnection:
    def __init__(self, payloads: list[str]) -> None:
        self.payloads = payloads
        self.executed: list[str] = []

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        return None

    async def execute(self, query: str) -> None:
        self.executed.append(query)

    async def notifies(self) -> AsyncIterator[FakeNotify]:
        for payload in self.payloads:
            yield FakeNotify("layer_updated", payload)
        raise psycopg.OperationalError("server closed the connection")


async def test_listener_reconnects_and_invalidates() -> None:
    invalidated: list[str | None] = []

    class SpyCache(LayerCache):
        def invalidate(self, module_id: str | None = None) -> None:
            invalidated.append(module_id)

    async def never(module_id: str) -> None:
        return None

    attempts = 0
    connection = FakeListenConnection(["earthquakes"])

    async def connect() -> Any:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise psycopg.OperationalError("connection refused")
        if attempts == 2:
            return connection
        raise asyncio.CancelledError

    sleeps: list[float] = []

    async def sleep(seconds: float) -> None:
        sleeps.append(seconds)

    with pytest.raises(asyncio.CancelledError):
        await listen_for_layers(connect, SpyCache(never), sleep)

    assert connection.executed == ["listen layer_updated"]
    assert sleeps == [1.0, 1.0]
    assert invalidated == [None, None, "earthquakes", None]


TEST_DB = os.environ.get("THIRDEYE_TEST_DATABASE_URL")


@pytest.mark.skipif(not TEST_DB, reason="set THIRDEYE_TEST_DATABASE_URL")
async def test_real_notify_invalidates_the_cache() -> None:
    assert TEST_DB
    seen = asyncio.Event()

    class WatchCache(LayerCache):
        def invalidate(self, module_id: str | None = None) -> None:
            super().invalidate(module_id)
            if module_id == "listentest":
                seen.set()

    async def load(module_id: str) -> None:
        return None

    async def connect() -> Any:
        return await psycopg.AsyncConnection.connect(TEST_DB, autocommit=True)

    listener = asyncio.create_task(listen_for_layers(connect, WatchCache(load)))
    try:
        async with await psycopg.AsyncConnection.connect(
            TEST_DB, autocommit=True
        ) as conn:
            for _ in range(50):
                await conn.execute("select pg_notify('layer_updated', 'listentest')")
                try:
                    await asyncio.wait_for(seen.wait(), timeout=0.1)
                    break
                except TimeoutError:
                    continue
        assert seen.is_set()
    finally:
        listener.cancel()
        with pytest.raises(asyncio.CancelledError):
            await listener
