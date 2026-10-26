import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
from conftest import POOL, Recorder
from pydantic import SecretStr
from test_governor import FakeClock

from thirdeye import worker
from thirdeye.config import Settings
from thirdeye.governor import Fetched, Governor, RateLimited
from thirdeye.modules.ports import records as ports_records
from thirdeye.modules.wildfires import records as wildfire_records
from thirdeye.ontology import EntityReport
from thirdeye.registry import REGISTRY, Fetch, Module

PORTS_FIXTURE = Path(__file__).parents[1] / "src/thirdeye/modules/ports/fixture.csv"
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


def one_port(raw: bytes, at: datetime) -> list[EntityReport]:
    return ports_records.normalize_entities(PORTS_FIXTURE.read_bytes(), at)[:1]


def entity_module(**changes: object) -> Module:
    base = REGISTRY["ports"].manifest
    manifest = base.model_copy(update={"cadence_seconds": 600, **changes})
    return Module(manifest, ok_fetch, normalize_entities=one_port)


async def test_entity_modules_are_written_through_write_entities(
    recorder: Recorder, client: httpx.AsyncClient
) -> None:
    assert await worker.tick(entity_module(), POOL, client, SETTINGS) is True
    assert recorder.writes == []
    assert recorder.entity_writes == [
        {
            "module_id": "ports",
            "source_id": "nga-wpi",
            "count": 1,
            "latest_only": True,
            "window": None,
        }
    ]
    assert recorder.observation_prunes == []


async def test_movers_keep_history_and_prune_it(
    recorder: Recorder, client: httpx.AsyncClient
) -> None:
    module = entity_module(
        observation_retention_seconds=3600, snapshot_window_seconds=900
    )
    await worker.tick(module, POOL, client, SETTINGS)
    [write] = recorder.entity_writes
    assert write["latest_only"] is False
    assert write["window"] == 900
    assert recorder.observation_prunes == [("nga-wpi", 3600)]


async def test_a_module_with_nothing_to_fetch_cannot_be_ticked(
    recorder: Recorder, client: httpx.AsyncClient
) -> None:
    manifest = REGISTRY["ports"].manifest.model_copy(update={"cadence_seconds": 0})
    module = Module(manifest, None, normalize_entities=one_port)
    assert await worker.tick(module, POOL, client, SETTINGS) is False
    assert recorder.entity_writes == []
    assert recorder.failures[0][0] == "ports"


async def test_a_download_with_no_usable_records_is_a_failure_not_an_update(
    recorder: Recorder, client: httpx.AsyncClient
) -> None:
    base = REGISTRY["ports"]
    module = Module(base.manifest, ok_fetch, normalize_entities=lambda raw, at: [])
    assert await worker.tick(module, POOL, client, SETTINGS) is False
    assert recorder.entity_writes == []
    assert "no usable records" in recorder.failures[0][1]


def governed_module(fetch: Fetch) -> Module:
    manifest = REGISTRY["aircraft"].manifest
    return Module(
        manifest,
        fetch,
        normalize_entities=one_port,
        governor=REGISTRY["aircraft"].governor,
    )


def governor_on(clock: FakeClock) -> Governor:
    spec = REGISTRY["aircraft"].governor
    assert spec is not None
    return spec.build(SETTINGS, clock)


async def metered_fetch(client: httpx.AsyncClient, settings: Settings) -> Fetched:
    return Fetched(b"x", remaining=2000)


def rate_limited_fetch(retry_after: float | None) -> Fetch:
    async def fetch(client: httpx.AsyncClient, settings: Settings) -> Fetched:
        raise RateLimited(retry_after)

    return fetch


async def test_a_governed_success_spends_a_call_and_syncs_the_remaining_credits(
    recorder: Recorder, client: httpx.AsyncClient
) -> None:
    gov = governor_on(FakeClock())
    ok = await worker.tick(governed_module(metered_fetch), POOL, client, SETTINGS, gov)
    assert ok is True
    assert gov.credits_left == 1800
    [(module_id, meta)] = recorder.metas
    assert module_id == "aircraft"
    assert meta["credits_left"] == 1800
    assert meta["cost"] == 4
    assert meta["budget"] == 3800
    assert isinstance(meta["interval_seconds"], int)
    assert recorder.cooldowns == []


async def test_a_plain_bytes_fetch_still_spends_a_call(
    recorder: Recorder, client: httpx.AsyncClient
) -> None:
    gov = governor_on(FakeClock())
    await worker.tick(governed_module(ok_fetch), POOL, client, SETTINGS, gov)
    assert gov.credits_left == 3796


async def test_a_rate_limit_starts_a_cooldown_and_is_not_a_failure(
    recorder: Recorder, client: httpx.AsyncClient
) -> None:
    clock = FakeClock()
    gov = governor_on(clock)
    module = governed_module(rate_limited_fetch(600))
    assert await worker.tick(module, POOL, client, SETTINGS, gov) is False
    assert recorder.failures == []
    assert recorder.entity_writes == []
    [(module_id, until, reason)] = recorder.cooldowns
    assert module_id == "aircraft"
    assert until == clock() + timedelta(seconds=600)
    assert reason == "cooldown until 06:10Z"
    assert gov.cooldown_until == until


async def test_a_rate_limit_spends_nothing(
    recorder: Recorder, client: httpx.AsyncClient
) -> None:
    gov = governor_on(FakeClock())
    await worker.tick(
        governed_module(rate_limited_fetch(60)), POOL, client, SETTINGS, gov
    )
    assert gov.credits_left == 3800


async def test_a_rate_limit_on_an_ungoverned_module_is_an_ordinary_failure(
    recorder: Recorder, client: httpx.AsyncClient
) -> None:
    module = module_with(rate_limited_fetch(60))
    assert await worker.tick(module, POOL, client, SETTINGS) is False
    assert recorder.cooldowns == []
    assert recorder.failures[0][0] == "earthquakes"


async def test_a_governed_module_sleeps_for_the_governor_interval(
    recorder: Recorder, client: httpx.AsyncClient
) -> None:
    clock = FakeClock(datetime(2026, 10, 26, 0, 0, tzinfo=UTC))
    gov = governor_on(clock)
    delays: list[float] = []

    async def capture(seconds: float) -> None:
        delays.append(seconds)
        if len(delays) == 2:
            raise asyncio.CancelledError

    with pytest.raises(asyncio.CancelledError):
        await worker.run_forever(
            governed_module(ok_fetch), POOL, client, SETTINGS, capture, gov
        )
    assert delays[0] == pytest.approx(86_400 / 950, rel=0.01)
    assert delays[1] == pytest.approx(86_400 / 949, rel=0.01)
    assert delays[0] > REGISTRY["aircraft"].manifest.cadence_seconds


async def test_a_cooldown_stretches_the_next_sleep_without_a_failure_backoff(
    recorder: Recorder, client: httpx.AsyncClient
) -> None:
    clock = FakeClock()
    gov = governor_on(clock)
    delays: list[float] = []

    async def capture(seconds: float) -> None:
        delays.append(seconds)
        raise asyncio.CancelledError

    with pytest.raises(asyncio.CancelledError):
        await worker.run_forever(
            governed_module(rate_limited_fetch(900)),
            POOL,
            client,
            SETTINGS,
            capture,
            gov,
        )
    assert delays[0] >= 900
    assert recorder.failures == []


async def test_a_governed_failure_waits_at_least_the_failure_backoff(
    recorder: Recorder, client: httpx.AsyncClient
) -> None:
    clock = FakeClock(datetime(2026, 10, 26, 0, 0, tzinfo=UTC))
    gov = governor_on(clock)
    delays: list[float] = []

    async def capture(seconds: float) -> None:
        delays.append(seconds)
        if len(delays) == 3:
            raise asyncio.CancelledError

    spec = REGISTRY["aircraft"]
    module = Module(
        spec.manifest,
        failing_fetch,
        normalize_entities=one_port,
        governor=spec.governor,
    )
    with pytest.raises(asyncio.CancelledError):
        await worker.run_forever(module, POOL, client, SETTINGS, capture, gov)
    assert delays[0] == pytest.approx(max(86_400 / 950, 30), rel=0.01)
    assert delays[2] >= 120


class PoolStub:
    async def open(self) -> None:
        return None

    async def close(self) -> None:
        return None

    connection = POOL.connection


async def test_the_worker_builds_one_governor_per_governed_module(
    recorder: Recorder, monkeypatch: pytest.MonkeyPatch
) -> None:
    module = governed_module(metered_fetch)
    monkeypatch.setitem(REGISTRY, "aircraft", module)
    settings = Settings(
        database_url="postgresql://t:t@127.0.0.1:1/t",
        modules_enabled=["aircraft"],
        opensky_client_id=SecretStr("id"),
        opensky_client_secret=SecretStr("secret"),
        _env_file=None,
    )
    monkeypatch.setattr(worker, "create_pool", lambda s: PoolStub())
    assert await worker.run(settings, once=True) == 0
    assert [m for m, _ in recorder.metas] == ["aircraft"]
    assert recorder.entity_writes[0]["module_id"] == "aircraft"
