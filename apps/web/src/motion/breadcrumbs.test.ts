import { describe, expect, test } from "vitest";
import { Breadcrumbs, CRUMB_COUNT, CRUMB_SPACING_PX } from "./breadcrumbs";

const METRES_PER_PIXEL = 1000;
const SPACING_DEGREES = (CRUMB_SPACING_PX * METRES_PER_PIXEL) / 111_194.9266;

describe("Breadcrumbs", () => {
  test("starts empty", () => {
    expect(new Breadcrumbs().points).toEqual([]);
  });

  test("the first position is kept straight away", () => {
    const crumbs = new Breadcrumbs();
    expect(crumbs.record(10, 5, METRES_PER_PIXEL)).toBe(true);
    expect(crumbs.points).toEqual([{ lon: 10, lat: 5 }]);
  });

  test("nothing is added until the aircraft has moved the spacing", () => {
    const crumbs = new Breadcrumbs();
    crumbs.record(10, 0, METRES_PER_PIXEL);
    expect(crumbs.record(10 + SPACING_DEGREES * 0.9, 0, METRES_PER_PIXEL)).toBe(
      false,
    );
    expect(crumbs.points).toHaveLength(1);
    expect(
      crumbs.record(10 + SPACING_DEGREES * 1.01, 0, METRES_PER_PIXEL),
    ).toBe(true);
    expect(crumbs.points).toHaveLength(2);
  });

  test("the spacing is measured from the last dot, not the last position", () => {
    const crumbs = new Breadcrumbs();
    crumbs.record(0, 0, METRES_PER_PIXEL);
    for (let step = 1; step <= 100; step++) {
      crumbs.record((SPACING_DEGREES * step) / 10, 0, METRES_PER_PIXEL);
    }
    expect(crumbs.points).toHaveLength(CRUMB_COUNT);
    const lons = crumbs.points.map((p) => p.lon);
    for (let i = 1; i < lons.length; i++) {
      expect(lons[i] - lons[i - 1]).toBeGreaterThan(SPACING_DEGREES * 0.999);
      expect(lons[i] - lons[i - 1]).toBeLessThan(SPACING_DEGREES * 1.2);
    }
  });

  test("the spacing grows with the distance one pixel covers", () => {
    const near = new Breadcrumbs();
    const far = new Breadcrumbs();
    near.record(0, 0, 100);
    far.record(0, 0, 10_000);
    const lon = (CRUMB_SPACING_PX * 1000) / 111_194.9266;
    expect(near.record(lon, 0, 100)).toBe(true);
    expect(far.record(lon, 0, 10_000)).toBe(false);
  });

  test("keeps only the newest dots", () => {
    const crumbs = new Breadcrumbs();
    for (let n = 0; n < CRUMB_COUNT + 4; n++) {
      crumbs.record(n * SPACING_DEGREES * 2, 0, METRES_PER_PIXEL);
    }
    expect(crumbs.points).toHaveLength(CRUMB_COUNT);
    expect(crumbs.points[CRUMB_COUNT - 1].lon).toBeCloseTo(
      (CRUMB_COUNT + 3) * SPACING_DEGREES * 2,
      9,
    );
  });

  test("clearing forgets everything and reports whether it did", () => {
    const crumbs = new Breadcrumbs();
    expect(crumbs.clear()).toBe(false);
    crumbs.record(1, 1, METRES_PER_PIXEL);
    expect(crumbs.clear()).toBe(true);
    expect(crumbs.points).toEqual([]);
    expect(crumbs.record(2, 2, METRES_PER_PIXEL)).toBe(true);
    expect(crumbs.points).toEqual([{ lon: 2, lat: 2 }]);
  });

  test("ignores positions that are not numbers", () => {
    const crumbs = new Breadcrumbs();
    expect(crumbs.record(Number.NaN, 0, METRES_PER_PIXEL)).toBe(false);
    expect(crumbs.record(0, Number.POSITIVE_INFINITY, METRES_PER_PIXEL)).toBe(
      false,
    );
    expect(crumbs.points).toEqual([]);
  });

  test("adds nothing when the scale is unusable", () => {
    const crumbs = new Breadcrumbs();
    crumbs.record(0, 0, METRES_PER_PIXEL);
    expect(crumbs.record(50, 0, 0)).toBe(false);
    expect(crumbs.record(50, 0, Number.NaN)).toBe(false);
  });

  test("measures the short way across the dateline", () => {
    const crumbs = new Breadcrumbs();
    crumbs.record(179.999, 0, METRES_PER_PIXEL);
    expect(crumbs.record(-179.999, 0, METRES_PER_PIXEL)).toBe(false);
    expect(crumbs.record(-179.7, 0, METRES_PER_PIXEL)).toBe(true);
  });

  test("returns a new list each time it changes", () => {
    const crumbs = new Breadcrumbs();
    crumbs.record(0, 0, METRES_PER_PIXEL);
    const before = crumbs.points;
    crumbs.record(SPACING_DEGREES * 2, 0, METRES_PER_PIXEL);
    expect(crumbs.points).not.toBe(before);
    expect(before).toHaveLength(1);
  });
});
