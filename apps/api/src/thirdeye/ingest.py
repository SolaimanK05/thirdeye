import asyncio
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime

import structlog

from thirdeye import store
from thirdeye.config import Settings
from thirdeye.db import Pool
from thirdeye.ontology import EntityReport, ModuleManifest
from thirdeye.redact import scrub
from thirdeye.streams import (
    Connected,
    FrameBuffer,
    FrameReader,
    LinkEvent,
    Stop,
    StreamRunner,
    StreamTuning,
    Tune,
    wait_for_stop,
)

log = structlog.get_logger()

PRUNE_EVERY_SECONDS = 60.0
DEFAULT_HEARTBEAT_SECONDS = 60.0

type Normalizer = Callable[[bytes, datetime], list[EntityReport]]


@dataclass(slots=True)
class LinkState:
    connected: bool = False
    failure: str | None = None
    refresh_due: bool = False


class EntityIngest:
    def __init__(
        self,
        manifest: ModuleManifest,
        normalize: Normalizer,
        tuning: StreamTuning,
        pool: Pool,
        settings: Settings,
    ) -> None:
        self.manifest = manifest
        self.normalize = normalize
        self.tuning = tuning
        self.pool = pool
        self.settings = settings
        self.buffer = FrameBuffer(tuning.queue_max)
        self.link = LinkState()
        self.heartbeat = float(manifest.heartbeat_seconds or DEFAULT_HEARTBEAT_SECONDS)
        self.last_write = time.monotonic()
        self.last_prune = float("-inf")
        self.dropped_total = 0

    def on_link(self, event: LinkEvent) -> None:
        module = self.manifest.id
        if isinstance(event, Connected):
            self.link.connected = True
            self.link.failure = None
            self.link.refresh_due = True
            log.info("stream.connected", module=module)
            return
        reason = scrub(event.reason, self.settings)
        self.link.connected = False
        self.link.failure = reason
        log.warning(
            "stream.disconnected",
            module=module,
            reason=reason,
            failures=event.failures,
            retry_in=round(event.retry_in, 1),
        )

    async def flush(self) -> None:
        module = self.manifest.id
        frames = self.buffer.take()
        dropped = self.buffer.take_dropped()
        if dropped:
            self.dropped_total += dropped
            log.warning(
                "stream.overflow",
                module=module,
                dropped=dropped,
                total=self.dropped_total,
            )
        failure, self.link.failure = self.link.failure, None
        if failure is not None:
            await self.persist_failure(failure)
        now = datetime.now(UTC)
        reports: list[EntityReport] = []
        if frames:
            raw = b"\n".join(frame.replace(b"\n", b" ") for frame in frames)
            reports = await asyncio.to_thread(self.normalize, raw, now)
        if reports:
            await self.write(reports, now, frames=len(frames))
            return
        idle = time.monotonic() - self.last_write >= self.heartbeat
        if self.link.connected and (idle or self.link.refresh_due):
            await self.write([], now, frames=len(frames))

    async def write(
        self, reports: list[EntityReport], now: datetime, *, frames: int
    ) -> None:
        tick = time.monotonic()
        prune = tick - self.last_prune >= PRUNE_EVERY_SECONDS
        written = await store.store_entity_batch(
            self.pool, self.manifest, reports, now, prune=prune
        )
        self.last_write = tick
        self.link.refresh_due = False
        if prune:
            self.last_prune = tick
        if reports:
            log.info(
                "stream.batch",
                module=self.manifest.id,
                frames=frames,
                reports=len(reports),
                entities=written,
            )

    async def persist_failure(self, reason: str) -> None:
        try:
            async with self.pool.connection() as conn:
                await store.record_failure(
                    conn, self.manifest.id, reason, datetime.now(UTC)
                )
        except Exception as exc:  # noqa: BLE001 - the database may be what failed
            log.error(
                "module.health_not_saved",
                module=self.manifest.id,
                error=scrub(str(exc), self.settings),
            )

    async def drain(self, stop: Stop) -> None:
        while True:
            stopped = await wait_for_stop(stop, self.tuning.batch_seconds)
            try:
                await self.flush()
            except Exception as exc:  # noqa: BLE001 - a bad batch must not end the stream
                reason = scrub(f"{type(exc).__name__}: {exc}", self.settings)
                log.warning(
                    "stream.batch_failed", module=self.manifest.id, error=reason
                )
                await self.persist_failure(reason)
            if stopped:
                return


def entity_stream(
    manifest: ModuleManifest,
    read: FrameReader,
    normalize: Normalizer,
    tune: Tune,
) -> StreamRunner:
    async def run(pool: Pool, settings: Settings, stop: Stop) -> None:
        ingest = EntityIngest(manifest, normalize, tune(settings), pool, settings)

        async def reading() -> None:
            await read(settings, stop, ingest.buffer.push, ingest.on_link)

        async with asyncio.TaskGroup() as tasks:
            tasks.create_task(reading(), name=f"{manifest.id}-read")
            tasks.create_task(ingest.drain(stop), name=f"{manifest.id}-drain")

    return run
