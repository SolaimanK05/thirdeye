import argparse
import asyncio
import signal
import time
from collections.abc import Awaitable, Callable, Sequence
from datetime import UTC, datetime
from importlib.metadata import version

import httpx
import structlog
from pydantic import JsonValue

from thirdeye import store
from thirdeye.config import Settings, get_settings
from thirdeye.db import Pool, create_pool
from thirdeye.governor import Fetched, Governor, RateLimited
from thirdeye.logs import configure_logging
from thirdeye.ontology import EntityReport
from thirdeye.redact import scrub
from thirdeye.registry import Module, enabled
from thirdeye.streams import Stop, wait_for_stop

log = structlog.get_logger()

type Sleep = Callable[[float], Awaitable[None]]

BACKOFF_BASE_SECONDS = 30.0
BACKOFF_CAP_SECONDS = 900.0
HTTP_TIMEOUT_SECONDS = 20.0
STREAM_ONCE_SECONDS = 30.0
STREAM_STABLE_SECONDS = 60.0


def backoff_delay(failures: int) -> float:
    doublings = min(max(0, failures - 1), 16)
    return min(BACKOFF_CAP_SECONDS, BACKOFF_BASE_SECONDS * 2.0**doublings)


class ModuleNotPolled(Exception):
    pass


class EmptyDownload(Exception):
    pass


async def run_once(
    module: Module,
    pool: Pool,
    client: httpx.AsyncClient,
    settings: Settings,
    governor: Governor | None = None,
) -> int:
    if module.fetch is None:
        raise ModuleNotPolled(module.id)
    fetched_at = datetime.now(UTC)
    fetched = await module.fetch(client, settings)
    raw = fetched.body if isinstance(fetched, Fetched) else fetched
    if governor is not None:
        governor.spend()
        if isinstance(fetched, Fetched) and fetched.remaining is not None:
            governor.sync(fetched.remaining)
    if module.normalize_entities is not None:
        reports = module.normalize_entities(raw, fetched_at)
        if not reports:
            raise EmptyDownload(f"{module.id} download held no usable records")
        return await store_entities(module, pool, reports, fetched_at)
    assert module.normalize is not None
    parsed = module.normalize(raw, fetched_at)
    accept = module.accept
    events = parsed if accept is None else [e for e in parsed if accept(e, settings)]
    if len(events) != len(parsed):
        log.info(
            "module.filtered",
            module=module.id,
            kept=len(events),
            dropped=len(parsed) - len(events),
        )
    async with pool.connection() as conn:
        await store.write_events(
            conn,
            module.id,
            events,
            fetched_at,
            snapshot_rows=module.manifest.viewport_lookback_seconds is None,
        )
        keep = module.manifest.retention_seconds
        if keep is not None:
            removed = await store.prune_events(conn, module.id, keep, fetched_at)
            if removed:
                log.info("module.pruned", module=module.id, removed=removed)
    return len(events)


async def store_entities(
    module: Module,
    pool: Pool,
    reports: Sequence[EntityReport],
    fetched_at: datetime,
) -> int:
    return await store.store_entity_batch(pool, module.manifest, reports, fetched_at)


async def report_failure(
    module: Module, pool: Pool, exc: Exception, settings: Settings
) -> None:
    reason = scrub(f"{type(exc).__name__}: {exc}", settings)
    try:
        async with pool.connection() as conn:
            await store.record_failure(conn, module.id, reason, datetime.now(UTC))
    except Exception as db_exc:  # noqa: BLE001 - the database may be what failed
        log.error("module.health_not_saved", module=module.id, error=str(db_exc))


async def report_cooldown(
    module: Module, pool: Pool, governor: Governor, until: datetime, reason: str
) -> None:
    try:
        async with pool.connection() as conn:
            await store.record_cooldown(
                conn, module.id, until, reason, datetime.now(UTC)
            )
            await store.record_meta(conn, module.id, governor_meta(governor))
    except Exception as db_exc:  # noqa: BLE001 - the database may be what failed
        log.error("module.health_not_saved", module=module.id, error=str(db_exc))


def governor_meta(governor: Governor) -> dict[str, JsonValue]:
    state = governor.state()
    return {
        "credits_left": state.credits_left,
        "interval_seconds": state.interval_seconds,
        "cost": state.cost,
        "budget": state.budget,
    }


async def report_meta(module: Module, pool: Pool, governor: Governor) -> None:
    meta = governor_meta(governor)
    log.info("module.governed", module=module.id, **meta)
    try:
        async with pool.connection() as conn:
            await store.record_meta(conn, module.id, meta)
    except Exception as db_exc:  # noqa: BLE001 - the numbers are only advisory
        log.error("module.health_not_saved", module=module.id, error=str(db_exc))


async def fail(module: Module, pool: Pool, exc: Exception, settings: Settings) -> bool:
    log.warning(
        "module.failed",
        module=module.id,
        error=scrub(f"{type(exc).__name__}: {exc}", settings),
    )
    await report_failure(module, pool, exc, settings)
    return False


async def tick(
    module: Module,
    pool: Pool,
    client: httpx.AsyncClient,
    settings: Settings,
    governor: Governor | None = None,
) -> bool:
    try:
        count = await run_once(module, pool, client, settings, governor)
    except RateLimited as exc:
        if governor is None:
            return await fail(module, pool, exc, settings)
        until = governor.on_rate_limited(exc.retry_after)
        reason = f"cooldown until {until:%H:%M}Z"
        log.warning("module.rate_limited", module=module.id, until=until.isoformat())
        await report_cooldown(module, pool, governor, until, reason)
        return False
    except Exception as exc:  # noqa: BLE001 - one module must never stop the others
        return await fail(module, pool, exc, settings)
    log.info("module.ok", module=module.id, records=count)
    if governor is not None:
        await report_meta(module, pool, governor)
    return True


async def rest_remaining(module: Module, pool: Pool) -> float:
    manifest = module.manifest
    if not manifest.honor_last_fetch:
        return 0.0
    try:
        last = await store.read_last_attempt(pool, module.id)
    except Exception as exc:  # noqa: BLE001 - a failed look-up must not stop the module
        log.warning("module.last_attempt_unknown", module=module.id, error=str(exc))
        return 0.0
    if last is None:
        return 0.0
    interval = float(
        manifest.cadence_seconds if last.ok else manifest.min_retry_seconds or 0
    )
    elapsed = max(0.0, (datetime.now(UTC) - last.at).total_seconds())
    return max(0.0, interval - elapsed)


def failure_delay(module: Module, failures: int) -> float:
    return max(backoff_delay(failures), float(module.manifest.min_retry_seconds or 0))


async def tick_if_due(
    module: Module,
    pool: Pool,
    client: httpx.AsyncClient,
    settings: Settings,
    governor: Governor | None = None,
) -> bool:
    rest = await rest_remaining(module, pool)
    if rest > 0:
        log.info("module.resting", module=module.id, until_next_seconds=round(rest))
        return True
    return await tick(module, pool, client, settings, governor)


async def run_forever(
    module: Module,
    pool: Pool,
    client: httpx.AsyncClient,
    settings: Settings,
    sleep: Sleep = asyncio.sleep,
    governor: Governor | None = None,
) -> None:
    failures = 0
    rest = await rest_remaining(module, pool)
    if rest > 0:
        log.info("module.resting", module=module.id, until_next_seconds=round(rest))
        await sleep(rest)
    while True:
        succeeded = await tick(module, pool, client, settings, governor)
        failures = 0 if succeeded else failures + 1
        if governor is not None:
            delay = governor.next_delay()
            if not succeeded and governor.cooldown_until is None:
                delay = max(delay, backoff_delay(failures))
            log.info("module.next_poll", module=module.id, in_seconds=round(delay))
        elif succeeded:
            delay = float(module.manifest.cadence_seconds)
        else:
            delay = failure_delay(module, failures)
            log.info(
                "module.backoff", module=module.id, failures=failures, retry_in=delay
            )
        await sleep(delay)


async def supervise_stream(
    module: Module, pool: Pool, settings: Settings, stop: Stop
) -> None:
    assert module.stream is not None
    failures = 0
    while not stop.is_set():
        started = time.monotonic()
        try:
            await module.stream(pool, settings, stop)
        except Exception as exc:  # noqa: BLE001 - one module must never stop the others
            failures = (
                1
                if time.monotonic() - started >= STREAM_STABLE_SECONDS
                else failures + 1
            )
            await fail(module, pool, exc, settings)
            delay = backoff_delay(failures)
            log.info(
                "module.backoff", module=module.id, failures=failures, retry_in=delay
            )
            if await wait_for_stop(stop, delay):
                return
        else:
            return


async def stream_once(
    module: Module, pool: Pool, settings: Settings, seconds: float
) -> bool:
    assert module.stream is not None
    stop = asyncio.Event()
    asyncio.get_running_loop().call_later(seconds, stop.set)
    try:
        await module.stream(pool, settings, stop)
    except Exception as exc:  # noqa: BLE001 - one module must never stop the others
        return await fail(module, pool, exc, settings)
    log.info("module.ok", module=module.id, streamed_seconds=seconds)
    return True


def http_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=HTTP_TIMEOUT_SECONDS,
        follow_redirects=True,
        headers={"User-Agent": f"thirdeye-worker/{version('thirdeye')}"},
    )


async def run(settings: Settings, *, once: bool) -> int:
    modules = []
    for module in enabled(settings.modules_enabled):
        if module.key_missing(settings):
            log.warning(
                "module.skipped_no_key",
                module=module.id,
                keys=module.missing_keys(settings),
            )
            continue
        modules.append(module)
    if not modules:
        log.warning("worker.no_modules", hint="set MODULES_ENABLED")
        return 0
    loop = asyncio.get_running_loop()
    main_task = asyncio.current_task()
    if main_task is not None:
        loop.add_signal_handler(signal.SIGTERM, main_task.cancel)
    pool = create_pool(settings)
    await pool.open()
    log.info("worker.started", modules=[m.id for m in modules], once=once)
    try:
        async with http_client() as client:
            polled = []
            streamed = []
            for module in modules:
                if module.stream is not None:
                    log.info("module.streaming", module=module.id)
                    streamed.append(module)
                elif module.fetch is None or module.manifest.cadence_seconds == 0:
                    log.info("module.not_polled", module=module.id)
                else:
                    polled.append(module)
            governors = {
                m.id: None if m.governor is None else m.governor.build(settings)
                for m in polled
            }
            if once:
                results = await asyncio.gather(
                    *(
                        tick_if_due(m, pool, client, settings, governors[m.id])
                        for m in polled
                    ),
                    *(
                        stream_once(m, pool, settings, STREAM_ONCE_SECONDS)
                        for m in streamed
                    ),
                )
                return 0 if all(results) else 1
            stop = asyncio.Event()
            async with asyncio.TaskGroup() as tasks:
                for module in streamed:
                    tasks.create_task(
                        supervise_stream(module, pool, settings, stop), name=module.id
                    )
                for module in polled:
                    tasks.create_task(
                        run_forever(
                            module,
                            pool,
                            client,
                            settings,
                            governor=governors[module.id],
                        ),
                        name=module.id,
                    )
        return 0
    finally:
        await pool.close()
        log.info("worker.stopped")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m thirdeye.worker",
        description="Fetch every enabled module on its cadence and store the results.",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="run each enabled module one time, then exit",
    )
    args = parser.parse_args(argv)
    settings = get_settings()
    configure_logging(settings)
    try:
        return asyncio.run(run(settings, once=args.once))
    except KeyboardInterrupt, asyncio.CancelledError:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
