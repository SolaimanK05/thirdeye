import { describe, expect, test } from "vitest";
import { type LabelCandidate, overlaps, placeLabels } from "./label-layout";

const box = (
  x: number,
  y: number,
  priority = 0,
  width = 40,
  height = 15,
): LabelCandidate => ({ x, y, width, height, priority });

describe("overlaps", () => {
  test("detects crossing boxes", () => {
    expect(overlaps(box(0, 0), box(30, 10))).toBe(true);
  });

  test("boxes that only touch do not overlap", () => {
    expect(overlaps(box(0, 0), box(40, 0))).toBe(false);
    expect(overlaps(box(0, 0), box(0, 15))).toBe(false);
  });
});

describe("placeLabels", () => {
  test("keeps the higher priority label when two collide", () => {
    const low = box(0, 0, 1);
    const high = box(10, 5, 9);
    expect(placeLabels([low, high], 10)).toEqual([high]);
  });

  test("keeps every label that fits", () => {
    const boxes = [box(0, 0), box(50, 0), box(0, 20)];
    expect(placeLabels(boxes, 10)).toHaveLength(3);
  });

  test("stops at the limit, best first", () => {
    const boxes = [box(0, 0, 1), box(50, 0, 3), box(100, 0, 2)];
    expect(placeLabels(boxes, 2).map((b) => b.priority)).toEqual([3, 2]);
  });

  test("skips labels that sit on blocked areas", () => {
    expect(placeLabels([box(0, 0), box(100, 0)], 10, [box(5, 5)])).toEqual([
      box(100, 0),
    ]);
  });

  test("breaks ties by input order", () => {
    const first = box(0, 0, 1);
    const second = box(10, 0, 1);
    expect(placeLabels([first, second], 10)).toEqual([first]);
  });

  test("does not change its input", () => {
    const input = [box(0, 0, 1), box(100, 0, 2)];
    placeLabels(input, 10);
    expect(input.map((b) => b.priority)).toEqual([1, 2]);
  });
});
