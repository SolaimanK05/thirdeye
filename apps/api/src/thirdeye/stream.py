import asyncio
import secrets
from collections import deque
from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal

import structlog
from pydantic import AwareDatetime, BaseModel

from thirdeye.frames import has_frames
from thirdeye.layers import EntityRow, LayerCache
from thirdeye.movers import FrameBody, ModuleFrames, MoverSource

log = structlog.get_logger()

RING_EVENTS = 500
RING_BYTES = 16 * 1024 * 1024
CLIENT_QUEUE_EVENTS = 256
CLIENT_QUEUE_BYTES = 16 * 1024 * 1024
RETRY_MILLISECONDS = 3000
REFRESH_RETRY_SECONDS = 5.0
REFRESH_RETRY_CAP_SECONDS = 60.0

type EventKind = Literal["hello", "layer", "snapshot", "delta"]
type ModuleKind = Literal["events", "entities", "movers"]
type FetchedAt = Callable[[str], Awaitable[datetime | None]]
type Clock = Callable[[], datetime]
type Sleep = Callable[[float], Awaitable[None]]


def utc_now() -> datetime:
    return datetime.now(UTC)


class Hello(BaseModel):
    server_time: AwareDatetime
    instance: str
    resumed: bool


class LayerNotice(BaseModel):
    module_id: str
    fetched_at: AwareDatetime | None
    version: int


class Snapshot(BaseModel):
    module_id: str
    fetched_at: AwareDatetime | None
    version: int
    entities: list[EntityRow]


class Delta(BaseModel):
    module_id: str
    fetched_at: AwareDatetime | None
    version: int
    upserts: list[EntityRow]
    removes: list[str]


@dataclass(frozen=True, slots=True)
class StreamEvent:
    kind: EventKind
    module_id: str | None
    data: str
    id: str | None = None
    seq: int = 0
    retry: int | None = None

    @property
    def size(self) -> int:
        return len(self.data)


def event_id(epoch: str, seq: int) -> str:
    return f"{epoch}-{seq}"


def parse_event_id(value: str | None) -> tuple[str, int] | None:
    if value is None:
        return None
    epoch, separator, number = value.rpartition("-")
    if not separator or not epoch.isascii() or not epoch.isalnum():
        return None
    if not number.isascii() or not number.isdigit():
        return None
    return epoch, int(number)


class Subscriber:
    def __init__(
        self,
        entities: frozenset[str],
        max_events: int = CLIENT_QUEUE_EVENTS,
        max_bytes: int = CLIENT_QUEUE_BYTES,
    ) -> None:
        self.entities = entities
        self.dropped = False
        self._max_events = max_events
        self._max_bytes = max_bytes
        self._queue: asyncio.Queue[StreamEvent | None] = asyncio.Queue()
        self._bytes = 0
        self._closed = False

    @property
    def closed(self) -> bool:
        return self._closed

    @property
    def pending(self) -> int:
        return self._queue.qsize()

    def wants(self, event: StreamEvent) -> bool:
        if event.kind in ("snapshot", "delta"):
            return event.module_id in self.entities
        return True

    def offer(self, event: StreamEvent, *, enforce: bool = True) -> bool:
        if self._closed:
            return False
        too_many = self._queue.qsize() >= self._max_events
        too_big = self._bytes + event.size > self._max_bytes
        if enforce and (too_many or too_big):
            self.dropped = True
            self.close()
            return False
        self._queue.put_nowait(event)
        self._bytes += event.size
        return True

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self.dropped:
            self._queue = asyncio.Queue()
            self._bytes = 0
        self._queue.put_nowait(None)

    async def next(self) -> StreamEvent | None:
        item = await self._queue.get()
        if item is None:
            self._queue.put_nowait(None)
            return None
        self._bytes -= item.size
        return item


@dataclass(slots=True)
class ModuleState:
    kind: ModuleKind
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    loaded: bool = False
    version: int = 0
    fetched_at: datetime | None = None
    rows: dict[str, EntityRow] = field(default_factory=dict)
    snapshot: str | None = None
    frames: ModuleFrames | None = None
    source: MoverSource | None = None


class Broadcaster:
    def __init__(
        self,
        cache: LayerCache,
        fetched_at: FetchedAt,
        modules: Mapping[str, ModuleKind],
        instance: str,
        *,
        sources: Mapping[str, MoverSource] | None = None,
        clock: Clock = utc_now,
        sleep: Sleep = asyncio.sleep,
        ring_events: int = RING_EVENTS,
        ring_bytes: int = RING_BYTES,
        client_events: int = CLIENT_QUEUE_EVENTS,
        client_bytes: int = CLIENT_QUEUE_BYTES,
    ) -> None:
        self._cache = cache
        self._fetched_at = fetched_at
        self._modules = {
            id_: ModuleState(
                kind,
                frames=ModuleFrames.for_module(id_)
                if kind == "entities" and has_frames(id_)
                else None,
            )
            for id_, kind in modules.items()
        }
        for id_, source in (sources or {}).items():
            self._modules[id_] = ModuleState(
                "movers", frames=ModuleFrames.for_module(id_), source=source
            )
        self._instance = instance
        self._clock = clock
        self._sleep = sleep
        self._ring_events = ring_events
        self._ring_bytes = ring_bytes
        self._client_events = client_events
        self._client_bytes = client_bytes
        self._epoch = secrets.token_hex(4)
        self._seq = 0
        self._ring: deque[StreamEvent] = deque()
        self._ring_size = 0
        self._clients: set[Subscriber] = set()
        self._dirty: set[str] = set()
        self._wake = asyncio.Event()
        self._closed = False

    @property
    def epoch(self) -> str:
        return self._epoch

    @property
    def last_seq(self) -> int:
        return self._seq

    @property
    def clients(self) -> int:
        return len(self._clients)

    @property
    def buffered(self) -> int:
        return len(self._ring)

    @property
    def entity_modules(self) -> frozenset[str]:
        return frozenset(
            id_ for id_, state in self._modules.items() if state.kind == "entities"
        )

    @property
    def mover_modules(self) -> frozenset[str]:
        return frozenset(
            id_ for id_, state in self._modules.items() if state.frames is not None
        )

    def notify(self, module_id: str | None) -> None:
        if module_id is None:
            self._dirty.update(self._modules)
        elif module_id in self._modules:
            self._dirty.add(module_id)
        else:
            return
        self._wake.set()

    async def run(self) -> None:
        failures = 0
        while True:
            await self._wake.wait()
            self._wake.clear()
            pending, self._dirty = sorted(self._dirty), set()
            failed: set[str] = set()
            for module_id in pending:
                try:
                    await self.refresh(module_id)
                except Exception as exc:  # noqa: BLE001
                    failed.add(module_id)
                    log.warning(
                        "stream.refresh_failed",
                        module=module_id,
                        error=f"{type(exc).__name__}: {exc}",
                    )
            if not failed:
                failures = 0
                continue
            failures += 1
            self._dirty |= failed
            await self._sleep(refresh_delay(failures))
            self._wake.set()

    async def ready(self, module_ids: Iterable[str]) -> None:
        for module_id in module_ids:
            state = self._modules[module_id]
            if not state.loaded:
                await self.refresh(module_id)

    async def refresh(self, module_id: str) -> None:
        state = self._modules.get(module_id)
        if state is None:
            return
        async with state.lock:
            if state.kind == "movers":
                await self._refresh_movers(module_id, state)
            elif state.kind == "entities":
                await self._refresh_entities(module_id, state)
            else:
                await self._refresh_events(module_id, state)

    async def _refresh_events(self, module_id: str, state: ModuleState) -> None:
        fetched_at = await self._fetched_at(module_id)
        if not state.loaded:
            state.loaded = True
            state.version = 1
            state.fetched_at = fetched_at
            return
        if fetched_at == state.fetched_at:
            return
        state.version += 1
        state.fetched_at = fetched_at
        self._publish_layer(module_id, state)

    async def _refresh_entities(self, module_id: str, state: ModuleState) -> None:
        cached = await self._cache.get_entities(module_id, None)
        rows = {row.id: row for row in cached.entities}
        fetched_at = cached.last_modified
        if not state.loaded:
            state.loaded = True
            state.version = 1
            state.fetched_at = fetched_at
            state.rows = rows
            state.snapshot = None
            if state.frames is not None:
                await asyncio.to_thread(
                    state.frames.load, list(rows.values()), 1, epoch_ms(fetched_at)
                )
            return
        upserts = [row for key, row in rows.items() if state.rows.get(key) != row]
        removes = [key for key in state.rows if key not in rows]
        if not upserts and not removes and fetched_at == state.fetched_at:
            return
        state.version += 1
        state.fetched_at = fetched_at
        state.rows = rows
        state.snapshot = None
        if state.frames is not None:
            await asyncio.to_thread(
                state.frames.advance,
                upserts,
                removes,
                state.version,
                epoch_ms(fetched_at),
            )
        self._publish_layer(module_id, state)
        self._publish(
            "delta",
            module_id,
            Delta(
                module_id=module_id,
                fetched_at=fetched_at,
                version=state.version,
                upserts=upserts,
                removes=removes,
            ).model_dump_json(),
        )

    async def _refresh_movers(self, module_id: str, state: ModuleState) -> None:
        if state.source is None or state.frames is None:
            return
        upserts, removes, fetched_at = await state.source.advance()
        if not state.loaded:
            state.loaded = True
            state.version = 1
            state.fetched_at = fetched_at
            await asyncio.to_thread(state.frames.load, upserts, 1, epoch_ms(fetched_at))
            return
        state.version += 1
        state.fetched_at = fetched_at
        await asyncio.to_thread(
            state.frames.advance, upserts, removes, state.version, epoch_ms(fetched_at)
        )
        self._publish_layer(module_id, state)

    async def frame_snapshot(self, module_id: str, encoding: str) -> FrameBody | None:
        state = self._modules.get(module_id)
        if state is None or state.frames is None:
            return None
        await self.ready([module_id])
        frames = state.frames
        async with state.lock:
            version, raw = await asyncio.to_thread(frames.snapshot_frame)
            epoch = frames.slot_epoch
        body = await asyncio.to_thread(
            frames.variant, "snapshot", version, encoding, raw
        )
        return FrameBody(version, epoch, encoding, body, immutable=False)

    async def frame_delta(
        self, module_id: str, version: int, slot_epoch: int, encoding: str
    ) -> FrameBody | None:
        state = self._modules.get(module_id)
        if state is None or state.frames is None:
            return None
        frames = state.frames
        raw = frames.delta_frame(version, slot_epoch)
        if raw is None:
            return None
        body = await asyncio.to_thread(frames.variant, "delta", version, encoding, raw)
        return FrameBody(version, slot_epoch, encoding, body, immutable=True)

    def _publish_layer(self, module_id: str, state: ModuleState) -> None:
        self._publish(
            "layer",
            module_id,
            LayerNotice(
                module_id=module_id,
                fetched_at=state.fetched_at,
                version=state.version,
            ).model_dump_json(),
        )

    def _publish(self, kind: EventKind, module_id: str, data: str) -> None:
        self._seq += 1
        event = StreamEvent(
            kind=kind,
            module_id=module_id,
            data=data,
            id=event_id(self._epoch, self._seq),
            seq=self._seq,
        )
        self._ring.append(event)
        self._ring_size += event.size
        while len(self._ring) > 1 and (
            len(self._ring) > self._ring_events or self._ring_size > self._ring_bytes
        ):
            self._ring_size -= self._ring.popleft().size
        for client in list(self._clients):
            if client.wants(event):
                client.offer(event)
            if client.closed:
                self._clients.discard(client)

    def subscribe(
        self, entities: frozenset[str], last_event_id: str | None = None
    ) -> Subscriber:
        client = Subscriber(entities, self._client_events, self._client_bytes)
        if self._closed:
            client.close()
            return client
        replay = self._replay_from(last_event_id)
        client.offer(self._hello(resumed=replay is not None), enforce=False)
        if replay is not None:
            for event in replay:
                if client.wants(event):
                    client.offer(event, enforce=False)
        else:
            self._offer_snapshots(client)
        if not client.closed:
            self._clients.add(client)
        return client

    def unsubscribe(self, client: Subscriber) -> None:
        self._clients.discard(client)
        client.close()

    def close(self) -> None:
        self._closed = True
        for client in list(self._clients):
            client.close()
        self._clients.clear()

    def _hello(self, *, resumed: bool) -> StreamEvent:
        return StreamEvent(
            kind="hello",
            module_id=None,
            data=Hello(
                server_time=self._clock(),
                instance=self._instance,
                resumed=resumed,
            ).model_dump_json(),
            retry=RETRY_MILLISECONDS,
        )

    def _replay_from(self, last_event_id: str | None) -> list[StreamEvent] | None:
        parsed = parse_event_id(last_event_id)
        if parsed is None:
            return None
        epoch, seq = parsed
        if epoch != self._epoch or seq > self._seq:
            return None
        oldest = self._ring[0].seq if self._ring else self._seq + 1
        if seq < oldest - 1:
            return None
        return [event for event in self._ring if event.seq > seq]

    def _offer_snapshots(self, client: Subscriber) -> None:
        wanted = sorted(
            id_ for id_ in client.entities if self._modules[id_].kind == "entities"
        )
        for index, module_id in enumerate(wanted):
            state = self._modules[module_id]
            if state.snapshot is None:
                state.snapshot = Snapshot(
                    module_id=module_id,
                    fetched_at=state.fetched_at,
                    version=state.version,
                    entities=list(state.rows.values()),
                ).model_dump_json()
            last = index == len(wanted) - 1
            client.offer(
                StreamEvent(
                    kind="snapshot",
                    module_id=module_id,
                    data=state.snapshot,
                    id=event_id(self._epoch, self._seq) if last else None,
                    seq=self._seq,
                ),
                enforce=False,
            )


def epoch_ms(moment: datetime | None) -> float:
    return 0.0 if moment is None else moment.timestamp() * 1000.0


def refresh_delay(failures: int) -> float:
    doublings = min(max(0, failures - 1), 8)
    return min(REFRESH_RETRY_CAP_SECONDS, REFRESH_RETRY_SECONDS * 2.0**doublings)
