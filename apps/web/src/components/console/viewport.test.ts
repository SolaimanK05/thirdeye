import { describe, expect, test } from "vitest";
import type { ViewBox } from "@/state/viewport";
import { boxParam, clusterFor, queryBox, WORLD_BOX } from "./viewport";

const span = (west: number, east: number) =>
  east >= west ? east - west : east + 360 - west;

function covers(outer: ViewBox, inner: ViewBox): boolean {
  if (outer.south > inner.south || outer.north < inner.north) return false;
  if (outer.west === -180 && outer.east === 180) return true;
  const start = ((inner.west - outer.west + 540) % 360) - 180;
  const offset = start < 0 ? start + 360 : start;
  return offset + span(inner.west, inner.east) <= span(outer.west, outer.east);
}

function pseudoRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const BANGLADESH: ViewBox = { west: 88, south: 20, east: 93, north: 27 };

describe("queryBox", () => {
  test("no view yet means the whole world", () => {
    expect(queryBox(null)).toEqual(WORLD_BOX);
  });

  test("a regional view becomes a padded box on a whole-degree grid", () => {
    const box = queryBox(BANGLADESH);
    expect(box).toEqual({ west: 86, south: 18, east: 96, north: 30 });
    expect(covers(box, BANGLADESH)).toBe(true);
  });

  test("small pans stay inside the same box, so nothing refetches", () => {
    const here = queryBox(BANGLADESH);
    const nudged = queryBox({
      west: 88.4,
      south: 20.3,
      east: 93.4,
      north: 27.3,
    });
    expect(nudged).toEqual(here);
  });

  test("a larger view uses a coarser grid", () => {
    const box = queryBox({ west: 60, south: -10, east: 150, north: 55 });
    expect(Math.abs(box.west % 45)).toBe(0);
    expect(Math.abs(box.south % 45)).toBe(0);
    expect(covers(box, { west: 60, south: -10, east: 150, north: 55 })).toBe(
      true,
    );
  });

  test("a view that nearly spans the globe asks for every longitude", () => {
    expect(queryBox({ west: -180, south: -75, east: 180, north: 75 })).toEqual({
      west: -180,
      south: -90,
      east: 180,
      north: 90,
    });
    const wide = queryBox({ west: -120, south: -40, east: 120, north: 40 });
    expect([wide.west, wide.east]).toEqual([-180, 180]);
  });

  test("latitude never leaves the poles", () => {
    const box = queryBox({ west: 0, south: 70, east: 40, north: 90 });
    expect(box.north).toBe(90);
    expect(box.south).toBeGreaterThanOrEqual(-90);
  });

  test("a view across the antimeridian keeps both sides, as west above east", () => {
    const view: ViewBox = { west: 170, south: -20, east: -170, north: 10 };
    const box = queryBox(view);
    expect(box.west).toBeGreaterThan(box.east);
    expect(covers(box, view)).toBe(true);
    expect(span(box.west, box.east)).toBeLessThan(120);
  });

  test("the box always covers the view and stays valid for the API", () => {
    const random = pseudoRandom(42);
    for (let i = 0; i < 500; i++) {
      const west = -180 + random() * 360;
      const width = 0.5 + random() * 200;
      const south = -90 + random() * 170;
      const height = 0.5 + random() * Math.min(90, 170 - (south + 90) + 10);
      const view: ViewBox = {
        west,
        south,
        east: west + width > 180 ? west + width - 360 : west + width,
        north: Math.min(90, south + height),
      };
      const box = queryBox(view);
      expect(covers(box, view), JSON.stringify({ view, box })).toBe(true);
      expect(box.west).toBeGreaterThanOrEqual(-180);
      expect(box.west).toBeLessThanOrEqual(180);
      expect(box.east).toBeGreaterThanOrEqual(-180);
      expect(box.east).toBeLessThanOrEqual(180);
      expect(box.south).toBeGreaterThanOrEqual(-90);
      expect(box.north).toBeLessThanOrEqual(90);
      expect(box.south).toBeLessThan(box.north);
      expect(box.west).not.toBe(box.east);
    }
  });
});

describe("boxParam", () => {
  test("is west,south,east,north", () => {
    expect(boxParam({ west: -180, south: -90, east: 180, north: 90 })).toBe(
      "-180,-90,180,90",
    );
    expect(boxParam({ west: 86, south: 18, east: 96, north: 30 })).toBe(
      "86,18,96,30",
    );
  });
});

describe("clusterFor", () => {
  test("the whole world uses the coarsest cells and hides weak clusters", () => {
    expect(clusterFor(WORLD_BOX)).toEqual({ cell: 8, minSeverity: 30 });
  });

  test("cells shrink as the view narrows", () => {
    const cells = [360, 180, 90, 45, 20, 10, 5, 2, 1].map(
      (span) =>
        clusterFor({ west: 0, south: 0, east: span, north: span })?.cell,
    );
    expect(cells).toEqual([8, 4, 2, 1, 0.5, 0.25, 0.25, 0.05, 0.05]);
    for (let i = 1; i < cells.length; i++) {
      expect(cells[i] ?? 0).toBeLessThanOrEqual(cells[i - 1] ?? 0);
    }
  });

  test("the power floor drops as the cells shrink", () => {
    const floors = [360, 180, 90, 20, 10, 2].map(
      (span) =>
        clusterFor({ west: 0, south: 0, east: span, north: span })?.minSeverity,
    );
    expect(floors).toEqual([30, 30, 10, 3, 1, 0]);
  });

  test("a close view shows single detections without any floor", () => {
    expect(clusterFor({ west: 90, south: 22, east: 90.5, north: 22.5 })).toBe(
      null,
    );
  });

  test("the larger side of the box decides", () => {
    expect(clusterFor({ west: 0, south: 0, east: 2, north: 40 })).toEqual(
      clusterFor({ west: 0, south: 0, east: 40, north: 2 }),
    );
  });

  test("a box across the antimeridian is measured across the seam", () => {
    expect(clusterFor({ west: 170, south: 0, east: -170, north: 5 })).toEqual(
      clusterFor({ west: 0, south: 0, east: 20, north: 5 }),
    );
  });

  test("the same padded query box always gives the same choice", () => {
    const view: ViewBox = { west: 88, south: 20, east: 93, north: 27 };
    const nudged: ViewBox = {
      west: 88.4,
      south: 20.3,
      east: 93.4,
      north: 27.3,
    };
    expect(clusterFor(queryBox(nudged))).toEqual(clusterFor(queryBox(view)));
  });
});
