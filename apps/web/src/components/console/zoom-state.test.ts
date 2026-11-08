import { describe, expect, test } from "vitest";
import {
  HYSTERESIS,
  initialZoomState,
  nextZoomState,
  stableLevel,
  stableOver,
  type ZoomCaps,
  type ZoomState,
} from "./zoom-state";

const CAPS: ZoomCaps = { satellites: 300 };

function walk(start: number, steps: readonly number[]): ZoomState[] {
  let state = initialZoomState(start, CAPS);
  const seen: ZoomState[] = [state];
  for (const percent of steps) {
    state = nextZoomState(state, percent, CAPS);
    seen.push(state);
  }
  return seen;
}

describe("the starting state", () => {
  test("is the plain level and the plain cap", () => {
    expect(initialZoomState(100, CAPS).level).toBe(2);
    expect(initialZoomState(100, CAPS).name).toBe("GLOBAL");
    expect(initialZoomState(100, CAPS).over.size).toBe(0);
    expect(initialZoomState(450, CAPS).level).toBe(3);
    expect(initialZoomState(450, CAPS).over.has("satellites")).toBe(true);
    expect(initialZoomState(20, CAPS).level).toBe(1);
    expect(initialZoomState(99999, CAPS).percent).toBe(5000);
  });
});

describe("the level", () => {
  test("zooming in takes effect at the boundary, so a button press lands", () => {
    expect(stableLevel(2, 199)).toBe(2);
    expect(stableLevel(2, 200)).toBe(3);
    expect(stableLevel(3, 1000)).toBe(4);
    expect(stableLevel(1, 60)).toBe(2);
  });

  test("zooming out has to cross the boundary by 8% first", () => {
    expect(stableLevel(3, 199)).toBe(3);
    expect(stableLevel(3, 186)).toBe(3);
    expect(stableLevel(3, 200 / (1 + HYSTERESIS))).toBe(3);
    expect(stableLevel(3, 185)).toBe(2);
    expect(stableLevel(4, 950)).toBe(4);
    expect(stableLevel(4, 924)).toBe(3);
    expect(stableLevel(2, 56)).toBe(2);
    expect(stableLevel(2, 55)).toBe(1);
  });

  test("a jump of several levels is taken at once", () => {
    expect(stableLevel(4, 30)).toBe(1);
    expect(stableLevel(1, 4000)).toBe(4);
    expect(stableLevel(3, 100)).toBe(2);
  });

  test("a camera wobbling around a boundary does not change the level", () => {
    const states = walk(150, [199, 200, 199, 201, 195, 205, 190, 199.5, 200]);
    const levels = states.map((s) => s.level);
    // One change, at the first 200, and no change after it.
    expect(levels.filter((l, i) => i > 0 && l !== levels[i - 1])).toEqual([3]);
  });

  test("comes back down once it is clearly below", () => {
    const levels = walk(300, [250, 190, 186, 184, 150]).map((s) => s.level);
    expect(levels).toEqual([3, 3, 3, 3, 2, 2]);
  });
});

describe("a module's own cap", () => {
  test("is past the cap only 8% beyond it, and back inside at the cap", () => {
    expect(stableOver(false, 300, 300)).toBe(false);
    expect(stableOver(false, 320, 300)).toBe(false);
    expect(stableOver(false, 325, 300)).toBe(true);
    expect(stableOver(true, 301, 300)).toBe(true);
    expect(stableOver(true, 300, 300)).toBe(false);
  });

  test("a wobble around 300% does not flicker the satellites", () => {
    const states = walk(280, [301, 299, 305, 298, 302, 310, 320]);
    expect(states.every((s) => !s.over.has("satellites"))).toBe(true);
    const past = nextZoomState(states.at(-1) as ZoomState, 330, CAPS);
    expect(past.over.has("satellites")).toBe(true);
    const back = walk(400, [380, 320, 301, 300]);
    expect(back.map((s) => s.over.has("satellites"))).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  test("keeps the same set object while nothing changes", () => {
    const [first, second] = walk(100, [110]);
    expect(second.over).toBe(first.over);
  });
});
