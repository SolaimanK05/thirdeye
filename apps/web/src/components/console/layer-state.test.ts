import { describe, expect, test } from "vitest";
import { geodeticToEcef } from "./gpu/encode";
import { segmentFraction } from "./gpu/segment-math";
import {
  applyPositions,
  applySegments,
  buildLayer,
  dirtyRuns,
  findIndex,
  freezeAt,
  hasDirty,
  markClean,
  partitionByTone,
} from "./layer-state";
import {
  type Marker,
  POSITION_STRIDE,
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
} from "./markers";
import { DIRTY_BLOCK } from "./renderer";

function marker(id: string, over: Partial<Marker> = {}): Marker {
  return {
    id,
    lon: 10,
    lat: 20,
    glyph: "plane",
    size: 12,
    tone: "default",
    label: id,
    ...over,
  };
}

function build(markers: Marker[], previous?: ReturnType<typeof buildLayer>) {
  return buildLayer({
    moduleId: "m",
    slot: 3,
    markers,
    stale: false,
    sizing: undefined,
    options: undefined,
    previous,
    selectedId: null,
    epoch: 0,
  });
}

describe("partitionByTone", () => {
  test("is stable and puts accent last", () => {
    const tone = Uint8Array.from([2, 0, 1, 0, 2, 1]);
    const { order, inverse } = partitionByTone(tone);
    expect(Array.from(order)).toEqual([1, 3, 2, 5, 0, 4]);
    for (let k = 0; k < order.length; k++) {
      expect(inverse[order[k]]).toBe(k);
    }
  });

  test("handles empty and single-tone layers", () => {
    expect(partitionByTone(new Uint8Array(0)).order).toHaveLength(0);
    expect(
      Array.from(partitionByTone(Uint8Array.from([0, 0, 0])).order),
    ).toEqual([0, 1, 2]);
  });
});

describe("buildLayer", () => {
  test("packs per-marker style arrays and positions", () => {
    const state = build([
      marker("a", { tone: "accent", glyph: "ship", size: 9, adaptive: true }),
      marker("b", {
        glyph: "dot",
        size: 3.4,
        rotation: 45,
        persistentLabel: true,
      }),
    ]);
    const { render } = state;
    expect(render.slot).toBe(3);
    expect(render.count).toBe(2);
    expect(Array.from(render.glyph)).toEqual([5, 6]);
    expect(Array.from(render.size)).toEqual([9, 3]);
    expect(Array.from(render.tone)).toEqual([2, 0]);
    expect(Array.from(render.adaptive)).toEqual([1, 0]);
    expect(Array.from(render.rotationDeg)).toEqual([0, 45]);
    expect(Array.from(render.order)).toEqual([1, 0]);
    expect(Array.from(state.special)).toEqual([1]);
    expect(dirtyRuns(render)).toEqual([[0, 2]]);
    const expected = new Float64Array(3);
    geodeticToEcef(10, 20, expected, 0);
    expect(render.ecef[0]).toBeCloseTo(expected[0], 6);
  });

  test("keeps the moved position of a marker whose own position did not change", () => {
    const first = build([marker("a"), marker("b")]);
    const data = new Float64Array(2 * POSITION_STRIDE);
    data.set([11, 21, Number.NaN, 0, 12, 22, Number.NaN, 0]);
    applyPositions(first, data);
    const second = build([marker("b"), marker("a"), marker("c")], first);
    expect(second.lon[0]).toBe(12);
    expect(second.lat[0]).toBe(22);
    expect(second.lon[1]).toBe(11);
    expect(second.lon[2]).toBe(10);
    expect(second.render.ecef[0]).toBe(first.render.ecef[3]);
  });

  test("takes the new position when the marker itself moved", () => {
    const first = build([marker("a")]);
    applyPositions(first, Float64Array.from([11, 21, Number.NaN, 0]));
    const second = build([marker("a", { lon: 30, lat: 40 })], first);
    expect(second.lon[0]).toBe(30);
    expect(second.lat[0]).toBe(40);
  });

  test("a new layer starts with no fade and the marker's own rotation", () => {
    const first = build([marker("a", { rotation: 90 })]);
    applyPositions(first, Float64Array.from([10, 20, 33, 1]));
    const second = build([marker("a", { rotation: 90 })], first);
    expect(second.render.fadedCount).toBe(0);
    expect(second.render.rotationDeg[0]).toBe(90);
    expect(second.render.faded[0]).toBe(0);
  });

  test("carries the last adaptive size only when the layer still has a sizing", () => {
    const first = build([marker("a")]);
    first.render.sizedGlyph = 4;
    first.render.sizedSize = 14;
    const kept = buildLayer({
      moduleId: "m",
      slot: 3,
      markers: [marker("a")],
      stale: false,
      sizing: () => ({ glyph: "plane", size: 14 }),
      options: undefined,
      previous: first,
      selectedId: null,
      epoch: 0,
    });
    expect(kept.render.sizedGlyph).toBe(4);
    const dropped = build([marker("a")], first);
    expect(dropped.render.sizedGlyph).toBe(-1);
  });

  test("honours pickable and reported options and finds the selected marker", () => {
    const state = buildLayer({
      moduleId: "bench",
      slot: 0,
      markers: [marker("a"), marker("b")],
      stale: true,
      sizing: undefined,
      options: { pickable: false, reported: false },
      previous: undefined,
      selectedId: "b",
      epoch: 0,
    });
    expect(state.render.pickable).toBe(false);
    expect(state.reported).toBe(false);
    expect(state.render.stale).toBe(true);
    expect(state.selectedIndex).toBe(1);
  });
});

describe("applyPositions", () => {
  test("marks the block of the instance that changed", () => {
    const state = build([
      marker("a"),
      marker("b", { tone: "accent" }),
      marker("c"),
    ]);
    markClean(state.render);
    expect(hasDirty(state.render)).toBe(false);
    const data = new Float64Array(3 * POSITION_STRIDE);
    data.set([
      10,
      20,
      Number.NaN,
      0,
      10,
      20,
      Number.NaN,
      0,
      15,
      25,
      Number.NaN,
      0,
    ]);
    expect(applyPositions(state, data)).toBe(true);
    expect(dirtyRuns(state.render)).toEqual([[0, 3]]);
  });

  test("reports no change for identical data", () => {
    const state = build([marker("a")]);
    markClean(state.render);
    expect(
      applyPositions(state, Float64Array.from([10, 20, Number.NaN, 0])),
    ).toBe(false);
    expect(hasDirty(state.render)).toBe(false);
  });

  test("NaN coordinates fall back to the marker position", () => {
    const state = build([marker("a")]);
    applyPositions(state, Float64Array.from([50, 50, Number.NaN, 0]));
    applyPositions(state, Float64Array.from([Number.NaN, Number.NaN, 0, 0]));
    expect(state.lon[0]).toBe(10);
    expect(state.lat[0]).toBe(20);
  });

  test("rotation and fade changes are dirty and counted", () => {
    const state = build([marker("a"), marker("b")]);
    markClean(state.render);
    applyPositions(
      state,
      Float64Array.from([10, 20, 90, 1, 10, 20, Number.NaN, 0]),
    );
    expect(state.render.rotationDeg[0]).toBe(90);
    expect(state.render.faded[0]).toBe(1);
    expect(state.render.fadedCount).toBe(1);
    expect(hasDirty(state.render)).toBe(true);
  });

  test("ignores a position array that is too short", () => {
    const state = build([marker("a"), marker("b")]);
    markClean(state.render);
    expect(applyPositions(state, new Float64Array(4))).toBe(false);
    expect(hasDirty(state.render)).toBe(false);
  });
});

describe("findIndex", () => {
  test("finds a marker by id", () => {
    const markers = [marker("a"), marker("b")];
    expect(findIndex(markers, "b")).toBe(1);
    expect(findIndex(markers, "x")).toBe(-1);
    expect(findIndex(markers, null)).toBe(-1);
  });
});

function segmentRow(
  data: Float64Array,
  row: number,
  values: Partial<Record<number, number>>,
) {
  const at = row * SEGMENT_STRIDE;
  const base: Record<number, number> = {
    [SEGMENT_LON0]: 10,
    [SEGMENT_LAT0]: 20,
    [SEGMENT_LON1]: 10,
    [SEGMENT_LAT1]: 20,
    [SEGMENT_T0]: 100,
    [SEGMENT_T1]: 110,
    [SEGMENT_H0]: Number.NaN,
    [SEGMENT_H1]: Number.NaN,
    [SEGMENT_FADED]: 0,
  };
  for (let k = 0; k < SEGMENT_STRIDE; k++) {
    data[at + k] = values[k] ?? base[k];
  }
}

describe("dirty blocks", () => {
  test("runs merge adjacent blocks and clip to the count", () => {
    const state = build(Array.from({ length: 700 }, (_, i) => marker(`m${i}`)));
    markClean(state.render);
    expect(dirtyRuns(state.render)).toEqual([]);
    const data = new Float64Array(700 * POSITION_STRIDE);
    for (let i = 0; i < 700; i++) {
      data.set([10, 20, Number.NaN, 0], i * POSITION_STRIDE);
    }
    data.set([11, 21, Number.NaN, 0], 5 * POSITION_STRIDE);
    data.set([11, 21, Number.NaN, 0], 699 * POSITION_STRIDE);
    applyPositions(state, data);
    expect(dirtyRuns(state.render)).toEqual([
      [0, DIRTY_BLOCK],
      [DIRTY_BLOCK * 2, 700],
    ]);
  });
});

describe("applySegments", () => {
  test("turns the layer into a moving layer and fills the arrays", () => {
    const state = build([marker("a"), marker("b", { rotation: 90 })]);
    markClean(state.render);
    state.needsSync = false;
    const data = new Float64Array(2 * SEGMENT_STRIDE);
    segmentRow(data, 0, {
      [SEGMENT_LON1]: 10.1,
      [SEGMENT_H0]: 0,
      [SEGMENT_H1]: 90,
    });
    segmentRow(data, 1, { [SEGMENT_FADED]: 1 });
    const changed = applySegments(state, { data, rows: null, count: 2 });
    const { render } = state;
    expect(changed).toBe(true);
    expect(render.moving).toBe(true);
    expect(state.needsSync).toBe(true);
    expect(Array.from(render.times ?? [])).toEqual([100, 110, 100, 110]);
    expect(render.delta?.[0]).not.toBe(0);
    expect(render.delta?.[3]).toBe(0);
    expect(render.headings?.[0]).toBe(0);
    expect(render.headings?.[1]).toBeCloseTo(Math.PI / 2, 6);
    expect(render.headings?.[2]).toBeCloseTo(Math.PI / 2, 6);
    expect(Array.from(render.faded)).toEqual([0, 1]);
    expect(render.fadedCount).toBe(1);
    expect(state.liveUntil).toBe(110);
  });

  test("partial updates touch only the listed rows and extend the live window", () => {
    const state = build(Array.from({ length: 600 }, (_, i) => marker(`m${i}`)));
    const data = new Float64Array(600 * SEGMENT_STRIDE);
    for (let i = 0; i < 600; i++) segmentRow(data, i, {});
    applySegments(state, { data, rows: null, count: 600 });
    markClean(state.render);
    segmentRow(data, 300, { [SEGMENT_T0]: 110, [SEGMENT_T1]: 125 });
    const rows = Uint32Array.from([300]);
    expect(applySegments(state, { data, rows, count: 1 })).toBe(true);
    expect(dirtyRuns(state.render)).toEqual([[DIRTY_BLOCK, DIRTY_BLOCK * 2]]);
    expect(state.render.times?.[600]).toBe(110);
    expect(state.liveUntil).toBe(125);
  });

  test("a full update resets the live window", () => {
    const state = build([marker("a")]);
    const data = new Float64Array(SEGMENT_STRIDE);
    segmentRow(data, 0, { [SEGMENT_T1]: 500 });
    applySegments(state, { data, rows: null, count: 1 });
    segmentRow(data, 0, { [SEGMENT_T1]: 120 });
    applySegments(state, { data, rows: null, count: 1 });
    expect(state.liveUntil).toBe(120);
  });

  test("missing coordinates fall back to the marker and a missing end collapses the segment", () => {
    const state = build([marker("a"), marker("b")]);
    const data = new Float64Array(2 * SEGMENT_STRIDE);
    segmentRow(data, 0, {
      [SEGMENT_LON0]: Number.NaN,
      [SEGMENT_LAT0]: Number.NaN,
      [SEGMENT_LON1]: 50,
      [SEGMENT_LAT1]: 50,
    });
    segmentRow(data, 1, {
      [SEGMENT_LON1]: Number.NaN,
      [SEGMENT_LAT1]: Number.NaN,
      [SEGMENT_T0]: Number.NaN,
    });
    applySegments(state, { data, rows: null, count: 2 });
    expect(state.lon[0]).toBe(10);
    expect(state.lat[0]).toBe(20);
    expect(state.render.delta?.slice(0, 3)).toEqual(new Float64Array(3));
    expect(state.render.delta?.slice(3, 6)).toEqual(new Float64Array(3));
    expect(Array.from(state.render.times?.slice(2, 4) ?? [])).toEqual([0, 0]);
  });

  test("short data is ignored", () => {
    const state = build([marker("a"), marker("b")]);
    const data = new Float64Array(SEGMENT_STRIDE);
    expect(applySegments(state, { data, rows: null, count: 2 })).toBe(false);
    expect(state.render.moving).toBe(false);
  });

  test("setting positions turns a moving layer back into a static one", () => {
    const state = build([marker("a")]);
    const data = new Float64Array(SEGMENT_STRIDE);
    segmentRow(data, 0, {});
    applySegments(state, { data, rows: null, count: 1 });
    state.needsSync = false;
    applyPositions(state, Float64Array.from([12, 22, Number.NaN, 0]));
    expect(state.render.moving).toBe(false);
    expect(state.render.delta).toBeNull();
    expect(state.needsSync).toBe(true);
  });
});

describe("freezeAt", () => {
  test("moves positions and headings to their value at the given time", () => {
    const state = build([marker("a")]);
    const data = new Float64Array(SEGMENT_STRIDE);
    segmentRow(data, 0, {
      [SEGMENT_LON1]: 10.2,
      [SEGMENT_LAT1]: 20.2,
      [SEGMENT_H0]: 10,
      [SEGMENT_H1]: 50,
    });
    applySegments(state, { data, rows: null, count: 1 });
    freezeAt(state, 105);
    expect(state.render.moving).toBe(false);
    expect(state.lon[0]).toBeCloseTo(10.1, 3);
    expect(state.lat[0]).toBeCloseTo(20.1, 3);
    expect(state.render.rotationDeg[0]).toBeCloseTo(30, 3);
    expect(segmentFraction(100, 110, 105)).toBe(0.5);
  });

  test("does nothing to a static layer", () => {
    const state = build([marker("a")]);
    freezeAt(state, 105);
    expect(state.lon[0]).toBe(10);
  });
});
