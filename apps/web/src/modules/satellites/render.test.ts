import { describe, expect, test } from "vitest";
import {
  compact,
  FULL_SIZE_AT,
  footprintRadiusKm,
  HOVER_LINEAR_KM,
  HOVER_SCALE,
  hoverHeightM,
  hoverHeights,
  MIN_SIZE_AT,
  noradLabel,
  overlayPositions,
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

describe("satelliteMarkers with a draw limit", () => {
  const numbers = ["900", "100", "500", "x"];
  const places = Float64Array.from(
    numbers.flatMap((_, i) => [i, i, Number.NaN, 0]),
  );

  test("keeps the lowest catalogue numbers, in their original order", () => {
    const { markers, order, candidates } = satelliteMarkers(
      numbers,
      new Map(),
      places,
      new Set(),
      null,
      { limit: 2, forced: new Set() },
    );
    expect(markers.map((m) => m.id)).toEqual(["100", "500"]);
    expect(Array.from(order ?? [])).toEqual([1, 2]);
    expect(candidates).toBe(4);
  });

  test("never drops the forced ones, and ranks unnumbered ids last", () => {
    const { markers } = satelliteMarkers(
      numbers,
      new Map(),
      places,
      new Set(["x"]),
      null,
      { limit: 2, forced: new Set(["x"]) },
    );
    expect(markers.map((m) => m.id)).toEqual(["100", "x"]);
  });

  test("counts only the satellites that were wanted", () => {
    const { candidates, markers } = satelliteMarkers(
      numbers,
      new Map(),
      places,
      new Set(),
      new Set(["900", "100", "500"]),
      { limit: 1, forced: new Set() },
    );
    expect(candidates).toBe(3);
    expect(markers.map((m) => m.id)).toEqual(["100"]);
  });

  test("draws all with no limit", () => {
    const { markers, order } = satelliteMarkers(
      numbers,
      new Map(),
      places,
      new Set(),
      null,
    );
    expect(markers).toHaveLength(4);
    expect(order).toBeNull();
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

describe("hoverHeightM", () => {
  test("shows low orbits at their true height in metres", () => {
    expect(hoverHeightM(420)).toBe(420_000 * HOVER_SCALE);
    expect(hoverHeightM(HOVER_LINEAR_KM)).toBe(
      HOVER_LINEAR_KM * 1000 * HOVER_SCALE,
    );
  });

  test("never lets a high orbit leave the picture, and keeps the order of heights", () => {
    const heights = [400, 1_500, 2_000, 8_000, 20_200, 35_786, 400_000].map(
      hoverHeightM,
    );
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]).toBeGreaterThan(heights[i - 1]);
    }
    expect(hoverHeightM(35_786)).toBeLessThanOrEqual(3_000_000 * HOVER_SCALE);
    expect(hoverHeightM(400_000)).toBeLessThanOrEqual(3_000_000 * HOVER_SCALE);
  });

  test("has no step where the true height ends", () => {
    const below = hoverHeightM(HOVER_LINEAR_KM - 0.001);
    const above = hoverHeightM(HOVER_LINEAR_KM + 0.001);
    expect(above - below).toBeLessThan(5);
    expect(above).toBeGreaterThan(below);
  });

  test("puts a satellite with no usable altitude on the ground", () => {
    for (const bad of [Number.NaN, -5, 0, Number.POSITIVE_INFINITY]) {
      expect(hoverHeightM(bad)).toBe(0);
    }
  });
});

describe("hoverHeights", () => {
  const rows = Float64Array.from([
    10, 1, 420, 0, 20, 2, 800, 0, 30, 3, 35_786, 0,
  ]);

  test("reads the altitude of every satellite in row order", () => {
    const heights = hoverHeights(rows, null, 3, new Float32Array(0));
    expect(Array.from(heights)).toEqual([
      Math.fround(hoverHeightM(420)),
      Math.fround(hoverHeightM(800)),
      Math.fround(hoverHeightM(35_786)),
    ]);
  });

  test("follows the same order as the markers that are kept", () => {
    const heights = hoverHeights(
      rows,
      Int32Array.from([2, 0]),
      2,
      new Float32Array(8),
    );
    expect(heights[0]).toBe(Math.fround(hoverHeightM(35_786)));
    expect(heights[1]).toBe(Math.fround(hoverHeightM(420)));
  });
});

describe("overlayPositions", () => {
  const rows = Float64Array.from([10, 1, 420, 0, 20, 2, 800, 1]);

  test("hands the overlay no heading, whatever the altitude column holds", () => {
    const out = overlayPositions(rows, null, 2, new Float64Array(0));
    expect(out[0]).toBe(10);
    expect(out[1]).toBe(1);
    expect(Number.isNaN(out[2])).toBe(true);
    expect(out[3]).toBe(0);
    expect(out[7]).toBe(1);
  });

  test("keeps only the rows asked for, in that order", () => {
    const out = overlayPositions(
      rows,
      Int32Array.from([1]),
      1,
      new Float64Array(8),
    );
    expect(Array.from(out.subarray(0, 2))).toEqual([20, 2]);
    expect(Number.isNaN(out[2])).toBe(true);
    expect(out[3]).toBe(1);
  });
});

describe("footprints", () => {
  test("a satellite sees further the higher it is", () => {
    expect(footprintRadiusKm(552)).toBeCloseTo(2558, -1);
    expect(footprintRadiusKm(400)).toBeLessThan(footprintRadiusKm(552));
    expect(footprintRadiusKm(35_786)).toBeGreaterThan(8000);
    expect(footprintRadiusKm(35_786)).toBeLessThan(10_000);
  });

  test("has no footprint without a usable altitude", () => {
    expect(footprintRadiusKm(0)).toBeNaN();
    expect(footprintRadiusKm(-5)).toBeNaN();
    expect(footprintRadiusKm(Number.NaN)).toBeNaN();
  });

  test("labels with the NORAD number and the altitude", () => {
    expect(noradLabel("101877", 552.4)).toBe("NORAD 101877, 552 km");
    expect(noradLabel("25544", 35_786)).toBe("NORAD 25544, 35,786 km");
    expect(noradLabel("7", Number.NaN)).toBe("NORAD 7");
  });
});

describe("satellites in the view", () => {
  const WITH_ALTITUDE = Float64Array.from([
    10, 1, 550, 0, 20, 2, 600, 0, 30, 3, 35_786, 0,
  ]);
  const box = { west: 15, south: 0, east: 35, north: 5 };

  test("draws only those whose sub-point is in the box", () => {
    const placement = satelliteMarkers(
      IDS,
      NAMES,
      WITH_ALTITUDE,
      new Set(),
      null,
      {
        limit: null,
        forced: new Set(),
        clip: box,
      },
    );
    expect(placement.markers.map((m) => m.id)).toEqual(["b", "c"]);
    expect(placement.candidates).toBe(2);
    expect(placement.order && [...placement.order]).toEqual([1, 2]);
  });

  test("keeps forced satellites wherever they are", () => {
    const placement = satelliteMarkers(
      IDS,
      NAMES,
      WITH_ALTITUDE,
      new Set(["a"]),
      null,
      {
        limit: null,
        forced: new Set(["a"]),
        clip: box,
      },
    );
    expect(placement.markers.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  test("adds a label and a ring for each when detail is asked for", () => {
    const placement = satelliteMarkers(
      IDS,
      NAMES,
      WITH_ALTITUDE,
      new Set(),
      null,
      {
        limit: null,
        forced: new Set(),
        clip: box,
        detail: true,
      },
    );
    expect(placement.markers.map((m) => m.label)).toEqual([
      "NORAD b, 600 km",
      "NORAD c, 35,786 km",
    ]);
    expect(placement.markers.every((m) => m.persistentLabel)).toBe(true);
    expect(placement.rings.map((r) => r.index)).toEqual([0, 1]);
  });

  test("labels with the catalogue number when the id is something else", () => {
    const placement = satelliteMarkers(
      IDS,
      NAMES,
      WITH_ALTITUDE,
      new Set(),
      null,
      {
        limit: null,
        forced: new Set(),
        detail: true,
        norads: new Map([["a", "25544"]]),
      },
    );
    expect(placement.markers.map((m) => m.label)).toEqual([
      "NORAD 25544, 550 km",
      "NORAD b, 600 km",
      "NORAD c, 35,786 km",
    ]);
  });

  test("no rings and the usual names without detail", () => {
    const placement = satelliteMarkers(
      IDS,
      NAMES,
      WITH_ALTITUDE,
      new Set(),
      null,
    );
    expect(placement.rings).toEqual([]);
    expect(placement.markers[0].label).toBe("Alpha");
  });

  test("gives a ring only to the first sixty", () => {
    const ids = Array.from({ length: 100 }, (_, i) => String(i));
    const positions = new Float64Array(100 * 4);
    for (let i = 0; i < 100; i++) positions.set([i, 0, 500, 0], i * 4);
    const placement = satelliteMarkers(
      ids,
      new Map(),
      positions,
      new Set(),
      null,
      {
        limit: null,
        forced: new Set(),
        detail: true,
      },
    );
    expect(placement.markers).toHaveLength(100);
    expect(placement.rings).toHaveLength(60);
  });
});
