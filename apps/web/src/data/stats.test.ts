import { describe, expect, it } from "vitest";
import { EMPTY_STATS, StatsTracker } from "./stats";

const base = { applyMs: { p50: 2, p95: 5 }, rows: 100, snapshots: 1 };

describe("StatsTracker", () => {
  it("shows nothing until it has two reports to compare", () => {
    const tracker = new StatsTracker();
    expect(tracker.view).toEqual(EMPTY_STATS);
    tracker.report({ ...base, bytes: 1000, frames: 2 }, 1000);
    expect(tracker.view.bytesPerSecond).toBe(0);
    expect(tracker.view.rows).toBe(100);
  });

  it("turns running totals into per second rates", () => {
    const tracker = new StatsTracker();
    tracker.report({ ...base, bytes: 1000, frames: 2 }, 1000);
    tracker.report({ ...base, bytes: 51_000, frames: 7 }, 3000);
    expect(tracker.view.bytesPerSecond).toBe(25_000);
    expect(tracker.view.framesPerSecond).toBe(2.5);
  });

  it("reports the hand-off time of patches as percentiles", () => {
    const tracker = new StatsTracker();
    for (const ms of [1, 2, 3, 4, 100]) tracker.transfer(ms);
    tracker.report({ ...base, bytes: 0, frames: 0 }, 1000);
    expect(tracker.view.transferMs.p50).toBe(3);
    expect(tracker.view.transferMs.p95).toBe(100);
  });

  it("never reports a negative hand-off", () => {
    const tracker = new StatsTracker();
    tracker.transfer(-5);
    tracker.report({ ...base, bytes: 0, frames: 0 }, 1000);
    expect(tracker.view.transferMs.p95).toBe(0);
  });

  it("reports how long the page spent on each message", () => {
    const tracker = new StatsTracker();
    for (const ms of [1, 2, 3, 4, 50]) tracker.page(ms);
    tracker.report({ ...base, bytes: 0, frames: 0 }, 1000);
    expect(tracker.view.pageMs.p50).toBe(3);
    expect(tracker.view.pageMs.p95).toBe(50);
  });
});
