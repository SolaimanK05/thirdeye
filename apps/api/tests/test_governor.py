from datetime import UTC, datetime, timedelta

import pytest

from thirdeye.config import Settings
from thirdeye.governor import (
    Fetched,
    Governor,
    GovernorSpec,
    RateLimited,
)

START = datetime(2026, 10, 26, 6, 0, tzinfo=UTC)


class FakeClock:
    def __init__(self, now: datetime = START) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += timedelta(seconds=seconds)


def governor(clock: FakeClock, **changes: float) -> Governor:
    options: dict[str, float] = {
        "budget": 3800,
        "cost": 4,
        "floor_seconds": 30,
        "cooldown_min_seconds": 30,
        "cooldown_max_seconds": 1800,
    }
    options |= changes
    return Governor(
        budget=int(options["budget"]),
        cost=int(options["cost"]),
        floor_seconds=options["floor_seconds"],
        cooldown_min_seconds=options["cooldown_min_seconds"],
        cooldown_max_seconds=options["cooldown_max_seconds"],
        clock=clock,
    )


def test_a_fresh_day_spreads_the_budget_over_the_seconds_left() -> None:
    clock = FakeClock(datetime(2026, 10, 26, 0, 0, tzinfo=UTC))
    delay = governor(clock).next_delay()
    assert delay == pytest.approx(86_400 / 950)


def test_spending_shrinks_the_budget_and_stretches_the_interval() -> None:
    clock = FakeClock()
    gov = governor(clock)
    before = gov.next_delay()
    for _ in range(100):
        gov.spend()
    assert gov.credits_left == 3800 - 400
    assert gov.next_delay() > before


def test_the_interval_never_drops_below_the_floor() -> None:
    clock = FakeClock(datetime(2026, 10, 26, 0, 0, tzinfo=UTC))
    gov = governor(clock, cost=1, floor_seconds=60)
    assert 86_400 / 3800 < 60
    assert gov.next_delay() == 60


def test_an_empty_budget_waits_for_midnight_utc() -> None:
    clock = FakeClock(datetime(2026, 10, 26, 22, 0, tzinfo=UTC))
    gov = governor(clock, budget=8)
    gov.spend()
    gov.spend()
    assert gov.credits_left == 0
    assert gov.next_delay() == pytest.approx(2 * 3600)


def test_the_budget_resets_when_the_utc_day_rolls_over() -> None:
    clock = FakeClock(datetime(2026, 10, 26, 23, 59, tzinfo=UTC))
    gov = governor(clock, budget=8)
    gov.spend()
    gov.spend()
    assert gov.credits_left == 0
    clock.advance(120)
    assert gov.credits_left == 8


def test_sync_corrects_a_budget_that_drifted_after_a_restart() -> None:
    gov = governor(FakeClock())
    gov.sync(remaining=2000)
    assert gov.credits_left == 1800


def test_sync_never_raises_the_budget() -> None:
    clock = FakeClock()
    gov = governor(clock, budget=100)
    for _ in range(10):
        gov.spend()
    gov.sync(remaining=4000)
    assert gov.credits_left == 60


def test_sync_below_the_reserve_leaves_nothing_to_spend() -> None:
    gov = governor(FakeClock())
    gov.sync(remaining=150)
    assert gov.credits_left == 0


def test_a_rate_limit_uses_the_retry_after_the_source_gave() -> None:
    clock = FakeClock()
    gov = governor(clock)
    until = gov.on_rate_limited(600)
    assert until == START + timedelta(seconds=600)
    assert gov.cooldown_until == until
    assert gov.next_delay() >= 600


def test_a_retry_after_is_clamped_to_the_window() -> None:
    clock = FakeClock()
    gov = governor(clock, cooldown_min_seconds=30, cooldown_max_seconds=1800)
    assert gov.on_rate_limited(1) == START + timedelta(seconds=30)
    assert gov.on_rate_limited(36_000) == START + timedelta(seconds=1800)


def test_a_rate_limit_without_a_retry_after_backs_off_exponentially() -> None:
    clock = FakeClock()
    gov = governor(clock)
    waits = []
    for _ in range(4):
        waits.append((gov.on_rate_limited(None) - clock()).total_seconds())
    assert waits == [30, 60, 120, 240]


def test_a_successful_call_ends_the_cooldown_and_the_streak() -> None:
    clock = FakeClock()
    gov = governor(clock)
    gov.on_rate_limited(None)
    gov.on_rate_limited(None)
    gov.spend()
    assert gov.cooldown_until is None
    assert (gov.on_rate_limited(None) - clock()).total_seconds() == 30


def test_the_cooldown_lapses_with_time() -> None:
    clock = FakeClock()
    gov = governor(clock)
    gov.on_rate_limited(60)
    clock.advance(61)
    assert gov.cooldown_until is None


def test_state_reports_what_health_shows() -> None:
    clock = FakeClock()
    gov = governor(clock)
    gov.spend()
    state = gov.state()
    assert state.credits_left == 3796
    assert state.cost == 4
    assert state.budget == 3800
    assert state.interval_seconds == round(gov.next_delay())
    assert state.cooldown_until is None


@pytest.mark.parametrize(
    "changes",
    [
        {"budget": 0},
        {"cost": 0},
        {"floor_seconds": -1},
        {"cooldown_min_seconds": 0},
        {"cooldown_min_seconds": 100, "cooldown_max_seconds": 10},
    ],
)
def test_nonsense_settings_are_refused(changes: dict[str, float]) -> None:
    with pytest.raises(ValueError):
        governor(FakeClock(), **changes)


def test_a_spec_builds_a_governor_from_settings() -> None:
    settings = Settings(
        database_url="postgresql://t:t@127.0.0.1:1/t",
        budget_opensky_credits_day=500,
        governor_cooldown_min_s=10,
        governor_cooldown_max_s=20,
        _env_file=None,
    )
    spec = GovernorSpec(
        budget=lambda s: s.budget_opensky_credits_day, cost=lambda s: 2, floor_seconds=5
    )
    gov = spec.build(settings, FakeClock())
    assert (gov.budget, gov.cost, gov.floor_seconds) == (500, 2, 5)
    assert gov.on_rate_limited(1) == START + timedelta(seconds=10)


def test_rate_limited_and_fetched_carry_what_the_worker_needs() -> None:
    assert RateLimited(12).retry_after == 12
    assert "wait 12" in str(RateLimited(12))
    assert RateLimited().retry_after is None
    assert Fetched(b"x", 5).remaining == 5
    assert Fetched(b"x").remaining is None
