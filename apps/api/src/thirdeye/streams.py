import asyncio
import random
from collections import deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from thirdeye.config import Settings
from thirdeye.db import Pool

RECONNECT_FLOOR_SECONDS = 1.0
RECONNECT_CAP_SECONDS = 60.0
MAX_DOUBLINGS = 16

type Stop = asyncio.Event
type StreamRunner = Callable[[Pool, Settings, Stop], Awaitable[None]]
type FrameSink = Callable[[bytes], None]


@dataclass(frozen=True, slots=True)
class Connected:
    pass


@dataclass(frozen=True, slots=True)
class Disconnected:
    reason: str
    failures: int
    retry_in: float


type LinkEvent = Connected | Disconnected
type LinkReport = Callable[[LinkEvent], None]
type FrameReader = Callable[[Settings, Stop, FrameSink, LinkReport], Awaitable[None]]


@dataclass(frozen=True, slots=True)
class StreamTuning:
    batch_seconds: float
    queue_max: int


type Tune = Callable[[Settings], StreamTuning]


def reconnect_delay(
    failures: int,
    rng: Callable[[], float] = random.random,
    *,
    floor: float = RECONNECT_FLOOR_SECONDS,
    cap: float = RECONNECT_CAP_SECONDS,
) -> float:
    doublings = min(max(0, failures - 1), MAX_DOUBLINGS)
    ceiling = min(cap, floor * 2.0**doublings)
    return max(floor, rng() * ceiling)


class FrameBuffer:
    def __init__(self, capacity: int) -> None:
        if capacity < 1:
            raise ValueError("capacity must be at least 1")
        self.capacity = capacity
        self._frames: deque[bytes] = deque()
        self._dropped = 0

    def __len__(self) -> int:
        return len(self._frames)

    def push(self, frame: bytes) -> None:
        if len(self._frames) >= self.capacity:
            self._frames.popleft()
            self._dropped += 1
        self._frames.append(frame)

    def take(self) -> list[bytes]:
        frames = list(self._frames)
        self._frames.clear()
        return frames

    def take_dropped(self) -> int:
        dropped, self._dropped = self._dropped, 0
        return dropped


async def wait_for_stop(stop: Stop, seconds: float) -> bool:
    try:
        await asyncio.wait_for(stop.wait(), timeout=seconds)
    except TimeoutError:
        return False
    return True
