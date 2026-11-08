import { Cartesian3 } from "cesium";
import { describe, expect, test } from "vitest";
import { ecefToGeodetic, geodeticToEcef } from "./encode";
import {
  evaluateSegmentEcef,
  segmentFraction,
  segmentHeading,
  wrapAngle,
} from "./segment-math";

function ecefOf(lon: number, lat: number): Float64Array {
  const out = new Float64Array(3);
  geodeticToEcef(lon, lat, out, 0);
  return out;
}

function exact(
  start: Float64Array,
  end: Float64Array,
  fraction: number,
): Float64Array {
  const point = new Float64Array(3);
  for (let axis = 0; axis < 3; axis++) {
    point[axis] = start[axis] + (end[axis] - start[axis]) * fraction;
  }
  const r0 = Math.hypot(start[0], start[1], start[2]);
  const r1 = Math.hypot(end[0], end[1], end[2]);
  const target = r0 + (r1 - r0) * fraction;
  const length = Math.hypot(point[0], point[1], point[2]);
  return point.map((value) => (value * target) / length);
}

function delta(a: Float64Array, b: Float64Array): Float64Array {
  return a.map((value, axis) => b[axis] - value);
}

describe("segmentFraction", () => {
  test("clamps to the segment and treats an empty one as the start", () => {
    expect(segmentFraction(10, 20, 5)).toBe(0);
    expect(segmentFraction(10, 20, 15)).toBe(0.5);
    expect(segmentFraction(10, 20, 99)).toBe(1);
    expect(segmentFraction(10, 10, 15)).toBe(0);
    expect(segmentFraction(20, 10, 15)).toBe(0);
  });
});

describe("headings", () => {
  test("wrapAngle returns the shortest signed turn", () => {
    expect(wrapAngle(0)).toBeCloseTo(0, 12);
    expect(wrapAngle(Math.PI * 1.5)).toBeCloseTo(-Math.PI / 2, 12);
    expect(wrapAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2, 12);
    expect(wrapAngle(Math.PI * 4)).toBeCloseTo(0, 12);
  });

  test("segmentHeading turns the short way across north", () => {
    const start = (350 * Math.PI) / 180;
    const end = (10 * Math.PI) / 180;
    expect(segmentHeading(start, end, 0.5)).toBeCloseTo(
      (360 * Math.PI) / 180,
      12,
    );
    expect(segmentHeading(start, end, 0)).toBeCloseTo(start, 12);
    expect(segmentHeading(start, end, 1)).toBeCloseTo(end + 2 * Math.PI, 12);
  });
});

describe("evaluateSegmentEcef", () => {
  const out = new Float64Array(3);

  test("is the start before the segment and the end after it", () => {
    const a = ecefOf(90, 23);
    const b = ecefOf(90.02, 23.01);
    const d = delta(a, b);
    evaluateSegmentEcef(a, d, 0, 100, 110, 50, out, 0);
    expect(Array.from(out)).toEqual(Array.from(a));
    evaluateSegmentEcef(a, d, 0, 100, 110, 500, out, 0);
    for (let axis = 0; axis < 3; axis++) {
      expect(out[axis]).toBeCloseTo(b[axis], 6);
    }
  });

  test.each([
    ["aircraft over 2.5 km", [90, 23], [90.02, 23.01]],
    ["a vessel at 2 m/s", [90, 23], [90.0002, 23.0001]],
    ["a satellite in 1 s", [10, 40], [10.0615, 40.01]],
    ["across the dateline", [179.99, 10], [-179.99, 10.01]],
    ["near the pole", [20, 89.99], [140, 89.99]],
  ])("matches the exact surface path within 1 mm for %s", (_name, from, to) => {
    const a = ecefOf(from[0], from[1]);
    const b = ecefOf(to[0], to[1]);
    const d = delta(a, b);
    for (const fraction of [0.1, 0.25, 0.5, 0.9]) {
      evaluateSegmentEcef(a, d, 0, 0, 10, fraction * 10, out, 0);
      const want = exact(a, b, fraction);
      for (let axis = 0; axis < 3; axis++) {
        expect(Math.abs(out[axis] - want[axis])).toBeLessThan(0.001);
      }
    }
  });

  test("keeps interpolated points on the ellipsoid surface within the sagitta", () => {
    const a = ecefOf(90, 23);
    const b = ecefOf(90.2, 23.1);
    const d = delta(a, b);
    evaluateSegmentEcef(a, d, 0, 0, 10, 5, out, 0);
    const point = { lon: 0, lat: 0 };
    ecefToGeodetic(out[0], out[1], out[2], point);
    const back = ecefOf(point.lon, point.lat);
    expect(
      Math.hypot(out[0] - back[0], out[1] - back[1], out[2] - back[2]),
    ).toBeLessThan(0.5);
  });
});

describe("ecefToGeodetic", () => {
  test("inverts geodeticToEcef within a micrometre of arc for 200 points", () => {
    const point = { lon: 0, lat: 0 };
    for (let i = 0; i < 200; i++) {
      const lon = -180 + (360 * i) / 199;
      const lat = -90 + (180 * ((i * 7) % 200)) / 199;
      const ecef = ecefOf(lon, lat);
      ecefToGeodetic(ecef[0], ecef[1], ecef[2], point);
      expect(Math.abs(point.lat - lat)).toBeLessThan(1e-9);
      if (Math.abs(lat) < 89.999) {
        const wrapped = ((point.lon - lon + 540) % 360) - 180;
        expect(Math.abs(wrapped)).toBeLessThan(1e-9);
      }
    }
  });

  test("agrees with Cesium", () => {
    const cartesian = Cartesian3.fromDegrees(88.3, 22.5);
    const point = { lon: 0, lat: 0 };
    ecefToGeodetic(cartesian.x, cartesian.y, cartesian.z, point);
    expect(point.lon).toBeCloseTo(88.3, 9);
    expect(point.lat).toBeCloseTo(22.5, 9);
  });
});
