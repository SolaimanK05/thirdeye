import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, cast

import httpx
import pytest

from thirdeye import store, worker
from thirdeye.db import Pool
from thirdeye.registry import REGISTRY, Fetch, Module


class FakePool:
    @asynccontextmanager
    async def connection(self) -> AsyncIterator[object]:
        yield object()


POOL = cast(Pool, FakePool())


class Recorder:
    def __init__(self) -> None:
        self.writes: list[tuple[str, int]] = []
        self.failures: list[tuple[str, str]] = []

    async def write_events(
        self, conn: object, module_id: str, events: list[Any], fetched_at: datetime
    ) -> None:
        self.writes.append((module_id, len(events)))

    async def record_failure(
        self, conn: object, module_id: str, reason: str, failed_at: datetime
    ) -> None:
        self.failures.append((module_id, reason))


@pytest.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient() as c:
        yield c


@pytest.fixture
def recorder(monkeypatch: pytest.MonkeyPatch) -> Recorder:
    rec = Recorder()
    monkeypatch.setattr(store, "write_events", rec.write_events)
    monkeypatch.setattr(store, "record_failure", rec.record_failure)
    return rec


def module_with(fetch: Fetch, module_id: str = "earthquakes") -> Module:
    base = REGISTRY["earthquakes"]
    manifest = base.manifest.model_copy(update={"id": module_id})
    return Module(manifest, fetch, lambda raw, at: [])


async def ok_fetch(client: httpx.AsyncClient) -> bytes:
    return b"{}"


async def failing_fetch(client: httpx.AsyncClient) -> bytes:
    raise httpx.ConnectError("network is down")


async def no_sleep(seconds: float) -> None:
    await asyncio.sleep(0)


def test_backoff_doubles_and_caps() -> None:
    assert [worker.backoff_delay(n) for n in (1, 2, 3, 4)] == [30, 60, 120, 240]
    assert worker.backoff_delay(50) == worker.BACKOFF_CAP_SECONDS
    assert worker.backoff_delay(5000) == worker.BACKOFF_CAP_SECONDS


async def test_tick_writes_on_success(
    recorder: Recorder, client: httpx.AsyncClient
) -> None:
    ok = await worker.tick(module_with(ok_fetch), POOL, client)
    assert ok is True
    assert recorder.writes == [("earthquakes", 0)]


async def test_tick_records_failure_with_reason(
    recorder: Recorder, client: httpx.AsyncClient
) -> None:
    ok = await worker.tick(module_with(failing_fetch), POOL, client)
    assert ok is False
    assert recorder.failures == [("earthquakes", "ConnectError: network is down")]


async def test_failing_module_does_not_stop_others(
    recorder: Recorder, client: httpx.AsyncClient
) -> None:
    good = module_with(ok_fetch, "good")
    bad = module_with(failing_fetch, "bad")
    with pytest.raises(TimeoutError):
        async with asyncio.timeout(0.2), asyncio.TaskGroup() as tasks:
            tasks.create_task(worker.run_forever(good, POOL, client, no_sleep))
            tasks.create_task(worker.run_forever(bad, POOL, client, no_sleep))
    assert sum(1 for m, _ in recorder.writes if m == "good") > 3
    assert sum(1 for m, _ in recorder.failures if m == "bad") > 3


async def test_failures_back_off(recorder: Recorder, client: httpx.AsyncClient) -> None:
    delays: list[float] = []

    async def capture(seconds: float) -> None:
        delays.append(seconds)
        if len(delays) == 3:
            raise asyncio.CancelledError

    with pytest.raises(asyncio.CancelledError):
        await worker.run_forever(module_with(failing_fetch), POOL, client, capture)
    assert delays == [30, 60, 120]
