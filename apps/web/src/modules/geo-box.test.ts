import { describe, expect, test } from "vitest";
import { boxContains, boxWidth, padBox, sameBox } from "./geo-box";

const europe = { west: -10, south: 35, east: 30, north: 60 };
const pacific = { west: 170, south: -20, east: -170, north: 20 };

describe("boxContains", () => {
  test("a null box is the whole globe", () => {
    expect(boxContains(null, 120, -80)).toBe(true);
  });

  test("edges count as inside", () => {
    expect(boxContains(europe, -10, 35)).toBe(true);
    expect(boxContains(europe, 30, 60)).toBe(true);
    expect(boxContains(europe, 30.01, 50)).toBe(false);
    expect(boxContains(europe, 0, 60.01)).toBe(false);
  });

  test("a box over the antimeridian takes both sides", () => {
    expect(boxContains(pacific, 175, 0)).toBe(true);
    expect(boxContains(pacific, -175, 0)).toBe(true);
    expect(boxContains(pacific, 180, 0)).toBe(true);
    expect(boxContains(pacific, 0, 0)).toBe(false);
    expect(boxContains(pacific, 165, 0)).toBe(false);
  });

  test("a missing coordinate is outside", () => {
    expect(boxContains(europe, Number.NaN, 40)).toBe(false);
    expect(boxContains(europe, 0, Number.NaN)).toBe(false);
  });
});

describe("boxWidth", () => {
  test("measures across the antimeridian", () => {
    expect(boxWidth(europe)).toBe(40);
    expect(boxWidth(pacific)).toBe(20);
  });
});

describe("padBox", () => {
  test("grows by the share on every side and stays on the map", () => {
    expect(padBox(europe, 0.1)).toEqual({
      west: -14,
      east: 34,
      south: 32.5,
      north: 62.5,
    });
    expect(
      padBox({ west: -20, south: -88, east: 20, north: 89 }, 0.1)?.south,
    ).toBe(-90);
    expect(
      padBox({ west: -20, south: -88, east: 20, north: 89 }, 0.1)?.north,
    ).toBe(90);
  });

  test("wraps the longitudes and keeps an antimeridian box together", () => {
    expect(padBox(pacific, 0.5)).toEqual({
      west: 160,
      east: -160,
      south: -40,
      north: 40,
    });
  });

  test("a box as wide as the globe becomes no box", () => {
    expect(
      padBox({ west: -170, south: -50, east: 170, north: 50 }, 0.15),
    ).toBeNull();
    expect(padBox(null, 0.1)).toBeNull();
  });
});

describe("sameBox", () => {
  test("compares the four edges, and null with null", () => {
    expect(sameBox(europe, { ...europe })).toBe(true);
    expect(sameBox(europe, { ...europe, north: 61 })).toBe(false);
    expect(sameBox(null, null)).toBe(true);
    expect(sameBox(null, europe)).toBe(false);
  });
});
