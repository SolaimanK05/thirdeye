import asyncio
import hashlib
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import psycopg
import structlog
from pydantic import AwareDatetime, BaseModel, JsonValue

from thirdeye.ontology import Confidence, EntityKind
from thirdeye.reads import SnapshotRecord, Viewport, ViewRecord

log = structlog.get_logger()

CHANNEL = "layer_updated"
LISTEN = "listen layer_updated"
RECONNECT_BASE_SECONDS = 1.0
RECONNECT_CAP_SECONDS = 30.0

MAX_VIEW_ENTRIES = 256

type Loader = Callable[[str], Awaitable[SnapshotRecord | None]]
type ViewLoader = Callable[[str, Viewport], Awaitable[ViewRecord | None]]
type Key = tuple[str, Viewport | None]
type Connect = Callable[[], Awaitable[psycopg.AsyncConnection[Any]]]
type Sleep = Callable[[float], Awaitable[None]]
type Notified = Callable[[str | None], None]


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


class EntityRow(BaseModel):
    id: str
    kind: EntityKind
    name: str
    lon: float
    lat: float
    t: AwareDatetime
    sog: float | None
    cog: float | None
    heading: float | None
    alt: float | None
    confidence: Confidence
    attrs: dict[str, JsonValue]


class Layer(BaseModel):
    module_id: str
    fetched_at: AwareDatetime | None
    record_count: int
    matched: int
    truncated: bool
    rows: list[EventRow]
    entities: list[EntityRow] = []


@dataclass(frozen=True, slots=True)
class CachedLayer:
    body: bytes
    etag: str
    last_modified: datetime | None
    entities: tuple[EntityRow, ...] = ()


def encode_layer(layer: Layer, entities: tuple[EntityRow, ...] = ()) -> CachedLayer:
    body = layer.model_dump_json().encode()
    digest = hashlib.blake2b(body, digest_size=16).hexdigest()
    return CachedLayer(
        body=body,
        etag=f'"{digest}"',
        last_modified=layer.fetched_at,
        entities=entities,
    )


def build_layer(module_id: str, snapshot: SnapshotRecord | None) -> CachedLayer:
    rows = [] if snapshot is None else snapshot.payload
    return encode_layer(
        Layer.model_validate(
            {
                "module_id": module_id,
                "fetched_at": None if snapshot is None else snapshot.fetched_at,
                "record_count": len(rows),
                "matched": len(rows),
                "truncated": False,
                "rows": rows,
            }
        )
    )


def build_view_layer(module_id: str, view: ViewRecord | None) -> CachedLayer:
    rows = [] if view is None else view.rows
    matched = 0 if view is None else view.matched
    return encode_layer(
        Layer.model_validate(
            {
                "module_id": module_id,
                "fetched_at": None if view is None else view.fetched_at,
                "record_count": len(rows),
                "matched": matched,
                "truncated": matched > len(rows),
                "rows": rows,
            }
        )
    )


def in_box(row: EntityRow, box: Viewport) -> bool:
    if not box.south <= row.lat <= box.north:
        return False
    if box.wraps:
        return row.lon >= box.west or row.lon <= box.east
    return box.west <= row.lon <= box.east


def build_entity_layer(
    module_id: str, snapshot: SnapshotRecord | None, box: Viewport | None
) -> CachedLayer:
    rows = (
        []
        if snapshot is None
        else [EntityRow.model_validate(item) for item in snapshot.payload]
    )
    inside = rows if box is None else [row for row in rows if in_box(row, box)]
    shown = inside if box is None else inside[: box.limit]
    return encode_layer(
        Layer(
            module_id=module_id,
            fetched_at=None if snapshot is None else snapshot.fetched_at,
            record_count=len(shown),
            matched=len(inside),
            truncated=len(inside) > len(shown),
            rows=[],
            entities=shown,
        ),
        entities=tuple(shown) if box is None else (),
    )


class LayerCache:
    def __init__(self, load: Loader, load_view: ViewLoader | None = None) -> None:
        self._load = load
        self._load_view = load_view
        self._entries: dict[Key, CachedLayer] = {}
        self._generations: dict[str, int] = {}
        self._locks: dict[Key, asyncio.Lock] = {}

    async def get(self, module_id: str) -> CachedLayer:
        return await self._get(
            (module_id, None),
            lambda: self._snapshot_layer(module_id),
        )

    async def get_view(self, module_id: str, viewport: Viewport) -> CachedLayer:
        if self._load_view is None:
            raise RuntimeError("this cache has no viewport loader")
        load_view = self._load_view
        return await self._get(
            (module_id, viewport),
            lambda: self._view_layer(load_view, module_id, viewport),
        )

    async def get_entities(
        self, module_id: str, viewport: Viewport | None
    ) -> CachedLayer:
        return await self._get(
            (module_id, viewport),
            lambda: self._entity_layer(module_id, viewport),
        )

    async def _entity_layer(
        self, module_id: str, viewport: Viewport | None
    ) -> CachedLayer:
        return build_entity_layer(module_id, await self._load(module_id), viewport)

    async def _snapshot_layer(self, module_id: str) -> CachedLayer:
        return build_layer(module_id, await self._load(module_id))

    async def _view_layer(
        self, load_view: ViewLoader, module_id: str, viewport: Viewport
    ) -> CachedLayer:
        return build_view_layer(module_id, await load_view(module_id, viewport))

    async def _get(
        self, key: Key, build: Callable[[], Awaitable[CachedLayer]]
    ) -> CachedLayer:
        if (entry := self._entries.get(key)) is not None:
            return entry
        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            if (entry := self._entries.get(key)) is not None:
                return entry
            module_id = key[0]
            generation = self._generations.get(module_id, 0)
            entry = await build()
            if self._generations.get(module_id, 0) == generation:
                self._remember(key, entry)
            return entry

    def _remember(self, key: Key, entry: CachedLayer) -> None:
        self._entries[key] = entry
        views = [k for k in self._entries if k[1] is not None]
        for stale in views[: max(0, len(views) - MAX_VIEW_ENTRIES)]:
            del self._entries[stale]
            self._locks.pop(stale, None)

    def invalidate(self, module_id: str | None = None) -> None:
        targets = (
            list({key[0] for key in self._entries} | self._generations.keys())
            if module_id is None
            else [module_id]
        )
        for target in targets:
            self._generations[target] = self._generations.get(target, 0) + 1
            for key in [k for k in self._entries if k[0] == target]:
                del self._entries[key]
                self._locks.pop(key, None)


def reconnect_delay(failures: int) -> float:
    doublings = min(max(0, failures - 1), 8)
    return min(RECONNECT_CAP_SECONDS, RECONNECT_BASE_SECONDS * 2.0**doublings)


async def listen_for_layers(
    connect: Connect,
    cache: LayerCache,
    sleep: Sleep = asyncio.sleep,
    on_update: Notified | None = None,
) -> None:
    failures = 0
    while True:
        try:
            async with await connect() as conn:
                await conn.execute(LISTEN)
                cache.invalidate()
                failures = 0
                log.info("layers.listening", channel=CHANNEL)
                if on_update is not None:
                    on_update(None)
                async for notify in conn.notifies():
                    log.debug("layers.updated", module=notify.payload)
                    cache.invalidate(notify.payload)
                    if on_update is not None:
                        on_update(notify.payload)
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
