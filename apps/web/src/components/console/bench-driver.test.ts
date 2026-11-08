import { afterEach, describe, expect, test } from "vitest";
import { perfMetrics } from "@/perf/metrics";
import { BENCH_ID, BenchDriver, type FrameScheduler } from "./bench-driver";
import { segmentLength } from "./gpu/segment-math";
import {
  type LayerOptions,
  type Marker,
  type OverlayPort,
  SEGMENT_STRIDE,
  SEGMENT_T0,
  SEGMENT_T1,
  type SegmentUpdate,
} from "./markers";
import { DIRTY_BLOCK } from "./renderer";

type Call =
  | { kind: "layer"; markers: readonly Marker[]; options?: LayerOptions }
  | { kind: "remove" }
  | { kind: "positions"; data: Float64Array }
  | { kind: "invalidate" };

function setup() {
  const calls: Call[] = [];
  const overlay: OverlayPort = {
    setLayer: (id, markers, _stale, _sizing, options) => {
      expect(id).toBe(BENCH_ID);
      calls.push({ kind: "layer", markers, options });
    },
    removeLayer: (id) => {
      expect(id).toBe(BENCH_ID);
      calls.push({ kind: "remove" });
    },
    setPositions: (id, data) => {
      expect(id).toBe(BENCH_ID);
      calls.push({ kind: "positions", data });
    },
    invalidate: () => calls.push({ kind: "invalidate" }),
  };
  let time = 0;
  const pending = new Map<number, () => void>();
  let next = 1;
  const frames: FrameScheduler = {
    request: (callback) => {
      const handle = next++;
      pending.set(handle, callback);
      return handle;
    },
    cancel: (handle) => {
      pending.delete(handle);
    },
  };
  const frame = (advance: number) => {
    time += advance;
    const due = [...pending.entries()];
    pending.clear();
    for (const [, callback] of due) callback();
  };
  return {
    calls,
    overlay,
    frames,
    clock: () => time,
    frame,
    pending,
  };
}

afterEach(() => {
  perfMetrics.disable();
});

describe("BenchDriver", () => {
  test("start creates one unpickable, unreported layer and writes positions", () => {
    const rig = setup();
    const driver = new BenchDriver(rig.overlay, 100, rig.clock, rig.frames);
    driver.start();
    const layer = rig.calls.find((call) => call.kind === "layer");
    expect(layer?.kind === "layer" && layer.markers).toHaveLength(100);
    expect(layer?.kind === "layer" && layer.options).toEqual({
      pickable: false,
      reported: false,
    });
    expect(rig.calls.map((call) => call.kind)).toEqual([
      "layer",
      "positions",
      "invalidate",
    ]);
    driver.destroy();
  });

  test("markers use the agreed sizes and leave labels empty", () => {
    const rig = setup();
    const driver = new BenchDriver(rig.overlay, 2000, rig.clock, rig.frames);
    driver.start();
    const layer = rig.calls[0];
    if (layer.kind !== "layer") throw new Error("expected a layer");
    for (const marker of layer.markers) {
      expect(marker.size).toBe(marker.glyph === "dot" ? 3 : 10);
      expect(marker.label).toBe("");
      expect(marker.tone).toBe("default");
      expect(marker.adaptive).toBe(true);
      expect(marker.entity).toBe(false);
      expect(marker.id).toMatch(/^bench-\d+$/);
    }
    driver.destroy();
  });

  test("ticks are throttled to 12 Hz", () => {
    const rig = setup();
    const driver = new BenchDriver(rig.overlay, 50, rig.clock, rig.frames);
    driver.start();
    const writes = () =>
      rig.calls.filter((call) => call.kind === "positions").length;
    expect(writes()).toBe(1);
    rig.frame(16);
    rig.frame(16);
    rig.frame(16);
    expect(writes()).toBe(1);
    rig.frame(40);
    expect(writes()).toBe(2);
    for (let i = 0; i < 60; i++) rig.frame(16.67);
    expect(writes()).toBeLessThanOrEqual(2 + 13);
    expect(writes()).toBeGreaterThan(8);
    driver.destroy();
  });

  test("the position buffer is reused and moves over time", () => {
    const rig = setup();
    const driver = new BenchDriver(rig.overlay, 50, rig.clock, rig.frames);
    driver.start();
    rig.frame(100);
    rig.frame(100_000);
    const writes = rig.calls.filter((call) => call.kind === "positions");
    expect(writes.length).toBe(3);
    const [first, , last] = writes;
    if (first.kind !== "positions" || last.kind !== "positions") return;
    expect(last.data).toBe(first.data);
    expect(last.data.length).toBe(50 * 4);
    driver.destroy();
  });

  test("destroy removes the layer and stops scheduling", () => {
    const rig = setup();
    const driver = new BenchDriver(rig.overlay, 10, rig.clock, rig.frames);
    driver.start();
    expect(rig.pending.size).toBe(1);
    driver.destroy();
    expect(rig.pending.size).toBe(0);
    expect(rig.calls.at(-1)).toEqual({ kind: "remove" });
    const before = rig.calls.length;
    rig.frame(1000);
    expect(rig.calls.length).toBe(before);
    driver.destroy();
    expect(rig.calls.length).toBe(before);
  });

  test("a count of zero does nothing", () => {
    const rig = setup();
    const driver = new BenchDriver(rig.overlay, 0, rig.clock, rig.frames);
    driver.start();
    expect(rig.calls).toEqual([]);
    expect(rig.pending.size).toBe(0);
    driver.destroy();
  });

  test("starting twice does not duplicate the layer", () => {
    const rig = setup();
    const driver = new BenchDriver(rig.overlay, 10, rig.clock, rig.frames);
    driver.start();
    driver.start();
    expect(rig.calls.filter((call) => call.kind === "layer")).toHaveLength(1);
    driver.destroy();
  });

  test("each tick feeds the step timing", () => {
    const rig = setup();
    perfMetrics.enable(false);
    let time = 0;
    const clock = () => {
      time += 2;
      return time;
    };
    const driver = new BenchDriver(rig.overlay, 10, clock, rig.frames);
    driver.start();
    expect(perfMetrics.snapshot().stepMs).toEqual({ p50: 2, p95: 2 });
    driver.destroy();
  });
});

describe("BenchDriver with segments", () => {
  type Written = { rows: number[] | null; count: number; data: Float64Array };

  function segmentSetup(count: number, readCost = 0) {
    const rig = setup();
    const written: Written[] = [];
    let enabled = true;
    const overlay: OverlayPort = {
      ...rig.overlay,
      setSegments: (id, update: SegmentUpdate) => {
        expect(id).toBe(BENCH_ID);
        written.push({
          rows:
            update.rows === null
              ? null
              : [...update.rows.slice(0, update.count)],
          count: update.count,
          data: Float64Array.from(update.data),
        });
      },
      segmentMotion: () => enabled,
    };
    let server = 1_800_000_000_000;
    let drift = 0;
    const driver = new BenchDriver(
      overlay,
      count,
      () => {
        drift += readCost;
        return rig.clock() + drift;
      },
      rig.frames,
      () => server,
    );
    return {
      ...rig,
      driver,
      written,
      disable: () => {
        enabled = false;
      },
      advance: (seconds: number) => {
        server += seconds * 1000;
      },
      server: () => server / 1000,
    };
  }

  test("the first tick writes every segment in one full update and no positions", () => {
    const rig = segmentSetup(2000);
    rig.driver.start();
    expect(rig.written).toHaveLength(1);
    expect(rig.written[0].rows).toBeNull();
    expect(rig.written[0].count).toBe(2000);
    expect(rig.calls.some((call) => call.kind === "positions")).toBe(false);
    rig.driver.destroy();
  });

  test("blocks start with different lengths so their refreshes spread out", () => {
    const rig = segmentSetup(2000);
    rig.driver.start();
    const [first] = rig.written;
    const ends = new Set<number>();
    for (let block = 0; block * DIRTY_BLOCK < 2000; block++) {
      const at = block * DIRTY_BLOCK * SEGMENT_STRIDE;
      const length = first.data[at + SEGMENT_T1] - first.data[at + SEGMENT_T0];
      expect(length).toBeGreaterThan(0);
      expect(length).toBeLessThanOrEqual(segmentLength(block * DIRTY_BLOCK));
      ends.add(first.data[at + SEGMENT_T1]);
    }
    expect(ends.size).toBe(8);
    rig.driver.destroy();
  });

  test("a tick with nothing expired writes nothing", () => {
    const rig = segmentSetup(2000);
    rig.driver.start();
    rig.frame(100);
    expect(rig.written).toHaveLength(1);
    rig.driver.destroy();
  });

  test("an expired block is rewritten from where it ended and nothing else is", () => {
    const rig = segmentSetup(2000);
    rig.driver.start();
    const [first] = rig.written;
    const endOfBlock0 = first.data[SEGMENT_T1];
    const earliest = Math.min(
      ...Array.from(
        { length: 8 },
        (_, block) =>
          first.data[block * DIRTY_BLOCK * SEGMENT_STRIDE + SEGMENT_T1],
      ),
    );
    rig.advance(earliest - rig.server() + 0.3);
    rig.frame(100);
    const next = rig.written.at(-1);
    expect(rig.written).toHaveLength(2);
    expect(next?.rows).not.toBeNull();
    expect(next?.count).toBe(next?.rows?.length);
    const expired = new Set(
      Array.from({ length: 8 }, (_, block) => block).filter(
        (block) =>
          first.data[block * DIRTY_BLOCK * SEGMENT_STRIDE + SEGMENT_T1] <=
          rig.server(),
      ),
    );
    for (const row of next?.rows ?? []) {
      expect(expired.has(Math.floor(row / DIRTY_BLOCK))).toBe(true);
    }
    const row = next?.rows?.[0] ?? 0;
    expect(next?.data[row * SEGMENT_STRIDE + SEGMENT_T0]).toBe(
      first.data[row * SEGMENT_STRIDE + SEGMENT_T1],
    );
    expect(endOfBlock0).toBeGreaterThan(0);
    rig.driver.destroy();
  });

  test("after a long stall the refresh starts from the present", () => {
    const rig = segmentSetup(300);
    rig.driver.start();
    rig.advance(120);
    rig.frame(100);
    const next = rig.written.at(-1);
    expect(next?.data[SEGMENT_T0]).toBe(rig.server());
    rig.driver.destroy();
  });

  test("a stall that expires every block is refreshed in budgeted slices", () => {
    const rig = segmentSetup(2000, 3);
    rig.driver.start();
    rig.advance(120);
    const before = rig.written.length;
    rig.frame(100);
    const slice = rig.written.at(-1);
    expect(rig.written).toHaveLength(before + 1);
    expect(slice?.count).toBeGreaterThan(0);
    expect(slice?.count).toBeLessThan(2000);
    const seen = new Set<number>();
    for (const row of slice?.rows ?? [])
      seen.add(Math.floor(row / DIRTY_BLOCK));
    for (let i = 0; i < 20; i++) {
      rig.frame(100);
      for (const row of rig.written.at(-1)?.rows ?? []) {
        seen.add(Math.floor(row / DIRTY_BLOCK));
      }
    }
    expect(seen.size).toBe(8);
    rig.driver.destroy();
  });

  test("falls back to positions when the overlay stops doing segments", () => {
    const rig = segmentSetup(100);
    rig.driver.start();
    rig.disable();
    rig.frame(100);
    expect(rig.calls.filter((call) => call.kind === "positions")).toHaveLength(
      1,
    );
    expect(rig.written).toHaveLength(1);
    rig.driver.destroy();
  });

  test("destroy forgets the buffers", () => {
    const rig = segmentSetup(100);
    rig.driver.start();
    rig.driver.destroy();
    expect(rig.calls.at(-1)).toEqual({ kind: "remove" });
    const count = rig.written.length;
    rig.advance(100);
    rig.frame(1000);
    expect(rig.written).toHaveLength(count);
  });
});
