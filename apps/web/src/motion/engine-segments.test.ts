import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { EntityRow } from "@/api/client";
import {
  segmentLength,
  segmentLonLat,
} from "@/components/console/gpu/segment-math";
import {
  type Marker,
  SEGMENT_FADED,
  SEGMENT_H0,
  SEGMENT_H1,
  SEGMENT_LAT0,
  SEGMENT_LAT1,
  SEGMENT_LON0,
  SEGMENT_LON1,
  SEGMENT_STRIDE,
  SEGMENT_T0,
  SEGMENT_T1,
  type SegmentUpdate,
} from "@/components/console/markers";
import { DIRTY_BLOCK } from "@/components/console/renderer";
import type { EntityChange } from "@/state/entities";
import {
  CHAIN_LIMIT_SECONDS,
  MIN_SEGMENT_SECONDS,
  MotionEngine,
  type MotionTarget,
  RECHECK_SECONDS,
  SEGMENT_BUDGET_MS,
} from "./engine";
import { poseAt } from "./interpolate";
import { distanceMetres } from "./sphere";

const T0 = Date.parse("2026-10-26T10:00:00Z");
const DELAY = 100;

function row(
  id: string,
  seconds: number,
  lon: number,
  lat = 0,
  extra: Partial<EntityRow> = {},
): EntityRow {
  return {
    id,
    kind: "aircraft",
    name: id,
    lon,
    lat,
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

function change(rows: EntityRow[], extra: Partial<EntityChange> = {}) {
  return {
    moduleId: "aircraft",
    upserts: rows,
    removes: [],
    reset: false,
    ...extra,
  };
}

type Written = {
  rows: number[] | null;
  count: number;
  data: Float64Array;
};

function setup(ids: string[] = ["a"], start = 1000) {
  let now = T0 + start * 1000;
  let layer: readonly Marker[] = ids.map(marker);
  let segmented = true;
  const visible = new Set(["aircraft"]);
  const written: Written[] = [];
  const positions: Float64Array[] = [];
  const target: MotionTarget = {
    markers: (moduleId) => (moduleId === "aircraft" ? layer : undefined),
    isVisible: (moduleId) => visible.has(moduleId),
    setPositions: (_id, data) => {
      positions.push(Float64Array.from(data));
    },
    setSegments: (_id, update: SegmentUpdate) => {
      written.push({
        rows:
          update.rows === null ? null : [...update.rows.slice(0, update.count)],
        count: update.count,
        data: Float64Array.from(update.data),
      });
    },
    segmentMotion: () => segmented,
    invalidate: vi.fn(),
  };
  const onMode = vi.fn();
  const engine = new MotionEngine({ target, clock: () => now, onMode });
  engine.setMovers(new Map([["aircraft", DELAY]]));
  return {
    engine,
    written,
    positions,
    onMode,
    setNow: (seconds: number) => {
      now = T0 + seconds * 1000;
    },
    setLayer: (next: readonly Marker[]) => {
      layer = next;
    },
    setSegmented: (value: boolean) => {
      segmented = value;
    },
    seconds: () => now / 1000,
    relative: (absolute: number) => absolute - T0 / 1000,
  };
}

function field(entry: Written, index: number, column: number): number {
  return entry.data[index * SEGMENT_STRIDE + column];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("applying a layer in segment mode", () => {
  test("writes one segment for every marker, starting now and lasting between one and ten seconds", () => {
    const { engine, written, seconds, setNow } = setup(["a", "b"]);
    engine.ingest(
      change([row("a", 0, 0), row("a", 100, 10), row("b", 0, 20, 5)]),
    );
    setNow(DELAY + 50);
    engine.apply("aircraft");
    expect(written).toHaveLength(1);
    const [entry] = written;
    expect(entry.rows).toBeNull();
    expect(entry.count).toBe(2);
    for (let i = 0; i < 2; i++) {
      expect(field(entry, i, SEGMENT_T0)).toBe(seconds());
      const length = field(entry, i, SEGMENT_T1) - field(entry, i, SEGMENT_T0);
      expect(length).toBeGreaterThanOrEqual(MIN_SEGMENT_SECONDS);
      expect(length).toBeLessThanOrEqual(10);
    }
    expect(field(entry, 0, SEGMENT_LON0)).toBeCloseTo(5, 5);
  });

  test("a segment ends at the next fix when it is closer than ten seconds", () => {
    const { engine, written, setNow } = setup(["a"]);
    engine.ingest(change([row("a", 0, 0), row("a", 100, 10)]));
    setNow(DELAY + 95);
    engine.apply("aircraft");
    const length =
      field(written[0], 0, SEGMENT_T1) - field(written[0], 0, SEGMENT_T0);
    expect(length).toBeCloseTo(5, 5);
    expect(field(written[0], 0, SEGMENT_LON1)).toBeCloseTo(10, 5);
  });

  test("never writes a segment shorter than the minimum", () => {
    const { engine, written, setNow } = setup(["a"]);
    engine.ingest(change([row("a", 0, 0), row("a", 100, 10)]));
    setNow(DELAY + 99.9);
    engine.apply("aircraft");
    const length =
      field(written[0], 0, SEGMENT_T1) - field(written[0], 0, SEGMENT_T0);
    expect(length).toBe(MIN_SEGMENT_SECONDS);
  });

  test("markers with no history get an empty segment and are looked at again later", () => {
    const { engine, written, setNow } = setup(["a", "ghost"]);
    engine.ingest(change([row("a", 0, 0), row("a", 100, 10)]));
    engine.apply("aircraft");
    expect(Number.isNaN(field(written[0], 1, SEGMENT_LON0))).toBe(true);
    setNow(1000 + RECHECK_SECONDS - 1);
    engine.step();
    expect(written.at(-1)?.rows ?? []).not.toContain(1);
    setNow(1000 + RECHECK_SECONDS + 1);
    engine.step();
    expect(written.at(-1)?.rows).toContain(1);
  });

  test("a hidden module or a missing layer is left alone and clears its mode", () => {
    const { engine, written, onMode, setNow } = setup(["a"]);
    engine.ingest(change([row("a", 0, 0), row("a", 100, 10)]));
    setNow(DELAY + 50);
    engine.apply("aircraft");
    expect(onMode).toHaveBeenLastCalledWith("aircraft", "interpolated");
    expect(engine.apply("other")).toBe(false);
    expect(written).toHaveLength(1);
  });
});

describe("what each step recomputes", () => {
  beforeEach(() => {
    vi.spyOn(performance, "now").mockReturnValue(0);
  });

  function crowd() {
    const ids = Array.from({ length: 600 }, (_, i) => `m${i}`);
    const rig = setup(ids);
    rig.engine.ingest(
      change(
        ids.flatMap((id, i) => [
          row(id, 0, i * 0.01, 10),
          row(id, 100, i * 0.01 + 0.1, 10),
        ]),
      ),
    );
    rig.engine.apply("aircraft");
    return rig;
  }

  test("a step with nothing expired or changed writes nothing", () => {
    const { engine, written, setNow } = crowd();
    setNow(1001);
    expect(engine.step()).toBe(false);
    expect(written).toHaveLength(1);
  });

  test("only blocks whose segments have expired are recomputed", () => {
    const { engine, written, setNow } = crowd();
    setNow(1000 + 9.7);
    expect(engine.step()).toBe(true);
    const update = written.at(-1);
    expect(update?.rows?.[0]).toBe(segmentLength(0) > 9.7 ? DIRTY_BLOCK : 0);
    expect(update?.rows).toHaveLength(600 - DIRTY_BLOCK);
    expect(update?.count).toBe(600 - DIRTY_BLOCK);
  });

  test("a new fix makes exactly that marker dirty", () => {
    const { engine, written, setNow } = crowd();
    setNow(1002);
    engine.ingest(change([row("m5", 101, 0.2, 10)]));
    expect(engine.step()).toBe(true);
    expect(written.at(-1)?.rows).toEqual([5]);
    expect(engine.step()).toBe(false);
  });

  test("a fix for an entity that is not in the layer is ignored", () => {
    const { engine, written, setNow } = crowd();
    setNow(1002);
    engine.ingest(change([row("elsewhere", 101, 0.2, 10)]));
    expect(engine.step()).toBe(false);
    expect(written).toHaveLength(1);
  });

  test("segments never run backwards in time and always last", () => {
    const { engine, written, setNow } = crowd();
    const last = new Map<number, [number, number]>();
    for (let s = 0; s <= 120; s += 0.5) {
      setNow(1000 + s);
      engine.step();
    }
    for (const entry of written) {
      const rows =
        entry.rows ?? Array.from({ length: entry.count }, (_, i) => i);
      for (const i of rows) {
        const start = field(entry, i, SEGMENT_T0);
        const end = field(entry, i, SEGMENT_T1);
        expect(end).toBeGreaterThan(start);
        const before = last.get(i);
        if (before) {
          expect(start).toBeGreaterThanOrEqual(before[0]);
          expect(end).toBeGreaterThan(before[1]);
        }
        last.set(i, [start, end]);
      }
    }
    expect(last.size).toBe(600);
  });

  test("the work per step is bounded and the rest waits for the next step", () => {
    const { engine, written, setNow } = crowd();
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => {
      clock += SEGMENT_BUDGET_MS / 2;
      return clock;
    });
    setNow(1000 + 11);
    engine.step();
    const first = written.at(-1);
    expect(first?.count).toBe(DIRTY_BLOCK * 2);
    expect(engine.pending).toBe(true);
    engine.step();
    engine.step();
    const covered = new Set(
      written.slice(1).flatMap((entry) => entry.rows ?? []),
    );
    expect(covered.size).toBe(600);
  });
});

describe("chaining one segment into the next", () => {
  test("a slightly late refresh starts where the last one ended", () => {
    const { engine, written, setNow, relative } = setup(["a"]);
    engine.ingest(change([row("a", 0, 0), row("a", 1000, 10)]));
    engine.apply("aircraft");
    const first = written[0];
    const end = field(first, 0, SEGMENT_T1);
    setNow(relative(end) + CHAIN_LIMIT_SECONDS / 2);
    engine.step();
    const next = written.at(-1) as Written;
    expect(field(next, 0, SEGMENT_T0)).toBe(end);
    expect(field(next, 0, SEGMENT_LON0)).toBeCloseTo(
      field(first, 0, SEGMENT_LON1),
      9,
    );
    expect(field(next, 0, SEGMENT_LAT0)).toBeCloseTo(
      field(first, 0, SEGMENT_LAT1),
      9,
    );
  });

  test("a very late refresh starts from the present instead", () => {
    const { engine, written, setNow, seconds, relative } = setup(["a"]);
    engine.ingest(change([row("a", 0, 0), row("a", 1000, 10)]));
    engine.apply("aircraft");
    setNow(relative(seconds()) + 60);
    engine.step();
    const next = written.at(-1) as Written;
    expect(field(next, 0, SEGMENT_T0)).toBe(seconds());
  });

  test("the heading carries on from where the last segment left it", () => {
    const { engine, written, setNow, relative } = setup(["a"]);
    engine.ingest(
      change([
        row("a", 0, 0, 0, { sog: 400, cog: 90, heading: 90 }),
        row("a", 1000, 10, 0, { sog: 400, cog: 90, heading: 90 }),
      ]),
    );
    engine.apply("aircraft");
    const first = written[0];
    const end = field(first, 0, SEGMENT_T1);
    setNow(relative(end) + 0.2);
    engine.step();
    const next = written.at(-1) as Written;
    expect(field(next, 0, SEGMENT_H0)).toBeCloseTo(
      field(first, 0, SEGMENT_H1),
      6,
    );
  });
});

describe("the segments against poseAt", () => {
  type Scenario = {
    name: string;
    fixes: EntityRow[];
    from: number;
    to: number;
    expectMode?: "interpolated" | "extrapolated";
  };

  const scenarios: Scenario[] = [
    {
      name: "a bracketed pair",
      fixes: [row("a", 0, 0, 0), row("a", 100, 0.2, 0.1)],
      from: DELAY + 2,
      to: DELAY + 98,
    },
    {
      name: "an extrapolated aircraft",
      fixes: [row("a", 0, -30, 40, { sog: 450, cog: 70, heading: 70 })],
      from: DELAY + 2,
      to: DELAY + 250,
    },
    {
      name: "a vessel at two metres a second",
      fixes: [row("a", 0, 5, 50, { sog: 3.89, cog: 200, heading: 200 })],
      from: DELAY + 2,
      to: DELAY + 250,
    },
    {
      name: "a dateline crossing, the short way",
      fixes: [row("a", 0, 179.95, 10), row("a", 100, -179.95, 10.02)],
      from: DELAY + 2,
      to: DELAY + 98,
    },
    {
      name: "a polar track",
      fixes: [row("a", 0, 0, 89.95), row("a", 100, 180, 89.95)],
      from: DELAY + 2,
      to: DELAY + 98,
    },
    {
      name: "past the three hundred second cap",
      fixes: [row("a", 0, 100, -20, { sog: 500, cog: 10, heading: 10 })],
      from: DELAY + 280,
      to: DELAY + 360,
    },
    {
      name: "a warm-up entity before its first fix",
      fixes: [row("a", 0, 12, 34, { sog: 300, cog: 45, heading: 45 })],
      from: DELAY - 150,
      to: DELAY - 2,
    },
  ];

  for (const scenario of scenarios) {
    test(`stays within half a metre for ${scenario.name}`, () => {
      const rig = setup(["a"], scenario.from);
      rig.engine.ingest(change(scenario.fixes));
      rig.engine.apply("aircraft");
      let worst = 0;
      for (let s = scenario.from; s <= scenario.to; s += 0.25) {
        rig.setNow(s);
        rig.engine.step();
        const fixes = rig.engine.history.get("a");
        const expected = poseAt(fixes ?? [], T0 + s * 1000 - DELAY * 1000);
        const shown = rig.engine.positionOf("aircraft", "a");
        expect(expected).not.toBeNull();
        expect(shown).not.toBeNull();
        if (!expected || !shown) return;
        const error = distanceMetres(
          shown.lon,
          shown.lat,
          expected.lon,
          expected.lat,
        );
        if (error > worst) worst = error;
      }
      expect(worst).toBeLessThan(0.5);
    });
  }
});

describe("where the camera is told to look", () => {
  test("positionOf is the segment evaluated at the clock, the same maths the shader runs", () => {
    const { engine, written, setNow } = setup(["a"]);
    engine.ingest(change([row("a", 0, 0, 0), row("a", 1000, 10, 5)]));
    engine.apply("aircraft");
    const entry = written[0];
    setNow(1000 + 3.3);
    const found = { lon: 0, lat: 0 };
    segmentLonLat(
      field(entry, 0, SEGMENT_LON0),
      field(entry, 0, SEGMENT_LAT0),
      field(entry, 0, SEGMENT_LON1),
      field(entry, 0, SEGMENT_LAT1),
      field(entry, 0, SEGMENT_T0),
      field(entry, 0, SEGMENT_T1),
      T0 / 1000 + 1003.3,
      found,
    );
    const shown = engine.positionOf("aircraft", "a");
    expect(shown?.lon).toBeCloseTo(found.lon, 9);
    expect(shown?.lat).toBeCloseTo(found.lat, 9);
  });

  test("an entity without a segment falls back to the interpolated pose", () => {
    const { engine } = setup(["a"]);
    engine.ingest(change([row("a", 0, 0, 0), row("a", 1000, 10, 5)]));
    const shown = engine.positionOf("aircraft", "a");
    expect(shown).not.toBeNull();
  });
});

describe("when the overlay cannot do segments", () => {
  test("apply and step fall back to positions", () => {
    const { engine, written, positions, setSegmented, setNow } = setup(["a"]);
    engine.ingest(change([row("a", 0, 0), row("a", 100, 10)]));
    setSegmented(false);
    engine.apply("aircraft");
    expect(written).toHaveLength(0);
    expect(positions).toHaveLength(1);
    setNow(1100);
    engine.step();
    expect(written).toHaveLength(0);
    expect(engine.segmented).toBe(false);
  });

  test("going back to segments starts from a clean slate", () => {
    const { engine, written, setSegmented } = setup(["a"]);
    engine.ingest(change([row("a", 0, 0), row("a", 100, 10)]));
    engine.apply("aircraft");
    setSegmented(false);
    engine.apply("aircraft");
    setSegmented(true);
    engine.apply("aircraft");
    expect(written).toHaveLength(2);
    expect(written[1].rows).toBeNull();
  });
});

describe("a rebuilt layer", () => {
  test("keeps the segments of markers that are still there, even when they move place", () => {
    const { engine, written, setLayer, setNow } = setup(["a", "b"]);
    engine.ingest(
      change([
        row("a", 0, 0),
        row("a", 1000, 10),
        row("b", 0, 20),
        row("b", 1000, 30),
      ]),
    );
    engine.apply("aircraft");
    const before = written[0];
    setNow(1001);
    setLayer(["b", "a", "c"].map(marker));
    engine.apply("aircraft");
    const after = written.at(-1) as Written;
    expect(after.rows).toBeNull();
    expect(after.count).toBe(3);
    expect(field(after, 0, SEGMENT_T0)).toBe(field(before, 1, SEGMENT_T0));
    expect(field(after, 1, SEGMENT_T0)).toBe(field(before, 0, SEGMENT_T0));
    expect(Number.isNaN(field(after, 2, SEGMENT_LON0))).toBe(true);
  });

  test("a reset change brings every marker up to date", () => {
    const { engine, written, setNow } = setup(["a"]);
    engine.ingest(change([row("a", 0, 0), row("a", 1000, 10)]));
    engine.apply("aircraft");
    setNow(1002);
    engine.ingest(
      change([row("a", 0, 0), row("a", 1000, 10), row("a", 1001, 11)], {
        reset: true,
      }),
    );
    expect(engine.step()).toBe(true);
    expect(written.at(-1)?.rows).toEqual([0]);
  });
});

describe("faded markers and the mode", () => {
  test("a segment that ends past the cap is faded", () => {
    const { engine, written, setNow } = setup(["a"]);
    engine.ingest(change([row("a", 0, 0, 0, { sog: 400, cog: 90 })]));
    setNow(DELAY + 400);
    engine.apply("aircraft");
    expect(field(written[0], 0, SEGMENT_FADED)).toBe(1);
  });

  test("reports interpolated while fixes bracket the render time and extrapolated after", () => {
    const { engine, onMode, setNow } = setup(["a"]);
    engine.ingest(change([row("a", 0, 0), row("a", 100, 10)]));
    setNow(DELAY + 50);
    engine.apply("aircraft");
    expect(onMode).toHaveBeenLastCalledWith("aircraft", "interpolated");
    setNow(DELAY + 200);
    engine.step();
    expect(onMode).toHaveBeenLastCalledWith("aircraft", "extrapolated");
  });
});

describe("a target that is a class instance", () => {
  test("is called as a method, so it keeps its own state", () => {
    class Overlay implements MotionTarget {
      readonly received: string[] = [];
      private readonly layer = [marker("a")];
      markers() {
        return this.layer;
      }
      isVisible() {
        return true;
      }
      setPositions() {
        this.received.push("positions");
      }
      setSegments(moduleId: string) {
        this.received.push(`segments:${moduleId}`);
      }
      segmentMotion() {
        return this.received !== undefined;
      }
      invalidate() {
        this.received.push("invalidate");
      }
    }
    const target = new Overlay();
    const engine = new MotionEngine({ target, clock: () => T0 + 1000_000 });
    engine.setMovers(new Map([["aircraft", DELAY]]));
    engine.ingest(change([row("a", 0, 0), row("a", 100, 10)]));
    engine.apply("aircraft");
    expect(target.received).toEqual(["segments:aircraft"]);
  });
});
