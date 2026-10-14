import asyncio
import hashlib
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import psycopg
import structlog
from pydantic import AwareDatetime, BaseModel, JsonValue

from thirdeye.ontology import Confidence
from thirdeye.reads import SnapshotRecord

log = structlog.get_logger()

CHANNEL = "layer_updated"
LISTEN = "listen layer_updated"
RECONNECT_BASE_SECONDS = 1.0
RECONNECT_CAP_SECONDS = 30.0

type Loader = Callable[[str], Awaitable[SnapshotRecord | None]]
type Connect = Callable[[], Awaitable[psycopg.AsyncConnection[Any]]]
type Sleep = Callable[[float], Awaitable[None]]


class EventRow(BaseModel):
    id: str
    category: str
    lon: float
    lat: float
    t_start: AwareDatetime
    t_end: AwareDatetime | None
    severity: float | None
    confidence: Confidence
    attrs: dict[str, JsonValue]


class Layer(BaseModel):
    module_id: str
    fetched_at: AwareDatetime | None
    record_count: int
    rows: list[EventRow]


@dataclass(frozen=True, slots=True)
class CachedLayer:
    body: bytes
    etag: str
    last_modified: datetime | None


def build_layer(module_id: str, snapshot: SnapshotRecord | None) -> CachedLayer:
    rows = [] if snapshot is None else snapshot.payload
    layer = Layer.model_validate(
        {
            "module_id": module_id,
            "fetched_at": None if snapshot is None else snapshot.fetched_at,
            "record_count": len(rows),
            "rows": rows,
        }
    )
    body = layer.model_dump_json().encode()
    digest = hashlib.blake2b(body, digest_size=16).hexdigest()
    return CachedLayer(body=body, etag=f'"{digest}"', last_modified=layer.fetched_at)


class LayerCache:
    def __init__(self, load: Loader) -> None:
        self._load = load
        self._entries: dict[str, CachedLayer] = {}
        self._generations: dict[str, int] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    async def get(self, module_id: str) -> CachedLayer:
        if (entry := self._entries.get(module_id)) is not None:
            return entry
        lock = self._locks.setdefault(module_id, asyncio.Lock())
        async with lock:
            if (entry := self._entries.get(module_id)) is not None:
                return entry
            generation = self._generations.get(module_id, 0)
            entry = build_layer(module_id, await self._load(module_id))
            if self._generations.get(module_id, 0) == generation:
                self._entries[module_id] = entry
            return entry

    def invalidate(self, module_id: str | None = None) -> None:
        targets = (
            list({*self._entries, *self._generations})
            if module_id is None
            else [module_id]
        )
        for target in targets:
            self._generations[target] = self._generations.get(target, 0) + 1
            self._entries.pop(target, None)


def reconnect_delay(failures: int) -> float:
    doublings = min(max(0, failures - 1), 8)
    return min(RECONNECT_CAP_SECONDS, RECONNECT_BASE_SECONDS * 2.0**doublings)


async def listen_for_layers(
    connect: Connect, cache: LayerCache, sleep: Sleep = asyncio.sleep
) -> None:
    failures = 0
    while True:
        try:
            async with await connect() as conn:
                await conn.execute(LISTEN)
                cache.invalidate()
                failures = 0
                log.info("layers.listening", channel=CHANNEL)
                async for notify in conn.notifies():
                    log.debug("layers.updated", module=notify.payload)
                    cache.invalidate(notify.payload)
        except (psycopg.Error, OSError) as exc:
            failures += 1
            delay = reconnect_delay(failures)
            log.warning(
                "layers.listener_lost",
                error=f"{type(exc).__name__}: {exc}",
                retry_in=delay,
            )
            cache.invalidate()
            await sleep(delay)
