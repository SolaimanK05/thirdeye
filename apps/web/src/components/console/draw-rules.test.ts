import { describe, expect, test } from "vitest";
import {
  clipsToView,
  type DrawItem,
  type DrawModule,
  type DrawView,
  inZoomRange,
  isDrawn,
  type Scope,
  scopeOf,
  severityFloor,
} from "./draw-rules";
import type { Filter, ZoomLevel } from "./types";

const quakes: DrawModule = {
  filter: "all",
  usable: true,
  zoomRange: [1, 4],
  minSeverityAt: { 1: 5 },
};
const aircraft: DrawModule = {
  filter: "all",
  usable: true,
  zoomRange: [2, 4],
};
const satellites: DrawModule = {
  filter: "all",
  usable: true,
  zoomRange: [1, 3],
};

const at = (level: ZoomLevel, over = false): DrawView => ({ level, over });
const plain: DrawItem = { starred: false };
const star: DrawItem = { starred: true };

describe("what a module draws as a whole", () => {
  const cases: [string, DrawModule, DrawView, Scope][] = [
    ["inside its range", aircraft, at(2), "all"],
    ["inside its range, LOCAL", aircraft, at(4), "all"],
    ["below its range keeps only starred", aircraft, at(1), "starred"],
    ["above its range keeps only starred", satellites, at(4), "starred"],
    ["past its own cap keeps only starred", satellites, at(3, true), "starred"],
    ["inside its cap draws all", satellites, at(3, false), "all"],
    [
      "no map layer keeps only starred",
      { ...aircraft, zoomRange: null },
      at(2),
      "starred",
    ],
    ["NONE draws nothing", { ...aircraft, filter: "none" }, at(2), "none"],
    [
      "NONE draws nothing out of range either",
      { ...aircraft, filter: "none" },
      at(1),
      "none",
    ],
    [
      "a missing key draws nothing",
      { ...aircraft, usable: false },
      at(2),
      "none",
    ],
    [
      "STARRED is starred at any zoom",
      { ...aircraft, filter: "starred" },
      at(2),
      "starred",
    ],
    [
      "STARRED is starred out of range",
      { ...aircraft, filter: "starred" },
      at(1),
      "starred",
    ],
  ];
  test.each(cases)("%s", (_name, module, view, expected) => {
    expect(scopeOf(module, view)).toBe(expected);
  });

  test("the filter comes first, whatever the zoom", () => {
    for (const filter of ["none"] satisfies Filter[]) {
      for (const level of [1, 2, 3, 4] as const) {
        expect(scopeOf({ ...aircraft, filter }, at(level))).toBe("none");
      }
    }
  });
});

describe("what one item does", () => {
  const cases: [string, DrawModule, DrawItem, DrawView, boolean][] = [
    ["a plain aircraft inside the range", aircraft, plain, at(2), true],
    ["a plain aircraft at ORBIT", aircraft, plain, at(1), false],
    ["a starred aircraft at ORBIT ignores zoom", aircraft, star, at(1), true],
    ["a starred satellite past its cap", satellites, star, at(3, true), true],
    ["a plain satellite past its cap", satellites, plain, at(3, true), false],
    [
      "a starred item under NONE is not drawn",
      { ...aircraft, filter: "none" },
      star,
      at(2),
      false,
    ],
    [
      "a starred item with a missing key is not drawn",
      { ...aircraft, usable: false },
      star,
      at(2),
      false,
    ],
    [
      "STARRED hides the plain ones",
      { ...aircraft, filter: "starred" },
      plain,
      at(2),
      false,
    ],
    [
      "STARRED draws the starred ones",
      { ...aircraft, filter: "starred" },
      star,
      at(1),
      true,
    ],
    [
      "M5 at ORBIT is drawn",
      quakes,
      { starred: false, severity: 5 },
      at(1),
      true,
    ],
    [
      "M4.9 at ORBIT is not",
      quakes,
      { starred: false, severity: 4.9 },
      at(1),
      false,
    ],
    [
      "an unknown magnitude at ORBIT is not",
      quakes,
      { starred: false, severity: null },
      at(1),
      false,
    ],
    [
      "M2 at GLOBAL is drawn",
      quakes,
      { starred: false, severity: 2 },
      at(2),
      true,
    ],
    [
      "M2 at ORBIT but selected is drawn",
      quakes,
      { starred: false, selected: true, severity: 2 },
      at(1),
      true,
    ],
    [
      "no severity at all is drawn where there is no floor",
      aircraft,
      plain,
      at(2),
      true,
    ],
  ];
  test.each(cases)("%s", (_name, module, item, view, expected) => {
    expect(isDrawn(module, item, view)).toBe(expected);
  });
});

describe("the severity floor is data", () => {
  test("reads the level from the table", () => {
    expect(severityFloor(quakes, 1)).toBe(5);
    expect(severityFloor(quakes, 2)).toBe(0);
    expect(severityFloor(aircraft, 1)).toBe(0);
  });
});

describe("the zoom range", () => {
  test("is inclusive at both ends and false without a layer", () => {
    expect(inZoomRange([2, 3], at(1))).toBe(false);
    expect(inZoomRange([2, 3], at(2))).toBe(true);
    expect(inZoomRange([2, 3], at(3))).toBe(true);
    expect(inZoomRange([2, 3], at(4))).toBe(false);
    expect(inZoomRange(null, at(2))).toBe(false);
    expect(inZoomRange([1, 4], at(2, true))).toBe(false);
  });
});

describe("SHOW HERE", () => {
  const pinned: DrawModule = { ...aircraft, pinned: true };
  const here: DrawItem = { starred: false, inView: true };
  const away: DrawItem = { starred: false, inView: false };

  test("a pinned module out of range draws, clipped to the view", () => {
    expect(scopeOf(pinned, at(1))).toBe("all");
    expect(clipsToView(pinned, at(1))).toBe(true);
    expect(isDrawn(pinned, here, at(1))).toBe(true);
    expect(isDrawn(pinned, away, at(1))).toBe(false);
  });

  test("a pinned satellite module past its cap works the same way", () => {
    const sats: DrawModule = { ...satellites, pinned: true };
    expect(clipsToView(sats, at(3, true))).toBe(true);
    expect(isDrawn(sats, away, at(3, true))).toBe(false);
    expect(isDrawn(sats, here, at(3, true))).toBe(true);
  });

  test("inside the range a pin changes nothing and nothing is clipped", () => {
    expect(clipsToView(pinned, at(2))).toBe(false);
    expect(isDrawn(pinned, away, at(2))).toBe(true);
  });

  test("starred items are drawn wherever they are", () => {
    expect(isDrawn(pinned, { starred: true, inView: false }, at(1))).toBe(true);
  });

  test("a pin never beats the filter or a missing key", () => {
    expect(scopeOf({ ...pinned, filter: "none" }, at(1))).toBe("none");
    expect(scopeOf({ ...pinned, usable: false }, at(1))).toBe("none");
    expect(scopeOf({ ...pinned, filter: "starred" }, at(1))).toBe("starred");
    expect(clipsToView({ ...pinned, filter: "none" }, at(1))).toBe(false);
  });

  test("without a pin nothing is clipped", () => {
    expect(clipsToView(aircraft, at(1))).toBe(false);
    expect(isDrawn(aircraft, here, at(1))).toBe(false);
  });
});
