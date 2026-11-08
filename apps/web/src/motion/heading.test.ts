import { describe, expect, test } from "vitest";
import {
  blendHeading,
  courseWeight,
  FULL_COURSE_AT_KN,
  limitTurn,
  MAX_TURN_DEGREES_PER_SECOND,
  REPORTED_ONLY_BELOW_KN,
} from "./heading";
import { signedDelta } from "./sphere";

describe("how much to trust the course", () => {
  test("none at or below a knot, all from the top of the ramp", () => {
    expect(REPORTED_ONLY_BELOW_KN).toBe(1);
    expect(courseWeight(null)).toBe(0);
    expect(courseWeight(0)).toBe(0);
    expect(courseWeight(1)).toBe(0);
    expect(courseWeight(FULL_COURSE_AT_KN)).toBe(1);
    expect(courseWeight(400)).toBe(1);
  });

  test("rises smoothly in between", () => {
    const low = courseWeight(4);
    const high = courseWeight(10);
    expect(low).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThan(1);
  });
});

describe("blending the heading", () => {
  test("a stopped aircraft shows its reported track", () => {
    expect(blendHeading(120, 300, 0.5)).toBe(120);
  });

  test("a fast one shows the course it is travelling on", () => {
    expect(blendHeading(120, 100, 400)).toBe(100);
  });

  test("a slow one sits between the two", () => {
    const blended = blendHeading(100, 120, 8) ?? 0;
    expect(blended).toBeGreaterThan(100);
    expect(blended).toBeLessThan(120);
  });

  test("blends across north without spinning the long way", () => {
    const blended = blendHeading(350, 10, 8) ?? 0;
    expect(Math.abs(signedDelta(blended, 0))).toBeLessThan(1e-6);
  });

  test("uses whichever one it has", () => {
    expect(blendHeading(90, null, 400)).toBe(90);
    expect(blendHeading(null, 45, 400)).toBe(45);
    expect(blendHeading(null, null, 400)).toBeNull();
    expect(blendHeading(null, 45, null)).toBeNull();
  });
});

describe("limiting the turn rate", () => {
  test("turns no faster than the cap", () => {
    expect(MAX_TURN_DEGREES_PER_SECOND).toBe(90);
    expect(limitTurn(0, 180, 0.5)).toBe(45);
    expect(limitTurn(0, 90, 0.5)).toBe(45);
  });

  test("arrives when the turn is small enough", () => {
    expect(limitTurn(10, 20, 1)).toBe(20);
    expect(limitTurn(10, 100, 1)).toBe(100);
  });

  test("takes the short way round north", () => {
    expect(limitTurn(350, 10, 10)).toBe(10);
    expect(limitTurn(10, 350, 0.1)).toBeCloseTo(1, 9);
    expect(limitTurn(350, 30, 0.1)).toBeCloseTo(359, 9);
  });

  test("does not move without time", () => {
    expect(limitTurn(40, 200, 0)).toBe(40);
    expect(limitTurn(40, 200, -1)).toBe(40);
  });

  test("a different cap can be given", () => {
    expect(limitTurn(0, 180, 1, 10)).toBe(10);
  });

  test("stays inside 0 to 360", () => {
    expect(limitTurn(5, 300, 0.01)).toBeGreaterThanOrEqual(0);
    expect(limitTurn(5, 300, 0.01)).toBeLessThan(360);
  });
});
