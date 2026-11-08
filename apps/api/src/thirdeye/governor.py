from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from thirdeye.config import Settings

type Clock = Callable[[], datetime]

SYNC_RESERVE_CREDITS = 200
SECONDS_PER_DAY = 86_400


def utc_now() -> datetime:
    return datetime.now(UTC)


class RateLimited(Exception):
    def __init__(self, retry_after: float | None = None) -> None:
        super().__init__(
            "the source asked us to wait"
            if retry_after is None
            else f"the source asked us to wait {retry_after:g} s"
        )
        self.retry_after = retry_after


@dataclass(frozen=True, slots=True)
class Fetched:
    body: bytes
    remaining: int | None = None


@dataclass(frozen=True, slots=True)
class GovernorState:
    credits_left: int
    interval_seconds: int
    cost: int
    budget: int
    cooldown_until: datetime | None


class Governor:
    def __init__(
        self,
        *,
        budget: int,
        cost: int,
        floor_seconds: float,
        cooldown_min_seconds: float,
        cooldown_max_seconds: float,
        reserve: int = SYNC_RESERVE_CREDITS,
        clock: Clock = utc_now,
    ) -> None:
        if budget < 1 or cost < 1:
            raise ValueError("budget and cost must be at least 1")
        if floor_seconds < 0:
            raise ValueError("floor_seconds must not be negative")
        if not 0 < cooldown_min_seconds <= cooldown_max_seconds:
            raise ValueError("the cooldown window must satisfy 0 < min <= max")
        self.budget = budget
        self.cost = cost
        self.floor_seconds = floor_seconds
        self.cooldown_min_seconds = cooldown_min_seconds
        self.cooldown_max_seconds = cooldown_max_seconds
        self.reserve = reserve
        self.clock = clock
        self._day = clock().date()
        self._left = budget
        self._cooling_until: datetime | None = None
        self._rate_limited_in_a_row = 0

    def _roll(self, now: datetime) -> None:
        if now.date() != self._day:
            self._day = now.date()
            self._left = self.budget

    @property
    def credits_left(self) -> int:
        self._roll(self.clock())
        return self._left

    @property
    def cooldown_until(self) -> datetime | None:
        until = self._cooling_until
        if until is not None and until <= self.clock():
            return None
        return until

    def spend(self) -> None:
        self._roll(self.clock())
        self._left = max(0, self._left - self.cost)
        self._rate_limited_in_a_row = 0
        self._cooling_until = None

    def sync(self, remaining: int) -> None:
        self._roll(self.clock())
        self._left = min(self._left, max(0, remaining - self.reserve))

    def on_rate_limited(self, retry_after: float | None) -> datetime:
        now = self.clock()
        self._rate_limited_in_a_row += 1
        if retry_after is None:
            wait = self.cooldown_min_seconds * 2 ** (self._rate_limited_in_a_row - 1)
        else:
            wait = retry_after
        wait = min(self.cooldown_max_seconds, max(self.cooldown_min_seconds, wait))
        self._cooling_until = now + timedelta(seconds=wait)
        return self._cooling_until

    def seconds_to_midnight(self, now: datetime) -> float:
        midnight = datetime.combine(
            now.date() + timedelta(days=1), datetime.min.time(), tzinfo=UTC
        )
        return (midnight - now).total_seconds()

    def next_delay(self) -> float:
        now = self.clock()
        self._roll(now)
        calls_left = self._left // self.cost
        until_midnight = self.seconds_to_midnight(now)
        if calls_left <= 0:
            delay = until_midnight
        else:
            delay = max(self.floor_seconds, until_midnight / calls_left)
        cooling = self._cooling_until
        if cooling is not None and cooling > now:
            delay = max(delay, (cooling - now).total_seconds())
        return delay

    def state(self) -> GovernorState:
        return GovernorState(
            credits_left=self.credits_left,
            interval_seconds=round(self.next_delay()),
            cost=self.cost,
            budget=self.budget,
            cooldown_until=self.cooldown_until,
        )


@dataclass(frozen=True, slots=True)
class GovernorSpec:
    budget: Callable[[Settings], int]
    cost: Callable[[Settings], int]
    floor_seconds: float

    def build(self, settings: Settings, clock: Clock = utc_now) -> Governor:
        return Governor(
            budget=self.budget(settings),
            cost=self.cost(settings),
            floor_seconds=self.floor_seconds,
            cooldown_min_seconds=settings.governor_cooldown_min_s,
            cooldown_max_seconds=settings.governor_cooldown_max_s,
            clock=clock,
        )
