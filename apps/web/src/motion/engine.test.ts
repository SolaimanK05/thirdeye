import { describe, expect, test, vi } from "vitest";
import type { EntityRow } from "@/api/client";
import type { Marker } from "@/components/console/markers";
import type { EntityChange } from "@/state/entities";
import {
  GROW_BELOW_PX,
  MAX_SKIP,
  MotionEngine,
  type MotionTarget,
  nextSkip,
  OFFSCREEN_EVERY,
  SHRINK_ABOVE_PX,
  STRIDE,
  TARGET_SHIFT_PX,
} from "./engine";
import { EXTRAPOLATION_CAP_SECONDS } from "./interpolate";
import { METRES_PER_KNOT } from "./sphere";

const T0 = Date.parse("2026-10-26T10:00:00Z");
const DELAY = 100;
const DEGREE_METRES = 111_194.9266;

function row(
  id: string,
  seconds: number,
  lon: number,
  extra: Partial<EntityRow> = {},
): EntityRow {
  return {
    id,
    kind: "aircraft",
    name: id,
    lon,
    lat: 0,
    t: new Date(T0 + seconds * 1000).toISOString(),
    sog: null,
    cog: null,
    heading: null,
    alt: null,
    confidence: "observed",
    attrs: {},
    ...extra,
  };
}

function marker(id: string): Marker {
  return {
    id,
    lon: 0,
    lat: 0,
    glyph: "plane",
    size: 10,
    tone: "default",
    label: id,
    entity: true,
  };
}

function change(
  rows: EntityRow[],
  extra: Partial<EntityChange> = {},
): EntityChange {
  return {
    moduleId: "aircraft",
    upserts: rows,
    removes: [],
    reset: false,
    ...extra,
  };
}

function setup(ids: string[] = ["a"]) {
  let now = T0 + 1000 * 1000;
  const layers = new Map<string, readonly Marker[]>([
    ["aircraft", ids.map(marker)],
  ]);
  const visible = new Set(["aircraft"]);
  const written: Float64Array[] = [];
  const target: MotionTarget = {
    markers: (moduleId) => layers.get(moduleId),
    isVisible: (moduleId) => visible.has(moduleId),
    setPositions: vi.fn((_moduleId, data) => {
      written.push(Float64Array.from(data));
    }),
    invalidate: vi.fn(),
  };
  const onMode = vi.fn();
  const engine = new MotionEngine({ target, clock: () => now, onMode });
  engine.setMovers(new Map([["aircraft", DELAY]]));
  return {
    engine,
    target,
    onMode,
    written,
    layers,
    visible,
    setNow: (seconds: number) => {
      now = T0 + seconds * 1000;
    },
  };
}

describe("feeding the history", () => {
  test("records fixes for mover modules only", () => {
    const { engine } = setup();
    expect(engine.ingest(change([row("a", 0, 1)]))).toBe(true);
    expect(engine.history.get("a")).toHaveLength(1);
    expect(
      engine.ingest({ ...change([row("p", 0, 1)]), moduleId: "ports" }),
    ).toBe(false);
    expect(engine.history.get("p")).toBeUndefined();
  });

  test("skips rows whose time cannot be read", () => {
    const { engine } = setup();
    engine.ingest(change([row("a", 0, 1, { t: "later" })]));
    expect(engine.history.get("a")).toBeUndefined();
  });

  test("forgets removed entities", () => {
    const { engine } = setup();
    engine.ingest(change([row("a", 0, 1), row("b", 0, 2)]));
    engine.ingest(change([], { removes: ["a"] }));
    expect(engine.history.get("a")).toBeUndefined();
    expect(engine.history.get("b")).toBeDefined();
  });

  test("a reset keeps only the entities in it, and their older fixes", () => {
    const { engine } = setup();
    engine.ingest(change([row("a", 0, 1), row("b", 0, 2)]));
    engine.ingest(change([row("a", 90, 2)], { reset: true }));
    expect(engine.history.get("b")).toBeUndefined();
    expect(engine.history.get("a")).toHaveLength(2);
  });

  test("duplicate and out-of-order fixes do not disturb the order", () => {
    const { engine } = setup();
    engine.ingest(change([row("a", 90, 2)]));
    engine.ingest(change([row("a", 0, 1)]));
    engine.ingest(change([row("a", 90, 2)]));
    expect(engine.history.get("a")?.map((fix) => fix.lon)).toEqual([1, 2]);
  });
});

describe("stepping", () => {
  test("renders a point inside the delay behind the clock", () => {
    const { engine, written, setNow } = setup();
    engine.ingest(change([row("a", 0, 0), row("a", 100, 10)]));
    setNow(150);
    expect(engine.step()).toBe(true);
    expect(written).toHaveLength(1);
    expect(written[0][0]).toBeCloseTo(5, 5);
    expect(written[0][1]).toBeCloseTo(0, 9);
    expect(written[0][3]).toBe(0);
    expect(written[0]).toHaveLength(STRIDE);
  });

  test("moves a little on each step as the clock advances", () => {
    const { engine, written, setNow } = setup();
    engine.ingest(change([row("a", 0, 0), row("a", 100, 10)]));
    setNow(150);
    engine.step();
    setNow(160);
    engine.step();
    expect(written).toHaveLength(2);
    expect(written[1][0]).toBeGreaterThan(written[0][0]);
  });

  test("does nothing when nothing has changed", () => {
    const { engine, target, written, setNow } = setup();
    engine.ingest(change([row("a", 0, 1)]));
    setNow(5000);
    expect(engine.step()).toBe(true);
    const invalidations = vi.mocked(target.invalidate).mock.calls.length;
    expect(engine.step()).toBe(false);
    expect(written).toHaveLength(1);
    expect(vi.mocked(target.invalidate).mock.calls.length).toBe(invalidations);
  });

  test("asks for a redraw only when something moved", () => {
    const { engine, target, setNow } = setup();
    engine.ingest(change([row("a", 0, 0, { sog: 400, cog: 90 })]));
    setNow(150);
    engine.step();
    expect(target.invalidate).toHaveBeenCalledTimes(1);
  });

  test("an entity with no history keeps its own position", () => {
    const { engine, written } = setup(["a", "unknown"]);
    engine.ingest(change([row("a", 0, 1)]));
    engine.step();
    expect(Number.isNaN(written[0][STRIDE])).toBe(true);
    expect(Number.isNaN(written[0][STRIDE + 1])).toBe(true);
    expect(written[0][STRIDE + 3]).toBe(0);
  });

  test("a hidden module is left alone", () => {
    const { engine, target, visible } = setup();
    engine.ingest(change([row("a", 0, 1, { sog: 400, cog: 90 })]));
    visible.delete("aircraft");
    expect(engine.step()).toBe(false);
    expect(target.setPositions).not.toHaveBeenCalled();
  });

  test("a module that is not a mover is left alone", () => {
    const { engine, target, layers } = setup();
    layers.set("ports", [marker("p")]);
    engine.step();
    expect(
      vi
        .mocked(target.setPositions)
        .mock.calls.every(([id]) => id === "aircraft"),
    ).toBe(true);
  });

  test("marks entities stale beyond the extrapolation cap", () => {
    const { engine, written, setNow } = setup();
    engine.ingest(change([row("a", 0, 0, { sog: 400, cog: 90 })]));
    setNow(DELAY + EXTRAPOLATION_CAP_SECONDS + 10);
    engine.step();
    expect(written[0][3]).toBe(1);
  });

  test("extrapolates a lone fix along its course", () => {
    const { engine, written, setNow } = setup();
    engine.ingest(change([row("a", 0, 0, { sog: 360, cog: 90 })]));
    setNow(DELAY + 60);
    engine.step();
    const metres = 360 * METRES_PER_KNOT * 60;
    expect(written[0][0]).toBeCloseTo(metres / DEGREE_METRES, 3);
  });
});

describe("the heading shown", () => {
  test("starts on the target and then turns no faster than the cap", () => {
    const { engine, written, setNow } = setup();
    engine.ingest(change([row("a", 0, 0, { sog: 400, cog: 90 })]));
    setNow(DELAY + 10);
    engine.step();
    expect(written[0][2]).toBeCloseTo(90, 6);
    engine.ingest(change([row("a", 10, 1, { sog: 400, cog: 270 })]));
    setNow(DELAY + 10.1);
    engine.step();
    const turned = written[1]?.[2] ?? written[0][2];
    expect(Math.abs(turned - 90)).toBeLessThan(20);
  });

  test("has no heading when nothing says which way it points", () => {
    const { engine, written } = setup();
    engine.ingest(change([row("a", 0, 0)]));
    engine.step();
    expect(Number.isNaN(written[0][2])).toBe(true);
  });
});

describe("work for markers off the screen", () => {
  function crowd(onScreen: Uint8Array | undefined) {
    const ids = Array.from({ length: 24 }, (_, i) => `p${i}`);
    const harness = setup(ids);
    harness.target.onScreen = () => onScreen;
    harness.engine.ingest(
      change(ids.map((id, i) => row(id, 0, i, { sog: 400, cog: 90 }))),
    );
    return { ...harness, ids };
  }

  function updated(before: Float64Array, after: Float64Array): number[] {
    const indexes: number[] = [];
    for (let i = 0; i < before.length / STRIDE; i++) {
      if (before[i * STRIDE] !== after[i * STRIDE]) indexes.push(i);
    }
    return indexes;
  }

  test("markers on the screen move on every step", () => {
    const onScreen = new Uint8Array(24).fill(1);
    const { engine, written, setNow } = crowd(onScreen);
    setNow(150);
    engine.step();
    setNow(150.5);
    engine.step();
    expect(updated(written[0], written[1])).toHaveLength(24);
  });

  test("markers off the screen are only brought up to date now and then", () => {
    const { engine, written, setNow } = crowd(new Uint8Array(24));
    setNow(150);
    engine.step();
    setNow(150.5);
    engine.step();
    const moved = updated(written[0], written[1]);
    expect(moved.length).toBeGreaterThan(0);
    expect(moved.length).toBeLessThanOrEqual(24 / OFFSCREEN_EVERY + 1);
  });

  test("every off-screen marker is refreshed within a full round of steps", () => {
    const { engine, written, setNow } = crowd(new Uint8Array(24));
    setNow(150);
    engine.step();
    const first = Float64Array.from(written[written.length - 1]);
    const seen = new Set<number>();
    for (let step = 1; step <= OFFSCREEN_EVERY; step++) {
      setNow(150 + step);
      engine.step();
      const latest = written[written.length - 1];
      for (const i of updated(first, latest)) seen.add(i);
    }
    expect(seen.size).toBe(24);
  });

  test("a layer that has not been drawn yet is brought fully up to date", () => {
    const { engine, written, setNow } = crowd(undefined);
    setNow(150);
    engine.step();
    setNow(150.5);
    engine.step();
    expect(updated(written[0], written[1])).toHaveLength(24);
  });

  test("applying a rebuilt layer always covers every marker", () => {
    const { engine, written, setNow } = crowd(new Uint8Array(24));
    setNow(150);
    engine.apply("aircraft");
    expect(
      written[0].every(
        (_, i) => i % STRIDE > 1 || !Number.isNaN(written[0][i]),
      ),
    ).toBe(true);
    expect(written[0]).toHaveLength(24 * STRIDE);
  });

  test("the mode still counts markers that were skipped", () => {
    const { engine, onMode, setNow } = crowd(new Uint8Array(24));
    setNow(150);
    engine.apply("aircraft");
    engine.step();
    expect(onMode).toHaveBeenLastCalledWith("aircraft", "extrapolated");
  });
});

describe("applying a rebuilt layer", () => {
  test("pushes positions even when they have not changed", () => {
    const { engine, target, setNow } = setup();
    engine.ingest(change([row("a", 0, 1)]));
    setNow(5000);
    engine.step();
    expect(engine.apply("aircraft")).toBe(true);
    expect(target.setPositions).toHaveBeenCalledTimes(2);
  });

  test("does not ask for a redraw by itself", () => {
    const { engine, target } = setup();
    engine.ingest(change([row("a", 0, 1)]));
    engine.apply("aircraft");
    expect(target.invalidate).not.toHaveBeenCalled();
  });
});

describe("reporting the mode", () => {
  test("says interpolated while fixes bracket the render time", () => {
    const { engine, onMode, setNow } = setup();
    engine.ingest(change([row("a", 0, 0), row("a", 100, 10)]));
    setNow(150);
    engine.step();
    expect(onMode).toHaveBeenCalledWith("aircraft", "interpolated");
  });

  test("says extrapolated once most entities are past their last fix", () => {
    const { engine, onMode, setNow } = setup(["a", "b"]);
    engine.ingest(
      change([
        row("a", 0, 0, { sog: 400, cog: 90 }),
        row("b", 0, 5, { sog: 400, cog: 90 }),
      ]),
    );
    setNow(DELAY + 50);
    engine.step();
    expect(onMode).toHaveBeenLastCalledWith("aircraft", "extrapolated");
  });

  test("only reports a change in mode", () => {
    const { engine, onMode, setNow } = setup();
    engine.ingest(change([row("a", 0, 0), row("a", 100, 10)]));
    setNow(150);
    engine.step();
    setNow(160);
    engine.step();
    setNow(170);
    engine.step();
    expect(onMode).toHaveBeenCalledTimes(1);
  });

  test("clears the mode when the module is hidden or released", () => {
    const { engine, onMode, visible, setNow } = setup();
    engine.ingest(change([row("a", 0, 0), row("a", 100, 10)]));
    setNow(150);
    engine.step();
    visible.delete("aircraft");
    engine.step();
    expect(onMode).toHaveBeenLastCalledWith("aircraft", null);
    visible.add("aircraft");
    engine.step();
    engine.setMovers(new Map());
    expect(onMode).toHaveBeenLastCalledWith("aircraft", null);
  });
});

describe("where an entity is drawn", () => {
  test("reports the interpolated position of any entity in the history", () => {
    const { engine, setNow } = setup();
    engine.ingest(change([row("a", 0, 0), row("a", 100, 10)]));
    setNow(150);
    expect(engine.positionOf("aircraft", "a")?.lon).toBeCloseTo(5, 5);
  });

  test("knows nothing about other modules or entities", () => {
    const { engine } = setup();
    engine.ingest(change([row("a", 0, 0)]));
    expect(engine.positionOf("ports", "a")).toBeNull();
    expect(engine.positionOf("aircraft", "zzz")).toBeNull();
  });
});

describe("how often each module is stepped", () => {
  const TICK_SECONDS = 1 / 12;
  const WIDE = 17_000;
  const CLOSE = 5;

  function run(
    engine: MotionEngine,
    setNow: (seconds: number) => void,
    steps: number,
    from = 150,
  ) {
    for (let i = 0; i < steps; i++) {
      setNow(from + i * TICK_SECONDS);
      engine.step();
    }
  }

  test("nextSkip doubles for sub-pixel motion, up to the cap", () => {
    expect(nextSkip(1, 0.01 * WIDE * GROW_BELOW_PX, WIDE)).toBe(2);
    expect(nextSkip(8, 0, WIDE)).toBe(MAX_SKIP);
    expect(nextSkip(MAX_SKIP, 0, WIDE)).toBe(MAX_SKIP);
  });

  test("nextSkip holds between the two thresholds", () => {
    const pixels = (GROW_BELOW_PX + SHRINK_ABOVE_PX) / 2;
    expect(nextSkip(4, pixels * WIDE, WIDE)).toBe(4);
  });

  test("nextSkip shrinks towards the target shift and never below one", () => {
    expect(nextSkip(12, 1.2 * WIDE, WIDE)).toBe(
      Math.floor((12 * TARGET_SHIFT_PX) / 1.2),
    );
    expect(nextSkip(2, 100 * WIDE, WIDE)).toBe(1);
  });

  test("a slow mover at a wide zoom is stepped less and less often", () => {
    const { engine, written, setNow } = setup();
    engine.ingest(change([row("a", 0, 0, { sog: 10, cog: 90 })]));
    engine.setScale(WIDE);
    run(engine, setNow, 48);
    expect(written.length).toBeLessThan(12);
    expect(written.length).toBeGreaterThan(3);
  });

  test("it reports pending work while waiting so the loop keeps going", () => {
    const { engine, setNow } = setup();
    engine.ingest(change([row("a", 0, 0, { sog: 10, cog: 90 })]));
    engine.setScale(WIDE);
    run(engine, setNow, 6);
    setNow(150 + 6 * TICK_SECONDS);
    const moved = engine.step();
    expect(moved).toBe(false);
    expect(engine.pending).toBe(true);
  });

  test("a mover that is not moving lets the loop stop", () => {
    const { engine, setNow } = setup();
    engine.ingest(change([row("a", 0, 1)]));
    engine.setScale(WIDE);
    setNow(5000);
    engine.step();
    setNow(5001);
    expect(engine.step()).toBe(false);
    expect(engine.pending).toBe(false);
  });

  test("a fast mover at a close zoom is stepped every time", () => {
    const { engine, written, setNow } = setup();
    engine.ingest(change([row("a", 0, 0, { sog: 400, cog: 90 })]));
    engine.setScale(CLOSE);
    run(engine, setNow, 24);
    expect(written).toHaveLength(24);
  });

  test("the followed module is always stepped at full rate", () => {
    const { engine, written, setNow } = setup();
    engine.ingest(change([row("a", 0, 0, { sog: 10, cog: 90 })]));
    engine.setScale(WIDE);
    engine.setFullRate("aircraft");
    run(engine, setNow, 24);
    expect(written).toHaveLength(24);
    expect(engine.pending).toBe(false);
  });

  test("a change of zoom brings the module back to every step", () => {
    const { engine, written, setNow } = setup();
    engine.ingest(change([row("a", 0, 0, { sog: 10, cog: 90 })]));
    engine.setScale(WIDE);
    run(engine, setNow, 48);
    engine.setScale(CLOSE);
    const before = written.length;
    run(engine, setNow, 1, 160);
    expect(written.length).toBe(before + 1);
  });

  test("a module without a scale is stepped every time", () => {
    const { engine, written, setNow } = setup();
    engine.ingest(change([row("a", 0, 0, { sog: 10, cog: 90 })]));
    run(engine, setNow, 12);
    expect(written).toHaveLength(12);
  });
});
