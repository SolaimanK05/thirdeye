import { describe, expect, test } from "vitest";
import { ColumnarRows } from "@/data/columnar-rows";
import { SlotDictionary } from "@/data/dictionary";
import { glyphIndex } from "./glyphs";
import { geodeticToEcef, toneIndex } from "./gpu/encode";
import {
  applyPositions,
  applySegments,
  buildColumnarLayer,
  type SlotRows,
} from "./layer-state";
import {
  POSITION_STRIDE,
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

const STYLE = { glyph: "plane", size: 20, adaptive: true } as const;

function rowsOf(slots: number[], lon: number[], lat: number[], ids: string[]) {
  const dictionary = new SlotDictionary();
  dictionary.reset(1);
  const enc = new TextEncoder();
  const encoded = ids.map((id) => enc.encode(id));
  const offsetList = [0];
  for (const part of encoded) {
    offsetList.push(offsetList[offsetList.length - 1] + part.length);
  }
  const offsets = Uint32Array.from(offsetList);
  const bytes = Uint8Array.from(encoded.flatMap((part) => [...part]));
  dictionary.append({
    slots: Uint32Array.from(slots),
    idOffsets: offsets,
    idBytes: bytes,
    nameOffsets: offsets,
    nameBytes: bytes,
  });
  const starred = new Set<number>();
  const rows = new ColumnarRows({
    slots: Uint32Array.from(slots),
    dictionary,
    lon: Float64Array.from(lon),
    lat: Float64Array.from(lat),
    rotation: new Float32Array(slots.length),
    style: STYLE,
    starred,
  });
  return { rows, starred };
}

function build(
  rows: SlotRows,
  lon: number[],
  lat: number[],
  options: {
    starred?: number[];
    previous?: ReturnType<typeof buildColumnarLayer>;
    selectedId?: string | null;
  } = {},
) {
  return buildColumnarLayer({
    moduleId: "m",
    slot: 2,
    rows,
    lon: Float64Array.from(lon),
    lat: Float64Array.from(lat),
    rotation: Float32Array.from(lon.map((_, i) => i * 10)),
    style: STYLE,
    starred: Uint32Array.from(options.starred ?? []),
    stale: false,
    sizing: undefined,
    options: undefined,
    previous: options.previous,
    selectedId: options.selectedId ?? null,
    epoch: 0,
  });
}

describe("buildColumnarLayer", () => {
  test("fills the render arrays from one style and the rotation column", () => {
    const { rows } = rowsOf(
      [1, 4, 8],
      [10, 20, 30],
      [1, 2, 3],
      ["a", "b", "c"],
    );
    const state = build(rows, [10, 20, 30], [1, 2, 3]);
    expect(state.markers).toBeNull();
    expect(state.render.count).toBe(3);
    expect([...state.render.glyph]).toEqual(Array(3).fill(glyphIndex("plane")));
    expect([...state.render.size]).toEqual([20, 20, 20]);
    expect([...state.render.adaptive]).toEqual([1, 1, 1]);
    expect([...state.render.rotationDeg]).toEqual([0, 10, 20]);
    const ecef = new Float64Array(3);
    geodeticToEcef(20, 2, ecef, 0);
    expect(state.render.ecef[3]).toBeCloseTo(ecef[0], 3);
  });

  test("starred rows get the accent tone and a permanent label", () => {
    const { rows } = rowsOf(
      [1, 4, 8],
      [10, 20, 30],
      [1, 2, 3],
      ["a", "b", "c"],
    );
    const state = build(rows, [10, 20, 30], [1, 2, 3], { starred: [1] });
    expect([...state.render.tone]).toEqual([0, toneIndex("accent"), 0]);
    expect([...state.special]).toEqual([1]);
  });

  test("selects the row of the selected id", () => {
    const { rows } = rowsOf(
      [1, 4, 8],
      [10, 20, 30],
      [1, 2, 3],
      ["a", "b", "c"],
    );
    expect(
      build(rows, [10, 20, 30], [1, 2, 3], { selectedId: "c" }).selectedIndex,
    ).toBe(2);
    expect(
      build(rows, [10, 20, 30], [1, 2, 3], { selectedId: "zzz" }).selectedIndex,
    ).toBe(-1);
  });

  test("keeps the drawn position of rows that did not move when slots come and go", () => {
    const first = rowsOf([1, 4, 8], [10, 20, 30], [1, 2, 3], ["a", "b", "c"]);
    const before = build(first.rows, [10, 20, 30], [1, 2, 3]);
    before.render.ecef.fill(7, 3, 6);
    const second = rowsOf([4, 6, 8], [20, 99, 31], [2, 9, 3], ["b", "z", "c"]);
    const after = build(second.rows, [20, 99, 31], [2, 9, 3], {
      previous: before,
    });
    expect(after.render.ecef[0]).toBe(7);
    expect(after.render.ecef[3]).not.toBe(7);
    expect(after.render.ecef[6]).not.toBe(7);
  });

  test("falls back to the home position when a segment has no position", () => {
    const { rows } = rowsOf([1, 4], [10, 20], [1, 2], ["a", "b"]);
    const state = build(rows, [10, 20], [1, 2]);
    const data = new Float64Array(2 * SEGMENT_STRIDE).fill(Number.NaN);
    expect(applySegments(state, { data, rows: null, count: 2 })).toBe(true);
    expect(state.lon[1]).toBe(20);
    expect(state.lat[1]).toBe(2);
  });

  test("applies packed segment rows to the rows they name", () => {
    const { rows } = rowsOf(
      [1, 4, 8],
      [10, 20, 30],
      [1, 2, 3],
      ["a", "b", "c"],
    );
    const state = build(rows, [10, 20, 30], [1, 2, 3]);
    applySegments(state, {
      data: new Float64Array(3 * SEGMENT_STRIDE).fill(Number.NaN),
      rows: null,
      count: 3,
    });
    const packed = new Float64Array(SEGMENT_STRIDE).fill(Number.NaN);
    packed[SEGMENT_LON0] = 50;
    packed[SEGMENT_LAT0] = 5;
    packed[SEGMENT_LON1] = 51;
    packed[SEGMENT_LAT1] = 5;
    packed[SEGMENT_T0] = 100;
    packed[SEGMENT_T1] = 110;
    packed[SEGMENT_H0] = 90;
    packed[SEGMENT_H1] = 90;
    applySegments(state, {
      data: packed,
      rows: Uint32Array.of(2),
      count: 1,
      packed: true,
    });
    expect(state.lon[2]).toBe(50);
    expect(state.render.times?.[4]).toBe(100);
    expect(state.render.times?.[5]).toBe(110);
    expect(state.lon[0]).toBe(10);
  });

  test("positions for the canvas fallback use the home position for NaN", () => {
    const { rows } = rowsOf([1, 4], [10, 20], [1, 2], ["a", "b"]);
    const state = build(rows, [10, 20], [1, 2]);
    const data = new Float64Array(2 * POSITION_STRIDE).fill(Number.NaN);
    data[0] = 11;
    data[1] = 1.5;
    data[3] = 1;
    expect(applyPositions(state, data)).toBe(true);
    expect(state.lon[0]).toBe(11);
    expect(state.lon[1]).toBe(20);
    expect(state.render.faded[0]).toBe(1);
  });
});
