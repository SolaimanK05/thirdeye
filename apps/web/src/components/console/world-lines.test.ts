import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import {
  cleanLines,
  graticule,
  packedLine,
  packedLineCount,
  packLines,
  type WorldTopology,
  worldLines,
} from "./world-lines";

const require = createRequire(import.meta.url);

function atlas(detail: "110m" | "50m"): WorldTopology {
  return JSON.parse(
    readFileSync(
      require.resolve(`world-atlas/countries-${detail}.json`),
      "utf8",
    ),
  );
}

describe("cleanLines", () => {
  test("drops repeated points and lines that collapse to one point", () => {
    expect(
      cleanLines([
        [
          [10, 10],
          [10, 10],
          [11, 10],
        ],
        [
          [5, 5],
          [5, 5],
        ],
      ]),
    ).toEqual([
      [
        [10, 10],
        [11, 10],
      ],
    ]);
  });

  test("splits lines at the antimeridian cut", () => {
    expect(
      cleanLines([
        [
          [179, 66],
          [180, 66],
          [180, 68],
          [179, 69],
        ],
      ]),
    ).toEqual([
      [
        [179, 66],
        [180, 66],
      ],
      [
        [180, 68],
        [179, 69],
      ],
    ]);
  });

  test("splits lines along the southern edge of the data", () => {
    expect(
      cleanLines([
        [
          [-170, -84.5],
          [-180, -90],
          [180, -90],
          [170, -84.5],
        ],
      ]),
    ).toEqual([
      [
        [-170, -84.5],
        [-180, -90],
      ],
      [
        [180, -90],
        [170, -84.5],
      ],
    ]);
  });
});

describe("worldLines", () => {
  for (const detail of ["110m", "50m"] as const) {
    test(`${detail} has coastlines, borders and land, with no seams`, () => {
      const { coast, borders, land } = worldLines(atlas(detail));
      expect(coast.length).toBeGreaterThan(100);
      expect(borders.length).toBeGreaterThan(100);
      expect(land.features.length).toBeGreaterThan(0);
      for (const line of [...coast, ...borders]) {
        expect(line.length).toBeGreaterThan(1);
        for (let i = 1; i < line.length; i++) {
          const [a, b] = [line[i - 1], line[i]];
          const onCut = Math.abs(a[0]) === 180 && a[0] === b[0];
          expect(onCut).toBe(false);
        }
      }
    });
  }

  test("50m has more detail than 110m", () => {
    const points = (detail: "110m" | "50m") =>
      worldLines(atlas(detail)).coast.reduce((n, l) => n + l.length, 0);
    expect(points("50m")).toBeGreaterThan(points("110m") * 5);
  });
});

describe("graticule", () => {
  test("15° gives 24 pole-to-pole meridians and 11 parallels", () => {
    const { meridians, parallels } = graticule(15);
    expect(meridians).toHaveLength(24);
    expect(parallels).toHaveLength(11);
    expect(meridians[0][0]).toEqual([-180, -90]);
    expect(meridians[0].at(-1)).toEqual([-180, 90]);
    expect(parallels.map((p) => p[0][1])).toEqual([
      -75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75,
    ]);
    expect(parallels[0].at(-1)).toEqual([180, -75]);
  });
});

describe("packed lines", () => {
  test("pack into flat arrays and read back line by line", () => {
    const packed = packLines([
      [
        [1, 2],
        [3, 4],
      ],
      [
        [5, 6],
        [7, 8],
        [9, 10],
      ],
    ]);
    expect(packed.coordinates).toBeInstanceOf(Float64Array);
    expect(Array.from(packed.starts)).toEqual([0, 2, 5]);
    expect(packedLineCount(packed)).toBe(2);
    expect(Array.from(packedLine(packed, 0))).toEqual([1, 2, 3, 4]);
    expect(Array.from(packedLine(packed, 1))).toEqual([5, 6, 7, 8, 9, 10]);
  });

  test("an empty set packs to nothing", () => {
    const packed = packLines([]);
    expect(packedLineCount(packed)).toBe(0);
    expect(packed.coordinates.length).toBe(0);
  });

  test("the real coastline survives a round trip", () => {
    const { coast } = worldLines(atlas("110m"));
    const packed = packLines(coast);
    expect(packedLineCount(packed)).toBe(coast.length);
    expect(Array.from(packedLine(packed, 7))).toEqual(coast[7].flat());
  });
});
