import { describe, expect, test } from "vitest";
import {
  compact,
  FULL_SIZE_AT,
  MIN_SIZE_AT,
  SATELLITE_MAX_SIZE,
  SATELLITE_MIN_SIZE,
  satelliteMarkers,
  satelliteSizing,
} from "./render";

const IDS = ["a", "b", "c"];
const NAMES = new Map([
  ["a", "Alpha"],
  ["b", "Beta"],
]);
const POSITIONS = Float64Array.from([
  10,
  1,
  Number.NaN,
  0,
  20,
  2,
  Number.NaN,
  0,
  30,
  3,
  Number.NaN,
  0,
]);

describe("satelliteSizing", () => {
  test("draws dots, large when few are in view", () => {
    expect(satelliteSizing(1)).toEqual({
      glyph: "dot",
      size: SATELLITE_MAX_SIZE,
    });
    expect(satelliteSizing(FULL_SIZE_AT)).toEqual({
      glyph: "dot",
      size: SATELLITE_MAX_SIZE,
    });
  });

  test("shrinks to the smallest dot when thousands are in view", () => {
    expect(satelliteSizing(MIN_SIZE_AT).size).toBe(SATELLITE_MIN_SIZE);
    expect(satelliteSizing(50_000).size).toBe(SATELLITE_MIN_SIZE);
  });

  test("never grows as more come into view", () => {
    let last = Number.POSITIVE_INFINITY;
    for (const count of [0, 10, 100, 500, 1000, 3000, 6000, 12000]) {
      const { size } = satelliteSizing(count);
      expect(size).toBeLessThanOrEqual(last);
      last = size;
    }
  });
});

describe("satelliteMarkers", () => {
  test("makes one marker per satellite, in order, at the given positions", () => {
    const { markers, order } = satelliteMarkers(
      IDS,
      NAMES,
      POSITIONS,
      new Set(),
      null,
    );
    expect(markers.map((m) => [m.id, m.lon, m.lat])).toEqual([
      ["a", 10, 1],
      ["b", 20, 2],
      ["c", 30, 3],
    ]);
    expect(order).toBeNull();
  });

  test("names them, with a fallback", () => {
    const { markers } = satelliteMarkers(
      IDS,
      NAMES,
      POSITIONS,
      new Set(),
      null,
    );
    expect(markers.map((m) => m.label)).toEqual([
      "Alpha",
      "Beta",
      "Unnamed satellite",
    ]);
  });

  test("accents and labels the starred ones", () => {
    const { markers } = satelliteMarkers(
      IDS,
      NAMES,
      POSITIONS,
      new Set(["b"]),
      null,
    );
    expect(markers.map((m) => m.tone)).toEqual([
      "default",
      "accent",
      "default",
    ]);
    expect(markers.map((m) => m.persistentLabel)).toEqual([false, true, false]);
  });

  test("keeps only the starred ones when asked, and remembers where they were", () => {
    const { markers, order } = satelliteMarkers(
      IDS,
      NAMES,
      POSITIONS,
      new Set(["c", "a"]),
      new Set(["c", "a"]),
    );
    expect(markers.map((m) => m.id)).toEqual(["a", "c"]);
    expect(Array.from(order ?? [])).toEqual([0, 2]);
  });

  test("keeps exactly the ones it is told to, whatever their stars", () => {
    const { markers, order } = satelliteMarkers(
      IDS,
      NAMES,
      POSITIONS,
      new Set(["a"]),
      new Set(["b"]),
    );
    expect(markers.map((m) => m.id)).toEqual(["b"]);
    expect(Array.from(order ?? [])).toEqual([1]);
  });

  test("keeps none when nothing is starred", () => {
    const { markers, order } = satelliteMarkers(
      IDS,
      NAMES,
      POSITIONS,
      new Set(),
      new Set(),
    );
    expect(markers).toEqual([]);
    expect(Array.from(order ?? [])).toEqual([]);
  });
});

describe("compact", () => {
  test("gathers the chosen entries into the front of a buffer", () => {
    const out = compact(
      POSITIONS,
      Int32Array.from([2, 0]),
      new Float64Array(0),
    );
    expect(Array.from(out.slice(0, 2))).toEqual([30, 3]);
    expect(Array.from(out.slice(4, 6))).toEqual([10, 1]);
  });

  test("reuses a buffer that is big enough", () => {
    const into = new Float64Array(16);
    expect(compact(POSITIONS, Int32Array.from([1]), into)).toBe(into);
  });
});
