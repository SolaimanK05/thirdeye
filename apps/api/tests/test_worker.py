import asyncio
from collections.abc import AsyncIterator

import httpx
import pytest
from conftest import POOL, Recorder

from thirdeye import worker
from thirdeye.config import Settings
from thirdeye.modules.wildfires import records as wildfire_records
from thirdeye.registry import REGISTRY, Fetch, Module

SETTINGS = Settings(database_url="postgresql://t:t@127.0.0.1:1/t", _env_file=None)


@pytest.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient() as c:
        yield c


def module_with(fetch: Fetch, module_id: str = "earthquakes") -> Module:
    base = REGISTRY["earthquakes"]
    manifest = base.manifest.model_copy(update={"id": module_id})
    return Module(manifest, fetch, lambda raw, at: [])


async def ok_fetch(client: httpx.AsyncClient, settings: Settings) -> bytes:
    return b"{}"


async def failing_fetch(client: httpx.AsyncClient, settings: Settings) -> bytes:
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
    ok = await worker.tick(module_with(ok_fetch), POOL, client, SETTINGS)
    assert ok is True
    assert recorder.writes == [("earthquakes", 0)]


async def test_tick_records_failure_with_reason(
    recorder: Recorder, client: httpx.AsyncClient
) -> None:
    ok = await worker.tick(module_with(failing_fetch), POOL, client, SETTINGS)
    assert ok is False
    assert recorder.failures == [("earthquakes", "ConnectError: network is down")]


async def test_failing_module_does_not_stop_others(
    recorder: Recorder, client: httpx.AsyncClient
) -> None:
    good = module_with(ok_fetch, "good")
    bad = module_with(failing_fetch, "bad")
    with pytest.raises(TimeoutError):
        async with asyncio.timeout(0.2), asyncio.TaskGroup() as tasks:
            tasks.create_task(
                worker.run_forever(good, POOL, client, SETTINGS, no_sleep)
            )
            tasks.create_task(worker.run_forever(bad, POOL, client, SETTINGS, no_sleep))
    assert sum(1 for m, _ in recorder.writes if m == "good") > 3
    assert sum(1 for m, _ in recorder.failures if m == "bad") > 3


async def test_failures_back_off(recorder: Recorder, client: httpx.AsyncClient) -> None:
    delays: list[float] = []

    async def capture(seconds: float) -> None:
        delays.append(seconds)
        if len(delays) == 3:
            raise asyncio.CancelledError

    with pytest.raises(asyncio.CancelledError):
        await worker.run_forever(
            module_with(failing_fetch), POOL, client, SETTINGS, capture
        )
    assert delays == [30, 60, 120]


async def test_modules_with_retention_are_pruned_after_each_write(
    recorder: Recorder, client: httpx.AsyncClient
) -> None:
    keeping = module_with(ok_fetch)
    manifest = keeping.manifest.model_copy(update={"retention_seconds": 86_400})
    await worker.tick(
        Module(manifest, ok_fetch, keeping.normalize), POOL, client, SETTINGS
    )
    assert recorder.prunes == [("earthquakes", 86_400)]


async def test_modules_without_retention_are_never_pruned(
    recorder: Recorder, client: httpx.AsyncClient
) -> None:
    await worker.tick(module_with(ok_fetch), POOL, client, SETTINGS)
    assert recorder.prunes == []


async def test_a_module_can_filter_what_it_stores(
    recorder: Recorder, client: httpx.AsyncClient
) -> None:
    body = (
        b"latitude,longitude,acq_date,acq_time,confidence\n"
        b"1,1,2026-10-14,0100,h\n2,2,2026-10-14,0100,l\n"
    )
    module = Module(
        module_with(ok_fetch).manifest,
        ok_fetch,
        lambda raw, at: wildfire_records.normalize(body, at),
        wildfire_records.accept,
    )
    await worker.tick(module, POOL, client, SETTINGS)
    assert recorder.writes == [("earthquakes", 1)]
