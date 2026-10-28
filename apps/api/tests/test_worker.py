import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
from conftest import POOL, Recorder
from pydantic import SecretStr
from test_governor import FakeClock

from thirdeye import store, worker
from thirdeye.config import Settings
from thirdeye.db import Pool
from thirdeye.governor import Fetched, Governor, RateLimited
from thirdeye.modules.ports import records as ports_records
from thirdeye.modules.wildfires import records as wildfire_records
from thirdeye.ontology import EntityReport
from thirdeye.registry import REGISTRY, Fetch, Module
from thirdeye.streams import Stop, StreamRunner

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


def streaming_module(run: StreamRunner) -> Module:
    base = REGISTRY["vessels"]
    return Module(
        base.manifest, None, normalize_entities=lambda raw, at: [], stream=run
    )


class TestStreams:
    async def test_a_stream_that_returns_is_not_restarted(
        self, recorder: Recorder
    ) -> None:
        calls: list[Stop] = []

        async def run(pool: Pool, settings: Settings, stop: Stop) -> None:
            calls.append(stop)

        stop = asyncio.Event()
        await worker.supervise_stream(streaming_module(run), POOL, SETTINGS, stop)
        assert len(calls) == 1
        assert recorder.failures == []

    async def test_a_crashing_stream_is_reported_and_restarted(
        self, recorder: Recorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(worker, "backoff_delay", lambda failures: 0.01 * failures)
        attempts: list[int] = []

        async def run(pool: Pool, settings: Settings, stop: Stop) -> None:
            attempts.append(1)
            if len(attempts) < 3:
                raise RuntimeError("the reader fell over")

        await worker.supervise_stream(
            streaming_module(run), POOL, SETTINGS, asyncio.Event()
        )
        assert len(attempts) == 3
        assert [reason for _, reason in recorder.failures] == [
            "RuntimeError: the reader fell over"
        ] * 2

    async def test_stopping_during_the_wait_ends_the_supervisor(
        self, recorder: Recorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(worker, "backoff_delay", lambda failures: 3600.0)

        async def run(pool: Pool, settings: Settings, stop: Stop) -> None:
            raise RuntimeError("down")

        stop = asyncio.Event()
        task = asyncio.create_task(
            worker.supervise_stream(streaming_module(run), POOL, SETTINGS, stop)
        )
        await asyncio.sleep(0.05)
        stop.set()
        async with asyncio.timeout(2):
            await task
        assert len(recorder.failures) == 1

    async def test_the_secret_is_scrubbed_from_a_stream_failure(
        self, recorder: Recorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(worker, "backoff_delay", lambda failures: 0.0)
        settings = Settings(
            database_url="postgresql://t:t@127.0.0.1:1/t",
            aisstream_api_key=SecretStr("ais-secret"),
            _env_file=None,
        )
        stop = asyncio.Event()

        async def run(pool: Pool, settings: Settings, stop_: Stop) -> None:
            stop.set()
            raise RuntimeError("bad key ais-secret")

        await worker.supervise_stream(streaming_module(run), POOL, settings, stop)
        assert recorder.failures == [("vessels", "RuntimeError: bad key [redacted]")]

    async def test_once_runs_the_stream_for_a_window_then_stops_it(
        self, recorder: Recorder
    ) -> None:
        stopped: list[bool] = []

        async def run(pool: Pool, settings: Settings, stop: Stop) -> None:
            await stop.wait()
            stopped.append(True)

        ok = await worker.stream_once(streaming_module(run), POOL, SETTINGS, 0.05)
        assert ok is True
        assert stopped == [True]

    async def test_once_reports_a_stream_that_fails(self, recorder: Recorder) -> None:
        async def run(pool: Pool, settings: Settings, stop: Stop) -> None:
            raise RuntimeError("no")

        ok = await worker.stream_once(streaming_module(run), POOL, SETTINGS, 0.05)
        assert ok is False
        assert len(recorder.failures) == 1

    async def test_the_worker_starts_streams_and_does_not_poll_them(
        self, recorder: Recorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        started: list[str] = []

        async def run(pool: Pool, settings: Settings, stop: Stop) -> None:
            started.append("vessels")
            await stop.wait()

        monkeypatch.setitem(REGISTRY, "vessels", streaming_module(run))
        monkeypatch.setattr(worker, "STREAM_ONCE_SECONDS", 0.05)
        monkeypatch.setattr(worker, "create_pool", lambda s: PoolStub())
        settings = Settings(
            database_url="postgresql://t:t@127.0.0.1:1/t",
            modules_enabled=["vessels"],
            aisstream_api_key=SecretStr("k"),
            _env_file=None,
        )
        assert await worker.run(settings, once=True) == 0
        assert started == ["vessels"]

    async def test_the_worker_skips_a_stream_without_its_key(
        self, recorder: Recorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        started: list[str] = []

        async def run(pool: Pool, settings: Settings, stop: Stop) -> None:
            started.append("vessels")

        monkeypatch.setitem(REGISTRY, "vessels", streaming_module(run))
        monkeypatch.setattr(worker, "create_pool", lambda s: PoolStub())
        settings = Settings(
            database_url="postgresql://t:t@127.0.0.1:1/t",
            modules_enabled=["vessels"],
            _env_file=None,
        )
        assert await worker.run(settings, once=True) == 0
        assert started == []

    async def test_one_failing_stream_does_not_fail_the_others(
        self, recorder: Recorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def run(pool: Pool, settings: Settings, stop: Stop) -> None:
            raise RuntimeError("no")

        monkeypatch.setitem(REGISTRY, "vessels", streaming_module(run))
        monkeypatch.setitem(
            REGISTRY, "earthquakes", module_with(ok_fetch, "earthquakes")
        )
        monkeypatch.setattr(worker, "STREAM_ONCE_SECONDS", 0.05)
        monkeypatch.setattr(worker, "create_pool", lambda s: PoolStub())
        settings = Settings(
            database_url="postgresql://t:t@127.0.0.1:1/t",
            modules_enabled=["earthquakes", "vessels"],
            aisstream_api_key=SecretStr("k"),
            _env_file=None,
        )
        assert await worker.run(settings, once=True) == 1
        assert recorder.writes == [("earthquakes", 0)]


def satellite_module(fetch: Fetch = ok_fetch) -> Module:
    base = REGISTRY["satellites"]
    return Module(
        base.manifest, fetch, normalize_entities=lambda raw, at: one_port(raw, at)
    )


def attempted(ago: timedelta, *, ok: bool) -> store.LastAttempt:
    return store.LastAttempt(at=datetime.now(UTC) - ago, ok=ok)


async def test_a_module_that_does_not_ask_for_rest_never_looks_up_its_last_attempt(
    recorder: Recorder,
) -> None:
    assert await worker.rest_remaining(module_with(ok_fetch), POOL) == 0.0
    assert recorder.last_attempt_looks == []


async def test_a_module_with_no_history_is_fetched_at_once(recorder: Recorder) -> None:
    assert await worker.rest_remaining(satellite_module(), POOL) == 0.0
    assert recorder.last_attempt_looks == ["satellites"]


async def test_after_a_good_download_the_rest_of_the_cadence_is_waited_out(
    recorder: Recorder,
) -> None:
    recorder.last_attempt = attempted(timedelta(hours=1), ok=True)
    rest = await worker.rest_remaining(satellite_module(), POOL)
    assert rest == pytest.approx(23 * 3600, abs=5)


async def test_after_a_failure_the_minimum_retry_interval_is_waited_out(
    recorder: Recorder,
) -> None:
    recorder.last_attempt = attempted(timedelta(minutes=30), ok=False)
    rest = await worker.rest_remaining(satellite_module(), POOL)
    assert rest == pytest.approx(90 * 60, abs=5)


@pytest.mark.parametrize(
    "last",
    [timedelta(days=2), timedelta(hours=25)],
)
async def test_an_old_good_download_means_no_rest(
    recorder: Recorder, last: timedelta
) -> None:
    recorder.last_attempt = attempted(last, ok=True)
    assert await worker.rest_remaining(satellite_module(), POOL) == 0.0


async def test_an_old_failure_means_no_rest(recorder: Recorder) -> None:
    recorder.last_attempt = attempted(timedelta(hours=3), ok=False)
    assert await worker.rest_remaining(satellite_module(), POOL) == 0.0


async def test_a_clock_that_ran_backwards_does_not_lengthen_the_rest(
    recorder: Recorder,
) -> None:
    recorder.last_attempt = attempted(timedelta(hours=-5), ok=True)
    rest = await worker.rest_remaining(satellite_module(), POOL)
    assert rest <= 24 * 3600


async def test_an_unreadable_history_does_not_stop_the_module(
    recorder: Recorder,
) -> None:
    recorder.last_attempt_error = OSError("database is away")
    assert await worker.rest_remaining(satellite_module(), POOL) == 0.0


async def test_the_forever_loop_rests_before_its_first_download(
    recorder: Recorder, client: httpx.AsyncClient
) -> None:
    recorder.last_attempt = attempted(timedelta(hours=2), ok=True)
    slept: list[float] = []

    async def capture(seconds: float) -> None:
        slept.append(seconds)
        if len(slept) == 2:
            raise asyncio.CancelledError

    with pytest.raises(asyncio.CancelledError):
        await worker.run_forever(satellite_module(), POOL, client, SETTINGS, capture)
    assert slept[0] == pytest.approx(22 * 3600, abs=5)
    assert slept[1] == 86_400
    assert len(recorder.entity_writes) == 1


async def test_failures_wait_at_least_the_minimum_retry_interval(
    recorder: Recorder, client: httpx.AsyncClient
) -> None:
    delays: list[float] = []

    async def capture(seconds: float) -> None:
        delays.append(seconds)
        if len(delays) == 3:
            raise asyncio.CancelledError

    with pytest.raises(asyncio.CancelledError):
        await worker.run_forever(
            satellite_module(failing_fetch), POOL, client, SETTINGS, capture
        )
    assert delays == [7_200, 7_200, 7_200]


async def test_a_single_run_leaves_a_resting_module_alone(
    recorder: Recorder, client: httpx.AsyncClient
) -> None:
    recorder.last_attempt = attempted(timedelta(minutes=10), ok=True)
    assert await worker.tick_if_due(satellite_module(), POOL, client, SETTINGS) is True
    assert recorder.entity_writes == []


async def test_a_single_run_downloads_when_the_module_is_due(
    recorder: Recorder, client: httpx.AsyncClient
) -> None:
    recorder.last_attempt = attempted(timedelta(days=3), ok=True)
    assert await worker.tick_if_due(satellite_module(), POOL, client, SETTINGS) is True
    assert len(recorder.entity_writes) == 1
