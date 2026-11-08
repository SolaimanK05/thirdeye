"""Size and speed budgets for the binary frames (Phase 16 spec, section 2).

The thresholds are generous so a slow CI runner does not flake; the point is to
catch a change that makes a frame an order of magnitude bigger or slower.
"""

import time
from datetime import UTC, datetime, timedelta

from thirdeye.frames import SlotTable, compress, decode, profile_for
from thirdeye.movers import SyntheticFeed

ROWS = 50_000
SIZE_BUDGET_BYTES_PER_ROW = 24
ENCODE_BUDGET_SECONDS = 1.5
DECODE_BUDGET_SECONDS = 1.0


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 10, 14, 6, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        self.now += timedelta(seconds=1)
        return self.now


def fleet() -> tuple[SlotTable, SyntheticFeed]:
    feed = SyntheticFeed(ROWS, seed=3, period=3, clock=Clock())
    table = SlotTable(profile_for("synthetic"))
    rows, _, _ = feed.advance_sync()
    table.apply(rows, [])
    return table, feed


def test_a_delta_costs_at_most_24_compressed_bytes_per_changed_row() -> None:
    table, feed = fleet()
    rows, _, _ = feed.advance_sync()
    applied = table.apply(rows, [])
    delta = table.delta(applied, 2, 0.0)
    packed = compress(delta, "zstd")
    per_row = len(packed) / max(1, len(applied.changed))
    assert len(applied.changed) > ROWS // 4
    assert per_row <= SIZE_BUDGET_BYTES_PER_ROW, f"{per_row:.1f} bytes per row"


def test_a_snapshot_stays_under_the_json_cost_by_a_wide_margin() -> None:
    table, _ = fleet()
    packed = compress(table.snapshot(1, 0.0), "zstd")
    assert len(packed) / ROWS <= 40
    assert len(packed) < ROWS * 395 / 8


def test_encoding_fifty_thousand_rows_is_fast_enough_off_the_loop() -> None:
    feed = SyntheticFeed(ROWS, seed=3, period=1, clock=Clock())
    table = SlotTable(profile_for("synthetic"))
    rows, _, _ = feed.advance_sync()
    started = time.perf_counter()
    table.apply(rows, [])
    frame = table.snapshot(1, 0.0)
    compress(frame, "zstd")
    assert time.perf_counter() - started < ENCODE_BUDGET_SECONDS


def test_the_reference_decoder_handles_fifty_thousand_rows() -> None:
    table, _ = fleet()
    frame = table.snapshot(1, 0.0)
    started = time.perf_counter()
    decoded = decode(frame)
    assert decoded.rows == ROWS
    assert time.perf_counter() - started < DECODE_BUDGET_SECONDS
