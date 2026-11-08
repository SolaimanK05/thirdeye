import { describe, expect, test } from "vitest";
import {
  positionAt,
  splitAtAntimeridian,
  type TrailFix,
  toTrail,
  trailUpTo,
} from "./trail";

const at = (minute: number, lon: number, lat: number): TrailFix => ({
  t: Date.UTC(2026, 10, 5, 12, minute),
  lon,
  lat,
});

describe("toTrail", () => {
  test("sorts by time and drops rows it cannot read", () => {
    const trail = toTrail([
      { t: "2026-11-05T12:10:00Z", position: { lon: 2, lat: 2 } },
      { t: "not a time", position: { lon: 9, lat: 9 } },
      { t: "2026-11-05T12:00:00Z", position: { lon: 1, lat: 1 } },
      { t: "2026-11-05T12:05:00Z", position: { lon: Number.NaN, lat: 1 } },
    ]);
    expect(trail.map((fix) => fix.lon)).toEqual([1, 2]);
  });
});

describe("splitAtAntimeridian", () => {
  test("keeps a trail in one piece when it stays on one side", () => {
    const segments = splitAtAntimeridian([
      { lon: 10, lat: 0 },
      { lon: 20, lat: 1 },
    ]);
    expect(segments).toEqual([
      [
        [10, 0],
        [20, 1],
      ],
    ]);
  });

  test("cuts where the trail crosses 180 degrees", () => {
    const segments = splitAtAntimeridian([
      { lon: 170, lat: 0 },
      { lon: 179, lat: 0 },
      { lon: -179, lat: 0 },
      { lon: -170, lat: 0 },
    ]);
    expect(segments).toHaveLength(2);
    expect(segments[0].at(-1)).toEqual([179, 0]);
    expect(segments[1][0]).toEqual([-179, 0]);
  });

  test("a lone point makes no line", () => {
    expect(splitAtAntimeridian([{ lon: 1, lat: 1 }])).toEqual([]);
  });
});

describe("positionAt", () => {
  const trail = [at(0, 0, 0), at(10, 10, 20), at(20, 10, 40)];

  test("is null before the first fix and the last fix after the end", () => {
    expect(positionAt(trail, trail[0].t - 1)).toBeNull();
    expect(positionAt(trail, trail[2].t + 60_000)).toEqual({
      lon: 10,
      lat: 40,
    });
    expect(positionAt([], 0)).toBeNull();
  });

  test("interpolates between two fixes", () => {
    expect(positionAt(trail, at(5, 0, 0).t)).toEqual({ lon: 5, lat: 10 });
    expect(positionAt(trail, at(15, 0, 0).t)).toEqual({ lon: 10, lat: 30 });
  });

  test("takes the short way round the antimeridian", () => {
    const crossing = [at(0, 170, 0), at(10, -170, 0)];
    const middle = positionAt(crossing, at(5, 0, 0).t);
    expect(Math.abs(middle?.lon ?? 0)).toBe(180);
  });
});

describe("trailUpTo", () => {
  const trail = [at(0, 0, 0), at(10, 10, 20), at(20, 10, 40)];

  test("ends at the interpolated position", () => {
    expect(trailUpTo(trail, at(15, 0, 0).t)).toEqual([
      trail[0],
      trail[1],
      { lon: 10, lat: 30 },
    ]);
  });

  test("is empty before the trail starts", () => {
    expect(trailUpTo(trail, trail[0].t - 1)).toEqual([]);
  });
});
