import argparse
import asyncio
import signal
from collections.abc import Awaitable, Callable, Sequence
from datetime import UTC, datetime
from importlib.metadata import version

import httpx
import structlog

from thirdeye import store
from thirdeye.config import Settings, get_settings
from thirdeye.db import Pool, create_pool
from thirdeye.logs import configure_logging
from thirdeye.ontology import EntityReport
from thirdeye.registry import Module, enabled

log = structlog.get_logger()

type Sleep = Callable[[float], Awaitable[None]]

BACKOFF_BASE_SECONDS = 30.0
BACKOFF_CAP_SECONDS = 900.0
HTTP_TIMEOUT_SECONDS = 20.0


def backoff_delay(failures: int) -> float:
    doublings = min(max(0, failures - 1), 16)
    return min(BACKOFF_CAP_SECONDS, BACKOFF_BASE_SECONDS * 2.0**doublings)


REDACTED = "[redacted]"


class ModuleNotPolled(Exception):
    pass


class EmptyDownload(Exception):
    pass


def scrub(text: str, settings: Settings) -> str:
    for secret in settings.secret_values():
        text = text.replace(secret, REDACTED)
    return text


async def run_once(
    module: Module, pool: Pool, client: httpx.AsyncClient, settings: Settings
) -> int:
    if module.fetch is None:
        raise ModuleNotPolled(module.id)
    fetched_at = datetime.now(UTC)
    raw = await module.fetch(client, settings)
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
    manifest = module.manifest
    keep = manifest.observation_retention_seconds
    async with pool.connection() as conn:
        count = await store.write_entities(
            conn,
            module.id,
            manifest.provenance.source_id,
            reports,
            fetched_at,
            latest_only=keep is None,
            snapshot_window_seconds=manifest.snapshot_window_seconds,
        )
        if keep is not None:
            removed = await store.prune_observations(
                conn, manifest.provenance.source_id, keep, fetched_at
            )
            if removed:
                log.info("module.pruned", module=module.id, removed=removed)
    return count


async def report_failure(
    module: Module, pool: Pool, exc: Exception, settings: Settings
) -> None:
    reason = scrub(f"{type(exc).__name__}: {exc}", settings)
    try:
        async with pool.connection() as conn:
            await store.record_failure(conn, module.id, reason, datetime.now(UTC))
    except Exception as db_exc:  # noqa: BLE001 - the database may be what failed
        log.error("module.health_not_saved", module=module.id, error=str(db_exc))


async def tick(
    module: Module, pool: Pool, client: httpx.AsyncClient, settings: Settings
) -> bool:
    try:
        count = await run_once(module, pool, client, settings)
    except Exception as exc:  # noqa: BLE001 - one module must never stop the others
        log.warning(
            "module.failed",
            module=module.id,
            error=scrub(f"{type(exc).__name__}: {exc}", settings),
        )
        await report_failure(module, pool, exc, settings)
        return False
    log.info("module.ok", module=module.id, records=count)
    return True


async def run_forever(
    module: Module,
    pool: Pool,
    client: httpx.AsyncClient,
    settings: Settings,
    sleep: Sleep = asyncio.sleep,
) -> None:
    failures = 0
    while True:
        if await tick(module, pool, client, settings):
            failures = 0
            delay = float(module.manifest.cadence_seconds)
        else:
            failures += 1
            delay = backoff_delay(failures)
            log.info(
                "module.backoff", module=module.id, failures=failures, retry_in=delay
            )
        await sleep(delay)


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
                "module.skipped_no_key", module=module.id, key=module.manifest.key_env
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
            for module in modules:
                if module.fetch is None or module.manifest.cadence_seconds == 0:
                    log.info("module.not_polled", module=module.id)
                    continue
                polled.append(module)
            if once:
                results = await asyncio.gather(
                    *(tick(m, pool, client, settings) for m in polled)
                )
                return 0 if all(results) else 1
            async with asyncio.TaskGroup() as tasks:
                for module in polled:
                    tasks.create_task(
                        run_forever(module, pool, client, settings), name=module.id
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
