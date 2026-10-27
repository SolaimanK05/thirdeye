import { describe, expect, test } from "vitest";
import {
  bearingDegrees,
  destination,
  distanceMetres,
  EARTH_RADIUS_M,
  latOf,
  lonOf,
  METRES_PER_KNOT,
  normaliseDegrees,
  normaliseLon,
  signedDelta,
  slerp,
  toVector,
  type Vec3,
} from "./sphere";

describe("angles", () => {
  test("longitude wraps into -180 to 180", () => {
    expect(normaliseLon(190)).toBeCloseTo(-170, 9);
    expect(normaliseLon(-190)).toBeCloseTo(170, 9);
    expect(normaliseLon(360)).toBeCloseTo(0, 9);
    expect(normaliseLon(180)).toBe(180);
    expect(normaliseLon(-180)).toBe(-180);
    expect(normaliseLon(540)).toBe(180);
  });

  test("degrees wrap into 0 to 360", () => {
    expect(normaliseDegrees(-10)).toBe(350);
    expect(normaliseDegrees(370)).toBe(10);
    expect(normaliseDegrees(0)).toBe(0);
  });

  test("the signed difference takes the short way round", () => {
    expect(signedDelta(350, 10)).toBe(20);
    expect(signedDelta(10, 350)).toBe(-20);
    expect(signedDelta(0, 180)).toBe(180);
    expect(signedDelta(180, 0)).toBe(180);
    expect(signedDelta(90, 90)).toBe(0);
  });
});

describe("great circles", () => {
  test("a knot is 1852 metres an hour", () => {
    expect(METRES_PER_KNOT * 3600).toBeCloseTo(1852, 9);
  });

  test("one degree along the equator is about 111 km", () => {
    expect(distanceMetres(0, 0, 1, 0)).toBeCloseTo(
      (EARTH_RADIUS_M * Math.PI) / 180,
      3,
    );
  });

  test("bearings point the way", () => {
    expect(bearingDegrees(0, 0, 1, 0)).toBeCloseTo(90, 6);
    expect(bearingDegrees(0, 0, 0, 1)).toBeCloseTo(0, 6);
    expect(bearingDegrees(0, 0, -1, 0)).toBeCloseTo(270, 6);
    expect(bearingDegrees(0, 0, 0, -1)).toBeCloseTo(180, 6);
  });

  test("a destination follows the bearing and the distance", () => {
    const out = { lon: 0, lat: 0 };
    destination(0, 0, 90, 111_194.93, out);
    expect(out.lon).toBeCloseTo(1, 4);
    expect(out.lat).toBeCloseTo(0, 6);
    destination(0, 0, 0, -111_194.93, out);
    expect(out.lat).toBeCloseTo(-1, 4);
  });

  test("a destination across the dateline comes out on the other side", () => {
    const out = { lon: 0, lat: 0 };
    destination(179.9, 0, 90, 22_238.99, out);
    expect(out.lon).toBeCloseTo(-179.9, 4);
  });

  test("slerp takes the short way across the dateline", () => {
    const a = toVector(179.9, 0, [0, 0, 0] as Vec3);
    const b = toVector(-179.9, 0, [0, 0, 0] as Vec3);
    const mid = slerp(a, b, 0.5, [0, 0, 0] as Vec3);
    expect(Math.abs(Math.abs(lonOf(mid)) - 180)).toBeLessThan(1e-9);
    expect(latOf(mid)).toBeCloseTo(0, 9);
    const quarter = slerp(a, b, 0.25, [0, 0, 0] as Vec3);
    expect(lonOf(quarter)).toBeCloseTo(179.95, 6);
  });

  test("slerp between the same point stays put", () => {
    const a = toVector(10, 20, [0, 0, 0] as Vec3);
    const out = slerp(a, a, 0.7, [0, 0, 0] as Vec3);
    expect(lonOf(out)).toBeCloseTo(10, 9);
    expect(latOf(out)).toBeCloseTo(20, 9);
  });
});
