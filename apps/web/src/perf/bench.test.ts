import { describe, expect, test } from "vitest";
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
} from "@/components/console/markers";
import { distanceMetres } from "@/motion/sphere";
import {
  BENCH_SEED,
  type BenchMover,
  benchMovers,
  benchPositions,
  benchSegmentRows,
  mulberry32,
} from "./bench";

describe("mulberry32", () => {
  test("the same seed gives the same sequence", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    for (let i = 0; i < 50; i++) expect(a()).toBe(b());
  });

  test("different seeds differ and values stay in [0, 1)", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
    const c = mulberry32(3);
    for (let i = 0; i < 10_000; i++) {
      const value = c();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("benchMovers", () => {
  test("is deterministic and has the requested count", () => {
    const first = benchMovers(500, BENCH_SEED);
    expect(first).toHaveLength(500);
    expect(benchMovers(500, BENCH_SEED)).toEqual(first);
    expect(benchMovers(500, BENCH_SEED + 1)).not.toEqual(first);
    expect(benchMovers(0, BENCH_SEED)).toEqual([]);
  });

  test("ids are bench-<index>", () => {
    const movers = benchMovers(3, BENCH_SEED);
    expect(movers.map((mover) => mover.id)).toEqual([
      "bench-0",
      "bench-1",
      "bench-2",
    ]);
  });

  test("the mix is 45% planes, 45% ships and 10% dots within 2%", () => {
    const movers = benchMovers(100_000, BENCH_SEED);
    const share = (glyph: BenchMover["glyph"]) =>
      movers.filter((mover) => mover.glyph === glyph).length / movers.length;
    expect(Math.abs(share("plane") - 0.45)).toBeLessThan(0.02);
    expect(Math.abs(share("ship") - 0.45)).toBeLessThan(0.02);
    expect(Math.abs(share("dot") - 0.1)).toBeLessThan(0.02);
  });

  test("speeds stay inside the range for each kind", () => {
    for (const mover of benchMovers(20_000, BENCH_SEED)) {
      if (mover.glyph === "plane") {
        expect(mover.speedMps).toBeGreaterThanOrEqual(150);
        expect(mover.speedMps).toBeLessThanOrEqual(280);
      } else if (mover.glyph === "ship") {
        expect(mover.speedMps).toBeGreaterThanOrEqual(2);
        expect(mover.speedMps).toBeLessThanOrEqual(12);
      } else {
        expect(mover.speedMps).toBeGreaterThanOrEqual(0);
        expect(mover.speedMps).toBeLessThanOrEqual(8000);
      }
    }
  });

  test("positions are uniform on the sphere, not in degrees", () => {
    const movers = benchMovers(100_000, BENCH_SEED);
    for (const mover of movers.slice(0, 5000)) {
      expect(mover.lon).toBeGreaterThanOrEqual(-180);
      expect(mover.lon).toBeLessThan(180);
      expect(mover.lat).toBeGreaterThanOrEqual(-90);
      expect(mover.lat).toBeLessThanOrEqual(90);
      expect(mover.courseDeg).toBeGreaterThanOrEqual(0);
      expect(mover.courseDeg).toBeLessThan(360);
    }
    const inBand = movers.filter((mover) => Math.abs(mover.lat) < 30).length;
    expect(Math.abs(inBand / movers.length - 0.5)).toBeLessThan(0.01);
    const north = movers.filter((mover) => mover.lat > 0).length;
    expect(Math.abs(north / movers.length - 0.5)).toBeLessThan(0.01);
  });
});

describe("benchPositions", () => {
  const ship: BenchMover = {
    id: "bench-0",
    lon: 10,
    lat: 40,
    courseDeg: 70,
    speedMps: 10,
    glyph: "ship",
  };

  test("writes stride-4 rows with the faded flag at 0", () => {
    const movers = benchMovers(50, BENCH_SEED);
    const out = new Float64Array(movers.length * POSITION_STRIDE);
    expect(benchPositions(movers, 30, out)).toBe(out);
    for (let i = 0; i < movers.length; i++) {
      const at = i * POSITION_STRIDE;
      expect(out[at]).toBeGreaterThanOrEqual(-180);
      expect(out[at]).toBeLessThanOrEqual(180);
      expect(out[at + 1]).toBeGreaterThanOrEqual(-90);
      expect(out[at + 1]).toBeLessThanOrEqual(90);
      expect(out[at + 3]).toBe(0);
      if (movers[i].glyph === "dot") {
        expect(Number.isNaN(out[at + 2])).toBe(true);
      } else {
        expect(out[at + 2]).toBeGreaterThanOrEqual(0);
        expect(out[at + 2]).toBeLessThan(360);
      }
    }
  });

  test("at time zero every mover sits on its start", () => {
    const movers = benchMovers(20, BENCH_SEED);
    const out = benchPositions(
      movers,
      0,
      new Float64Array(movers.length * POSITION_STRIDE),
    );
    movers.forEach((mover, i) => {
      expect(out[i * POSITION_STRIDE]).toBeCloseTo(mover.lon, 6);
      expect(out[i * POSITION_STRIDE + 1]).toBeCloseTo(mover.lat, 6);
    });
  });

  test("a ship at 10 m/s for 100 s moves 1,000 m within a metre", () => {
    const out = benchPositions([ship], 100, new Float64Array(4));
    const moved = distanceMetres(ship.lon, ship.lat, out[0], out[1]);
    expect(Math.abs(moved - 1000)).toBeLessThan(1);
  });

  test("the rotation follows the course", () => {
    const out = benchPositions([ship], 0, new Float64Array(4));
    expect(Math.abs(out[2] - ship.courseDeg)).toBeLessThan(0.05);
  });

  test("a mover with no speed stays put and keeps its course", () => {
    const parked: BenchMover = { ...ship, speedMps: 0 };
    const out = benchPositions([parked], 500, new Float64Array(4));
    expect(out[0]).toBeCloseTo(ship.lon, 9);
    expect(out[1]).toBeCloseTo(ship.lat, 9);
    expect(Math.abs(out[2] - ship.courseDeg)).toBeLessThan(0.05);
  });

  test("crossing the dateline stays inside [-180, 180]", () => {
    const east: BenchMover = {
      id: "bench-1",
      lon: 179.9995,
      lat: 0,
      courseDeg: 90,
      speedMps: 200,
      glyph: "plane",
    };
    const west: BenchMover = { ...east, lon: -179.9995, courseDeg: 270 };
    const out = benchPositions([east, west], 60, new Float64Array(8));
    expect(out[0]).toBeLessThan(0);
    expect(out[0]).toBeGreaterThanOrEqual(-180);
    expect(out[4]).toBeGreaterThan(0);
    expect(out[4]).toBeLessThanOrEqual(180);
  });

  test("a polar track keeps latitude in range", () => {
    const polar: BenchMover = {
      id: "bench-2",
      lon: 20,
      lat: 89.99,
      courseDeg: 0,
      speedMps: 250,
      glyph: "plane",
    };
    const out = benchPositions([polar], 120, new Float64Array(4));
    expect(out[1]).toBeLessThanOrEqual(90);
    expect(out[1]).toBeGreaterThanOrEqual(-90);
    expect(Number.isNaN(out[2])).toBe(false);
  });
});

describe("benchSegmentRows", () => {
  const movers = benchMovers(500, BENCH_SEED);

  test("both ends of a segment are where benchPositions puts the mover", () => {
    const out = new Float64Array(movers.length * SEGMENT_STRIDE);
    benchSegmentRows(movers, 0, movers.length, 30, 8, 1000, false, out);
    const start = benchPositions(
      movers,
      30,
      new Float64Array(movers.length * POSITION_STRIDE),
    );
    const end = benchPositions(
      movers,
      38,
      new Float64Array(movers.length * POSITION_STRIDE),
    );
    for (let i = 0; i < movers.length; i++) {
      const at = i * SEGMENT_STRIDE;
      const from = i * POSITION_STRIDE;
      expect(out[at + SEGMENT_LON0]).toBeCloseTo(start[from], 9);
      expect(out[at + SEGMENT_LAT0]).toBeCloseTo(start[from + 1], 9);
      expect(out[at + SEGMENT_LON1]).toBeCloseTo(end[from], 9);
      expect(out[at + SEGMENT_LAT1]).toBeCloseTo(end[from + 1], 9);
      expect(out[at + SEGMENT_T0]).toBe(1000);
      expect(out[at + SEGMENT_T1]).toBe(1008);
      if (movers[i].glyph === "dot") {
        expect(Number.isNaN(out[at + SEGMENT_H0])).toBe(true);
        expect(Number.isNaN(out[at + SEGMENT_H1])).toBe(true);
      } else {
        expect(out[at + SEGMENT_H0]).toBeCloseTo(start[from + 2], 6);
        expect(out[at + SEGMENT_H1]).toBeCloseTo(end[from + 2], 6);
      }
    }
  });

  test("a chained segment starts where the last one ended", () => {
    const out = new Float64Array(movers.length * SEGMENT_STRIDE);
    benchSegmentRows(movers, 0, movers.length, 0, 10, 500, false, out);
    const previous = out.slice();
    benchSegmentRows(movers, 0, movers.length, 10, 9, 510, true, out);
    for (let i = 0; i < movers.length; i++) {
      const at = i * SEGMENT_STRIDE;
      expect(out[at + SEGMENT_LON0]).toBe(previous[at + SEGMENT_LON1]);
      expect(out[at + SEGMENT_LAT0]).toBe(previous[at + SEGMENT_LAT1]);
      expect(out[at + SEGMENT_T0]).toBe(510);
      expect(out[at + SEGMENT_T1]).toBe(519);
      const end = out.slice(at + SEGMENT_LON1, at + SEGMENT_LAT1 + 1);
      const direct = new Float64Array(movers.length * SEGMENT_STRIDE);
      benchSegmentRows(movers, i, i + 1, 19, 0, 0, false, direct);
      expect(end[0]).toBeCloseTo(direct[at + SEGMENT_LON1], 9);
      expect(end[1]).toBeCloseTo(direct[at + SEGMENT_LAT1], 9);
    }
  });

  test("only the requested range is written", () => {
    const out = new Float64Array(movers.length * SEGMENT_STRIDE).fill(-1);
    benchSegmentRows(movers, 10, 20, 0, 5, 7, false, out);
    expect(out[9 * SEGMENT_STRIDE + SEGMENT_T0]).toBe(-1);
    expect(out[10 * SEGMENT_STRIDE + SEGMENT_T0]).toBe(7);
    expect(out[19 * SEGMENT_STRIDE + SEGMENT_T0]).toBe(7);
    expect(out[20 * SEGMENT_STRIDE + SEGMENT_T0]).toBe(-1);
  });
});
