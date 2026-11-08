"""Per-module frame history served by the movers endpoints, and the synthetic feed."""

import asyncio
import math
import random
import threading
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Final, Protocol

from thirdeye.frames import (
    Applied,
    SlotTable,
    compress,
    profile_for,
)
from thirdeye.layers import EntityRow
from thirdeye.ontology import EntityKind

RETAIN_FRAMES: Final = 64
RETAIN_BYTES: Final = 16 * 1024 * 1024
RETAIN_VARIANTS: Final = 8

SYNTHETIC_ID: Final = "synthetic"


@dataclass(frozen=True, slots=True)
class FrameBody:
    version: int
    slot_epoch: int
    encoding: str
    body: bytes
    immutable: bool


@dataclass(slots=True)
class ModuleFrames:
    table: SlotTable
    version: int = 0
    fetched_ms: float = 0.0
    deltas: OrderedDict[int, bytes] = field(default_factory=OrderedDict)
    snapshot: tuple[int, bytes] | None = None
    variants: OrderedDict[tuple[str, int, str], bytes] = field(
        default_factory=OrderedDict
    )
    retained: int = 0
    guard: threading.Lock = field(default_factory=threading.Lock)

    @classmethod
    def for_module(cls, module_id: str) -> ModuleFrames:
        return cls(SlotTable(profile_for(module_id)))

    @property
    def slot_epoch(self) -> int:
        return self.table.slot_epoch

    def load(self, rows: list[EntityRow], version: int, fetched_ms: float) -> None:
        self.table = SlotTable(self.table.profile, self.table.slot_epoch + 1)
        self.table.apply(rows, ())
        self.version = version
        self.fetched_ms = fetched_ms
        self.reset()

    def reset(self) -> None:
        self.deltas.clear()
        with self.guard:
            self.variants.clear()
        self.snapshot = None
        self.retained = 0

    def advance(
        self,
        upserts: list[EntityRow],
        removes: list[str],
        version: int,
        fetched_ms: float,
    ) -> None:
        applied: Applied = self.table.apply(upserts, removes)
        self.version = version
        self.fetched_ms = fetched_ms
        self.snapshot = None
        if applied.compacted:
            self.table.compact()
            self.reset()
            return
        frame = self.table.delta(applied, version, fetched_ms)
        self.deltas[version] = frame
        self.retained += len(frame)
        while len(self.deltas) > 1 and (
            len(self.deltas) > RETAIN_FRAMES or self.retained > RETAIN_BYTES
        ):
            old, dropped = self.deltas.popitem(last=False)
            self.retained -= len(dropped)
            with self.guard:
                for key in [
                    k for k in self.variants if k[0] == "delta" and k[1] == old
                ]:
                    del self.variants[key]

    def snapshot_frame(self) -> tuple[int, bytes]:
        if self.snapshot is None or self.snapshot[0] != self.version:
            self.snapshot = (
                self.version,
                self.table.snapshot(self.version, self.fetched_ms),
            )
        return self.snapshot

    def delta_frame(self, version: int, slot_epoch: int) -> bytes | None:
        if slot_epoch != self.slot_epoch:
            return None
        return self.deltas.get(version)

    def variant(self, kind: str, version: int, encoding: str, raw: bytes) -> bytes:
        key = (kind, version, encoding)
        with self.guard:
            cached = self.variants.get(key)
            if cached is not None:
                self.variants.move_to_end(key)
                return cached
        packed = compress(raw, encoding)
        with self.guard:
            self.variants[key] = packed
            snapshots = [k for k in self.variants if k[0] == "snapshot"]
            for stale in snapshots[:-RETAIN_VARIANTS]:
                del self.variants[stale]
        return packed


class MoverSource(Protocol):
    async def advance(self) -> tuple[list[EntityRow], list[str], datetime]: ...


class SyntheticFeed:
    """Deterministic fleet of movers on straight tracks, for tests and benches.

    Every mover reports once per `period` ticks; each tick moves one slice of
    the fleet, so a version carries about count / period changed rows.
    """

    def __init__(
        self,
        count: int,
        *,
        seed: int = 1,
        period: int = 5,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        rng = random.Random(seed)
        self._count = count
        self._period = max(1, period)
        self._clock = clock
        self._tick = 0
        self._lon = [rng.uniform(-180.0, 180.0) for _ in range(count)]
        self._lat = [rng.uniform(-75.0, 75.0) for _ in range(count)]
        self._speed = [rng.uniform(5.0, 250.0) for _ in range(count)]
        self._course = [rng.uniform(0.0, 360.0) for _ in range(count)]
        self._seen = [self._clock()] * count

    def row(self, index: int, now: datetime) -> EntityRow:
        return EntityRow(
            id=f"synthetic-{index:07d}",
            kind=EntityKind.AIRCRAFT,
            name=f"SYN{index:07d}",
            lon=self._lon[index],
            lat=self._lat[index],
            t=now,
            sog=self._speed[index],
            cog=self._course[index],
            heading=self._course[index],
            alt=self._speed[index] * 40.0,
            confidence="observed",
            attrs={},
        )

    def step(self, index: int, now: datetime) -> None:
        seconds = (now - self._seen[index]).total_seconds()
        self._seen[index] = now
        course = math.radians(self._course[index])
        metres = self._speed[index] * seconds
        lat = self._lat[index] + math.degrees(math.cos(course) * metres / 6_371_000.0)
        scale = max(0.05, math.cos(math.radians(lat)))
        lon = self._lon[index] + math.degrees(
            math.sin(course) * metres / (6_371_000.0 * scale)
        )
        if abs(lat) > 80.0:
            self._course[index] = (self._course[index] + 180.0) % 360.0
            lat = math.copysign(80.0, lat)
        self._lat[index] = lat
        self._lon[index] = ((lon + 180.0) % 360.0) - 180.0

    def advance_sync(self) -> tuple[list[EntityRow], list[str], datetime]:
        now = self._clock().replace(microsecond=0)
        if self._tick == 0:
            self._seen = [now] * self._count
            rows = [self.row(i, now) for i in range(self._count)]
        else:
            due = range(self._tick % self._period, self._count, self._period)
            for index in due:
                self.step(index, now)
            rows = [self.row(i, now) for i in due]
        self._tick += 1
        return rows, [], now

    async def advance(self) -> tuple[list[EntityRow], list[str], datetime]:
        return await asyncio.to_thread(self.advance_sync)
