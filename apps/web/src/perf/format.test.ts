import { describe, expect, test } from "vitest";
import {
  formatBusy,
  formatCount,
  formatLongTasks,
  formatMs,
  formatPair,
  hudRows,
} from "./format";
import { PerfMetrics } from "./metrics";

describe("formatting", () => {
  test("milliseconds have one decimal and a unit on pairs", () => {
    expect(formatMs(12.349)).toBe("12.3");
    expect(formatPair({ p50: 12.4, p95: 30.06 })).toBe("12.4 / 30.1 ms");
    expect(formatPair({ p50: 0, p95: 0 })).toBe("0.0 / 0.0 ms");
  });

  test("counts use thousands separators", () => {
    expect(formatCount(200000)).toBe("200,000");
    expect(formatCount(12.6)).toBe("13");
  });

  test("long tasks and busy share say n/a without support", () => {
    expect(formatLongTasks(null)).toBe("n/a");
    expect(formatBusy(null)).toBe("n/a");
    expect(formatLongTasks({ count: 0, worstMs: 0, totalMs: 0 })).toBe("0");
    expect(formatLongTasks({ count: 3, worstMs: 120.04, totalMs: 200 })).toBe(
      "3, worst 120.0 ms",
    );
    expect(formatBusy(0.4321)).toBe("43 %");
  });

  test("no row text uses the middle dot", () => {
    const metrics = new PerfMetrics({ now: () => 0, longTasks: true });
    const rows = hudRows(metrics.snapshot(), 1234, "canvas");
    expect(rows.map((row) => row.key)).toEqual([
      "fps",
      "draws",
      "frame",
      "draw",
      "step",
      "longtasks",
      "busy",
      "markers",
      "loaded",
      "renderer",
    ]);
    for (const row of rows) {
      expect(`${row.label}${row.value}`).not.toContain("·");
    }
    expect(rows.find((row) => row.key === "loaded")?.value).toBe("1,234");
    expect(rows.find((row) => row.key === "renderer")?.value).toBe("canvas");
  });
});
