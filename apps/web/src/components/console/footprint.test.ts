import { describe, expect, test } from "vitest";
import { distanceKm, RING_POINTS, ringPoints } from "./footprint";

describe("ringPoints", () => {
  test("every point is the radius away from the centre", () => {
    for (const [lon, lat, radius] of [
      [0, 0, 2500],
      [90, 45, 1200],
      [-120, -60, 3000],
      [179, 10, 2000],
      [10, 85, 1500],
    ] as const) {
      const out = ringPoints(
        lon,
        lat,
        radius,
        RING_POINTS,
        new Float64Array(RING_POINTS * 2),
      );
      for (let i = 0; i < RING_POINTS; i++) {
        expect(distanceKm(lon, lat, out[i * 2], out[i * 2 + 1])).toBeCloseTo(
          radius,
          3,
        );
      }
    }
  });

  test("longitudes stay in range across the antimeridian", () => {
    const out = ringPoints(
      179,
      0,
      2000,
      RING_POINTS,
      new Float64Array(RING_POINTS * 2),
    );
    for (let i = 0; i < RING_POINTS; i++) {
      expect(out[i * 2]).toBeGreaterThanOrEqual(-180);
      expect(out[i * 2]).toBeLessThan(180);
    }
    expect(
      Array.from({ length: RING_POINTS }, (_, i) => out[i * 2]).some(
        (v) => v < 0,
      ),
    ).toBe(true);
  });

  test("starts due north and goes clockwise", () => {
    const out = ringPoints(10, 20, 1000, 4, new Float64Array(8));
    expect(out[0]).toBeCloseTo(10, 6);
    expect(out[1]).toBeGreaterThan(20);
    expect(out[2]).toBeGreaterThan(10);
    expect(out[5]).toBeLessThan(20);
    expect(out[6]).toBeLessThan(10);
  });

  test("a zero radius is the centre", () => {
    const out = ringPoints(33, -12, 0, 8, new Float64Array(16));
    for (let i = 0; i < 8; i++) {
      expect(out[i * 2]).toBeCloseTo(33, 6);
      expect(out[i * 2 + 1]).toBeCloseTo(-12, 6);
    }
  });
});

describe("distanceKm", () => {
  test("a quarter of the equator", () => {
    expect(distanceKm(0, 0, 90, 0)).toBeCloseTo((Math.PI / 2) * 6371, 3);
    expect(distanceKm(5, 5, 5, 5)).toBe(0);
  });
});
