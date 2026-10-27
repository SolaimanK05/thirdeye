import { describe, expect, test } from "vitest";
import type { Fix } from "./history";
import {
  EXTRAPOLATION_CAP_SECONDS,
  newPose,
  poseAt,
  WARMUP_CAP_SECONDS,
} from "./interpolate";
import { METRES_PER_KNOT } from "./sphere";

const T0 = 1_800_000_000_000;
const DEGREE_METRES = 111_194.926645;

function fix(
  seconds: number,
  lon: number,
  lat = 0,
  extra: Partial<Fix> = {},
): Fix {
  return {
    t: T0 + seconds * 1000,
    lon,
    lat,
    sog: null,
    cog: null,
    track: null,
    ...extra,
  };
}

const at = (seconds: number) => T0 + seconds * 1000;

describe("between two fixes", () => {
  const fixes = [fix(0, 0), fix(100, 10)];

  test("a point inside the bracket sits on the line between them", () => {
    const pose = poseAt(fixes, at(50));
    expect(pose?.lon).toBeCloseTo(5, 6);
    expect(pose?.lat).toBeCloseTo(0, 9);
    expect(pose?.mode).toBe("interpolated");
    expect(pose?.stale).toBe(false);
  });

  test("a quarter of the way is a quarter of the distance", () => {
    expect(poseAt(fixes, at(25))?.lon).toBeCloseTo(2.5, 6);
  });

  test("the fixes themselves come back exactly", () => {
    expect(poseAt(fixes, at(0))?.lon).toBeCloseTo(0, 9);
    expect(poseAt(fixes, at(100))?.lon).toBeCloseTo(10, 9);
  });

  test("the course points toward the next fix and the speed is derived", () => {
    const pose = poseAt(fixes, at(40));
    expect(pose?.course).toBeCloseTo(90, 4);
    const expected = (10 * DEGREE_METRES) / 100 / METRES_PER_KNOT;
    expect(Math.abs((pose?.speedKn ?? 0) - expected) / expected).toBeLessThan(
      1e-5,
    );
  });

  test("picks the right pair out of several", () => {
    const many = [fix(0, 0), fix(100, 10), fix(200, 30), fix(300, 40)];
    expect(poseAt(many, at(150))?.lon).toBeCloseTo(20, 4);
    expect(poseAt(many, at(250))?.lon).toBeCloseTo(35, 4);
  });

  test("two fixes at the same place give that place", () => {
    const still = [fix(0, 5, 5), fix(100, 5, 5)];
    const pose = poseAt(still, at(50));
    expect(pose?.lon).toBeCloseTo(5, 9);
    expect(pose?.lat).toBeCloseTo(5, 9);
  });
});

describe("crossing the dateline", () => {
  test("goes the short way from 179.9 to -179.9", () => {
    const fixes = [fix(0, 179.9), fix(100, -179.9)];
    const mid = poseAt(fixes, at(50));
    expect(Math.abs(Math.abs(mid?.lon ?? 0) - 180)).toBeLessThan(1e-6);
    const early = poseAt(fixes, at(25));
    expect(early?.lon).toBeCloseTo(179.95, 5);
    const late = poseAt(fixes, at(75));
    expect(late?.lon).toBeCloseTo(-179.95, 5);
  });

  test("never passes through longitude zero", () => {
    const fixes = [fix(0, 179.9), fix(100, -179.9)];
    for (let s = 0; s <= 100; s += 5) {
      expect(Math.abs(poseAt(fixes, at(s))?.lon ?? 0)).toBeGreaterThan(179.8);
    }
  });

  test("works in the other direction", () => {
    const fixes = [fix(0, -179.9), fix(100, 179.9)];
    expect(poseAt(fixes, at(25))?.lon).toBeCloseTo(-179.95, 5);
    expect(poseAt(fixes, at(75))?.lon).toBeCloseTo(179.95, 5);
  });

  test("extrapolating east across it wraps the longitude", () => {
    const fixes = [fix(0, 179.99, 0, { sog: 360, cog: 90 })];
    const pose = poseAt(fixes, at(60));
    expect(pose?.lon).toBeLessThan(-179.8);
  });
});

describe("past the last fix", () => {
  const moving = [fix(0, 0, 0, { sog: 360, cog: 90 })];

  test("carries on along the reported course and speed", () => {
    const pose = poseAt(moving, at(60));
    const metres = 360 * METRES_PER_KNOT * 60;
    expect(pose?.lon).toBeCloseTo(metres / DEGREE_METRES, 3);
    expect(pose?.lat).toBeCloseTo(0, 6);
    expect(pose?.mode).toBe("extrapolated");
    expect(pose?.stale).toBe(false);
  });

  test("a northbound aircraft gains latitude", () => {
    const north = [fix(0, 0, 0, { sog: 360, cog: 0 })];
    const pose = poseAt(north, at(60));
    expect(pose?.lat).toBeCloseTo(
      (360 * METRES_PER_KNOT * 60) / DEGREE_METRES,
      3,
    );
  });

  test("stops advancing at the cap and is marked stale after it", () => {
    const cap = poseAt(moving, at(EXTRAPOLATION_CAP_SECONDS));
    const beyond = poseAt(moving, at(EXTRAPOLATION_CAP_SECONDS + 1));
    const long = poseAt(moving, at(5000));
    expect(EXTRAPOLATION_CAP_SECONDS).toBe(300);
    expect(cap?.stale).toBe(false);
    expect(beyond?.stale).toBe(true);
    expect(beyond?.lon).toBeCloseTo(cap?.lon ?? 0, 9);
    expect(long?.lon).toBeCloseTo(cap?.lon ?? 0, 9);
    expect(long?.stale).toBe(true);
  });

  test("uses the motion between the last two fixes when none was reported", () => {
    const fixes = [fix(0, 0), fix(100, 1)];
    const pose = poseAt(fixes, at(200));
    expect(pose?.lon).toBeCloseTo(2, 3);
    expect(pose?.mode).toBe("extrapolated");
  });

  test("holds still when nothing says it is moving", () => {
    const pose = poseAt([fix(0, 7, 8)], at(120));
    expect(pose?.lon).toBeCloseTo(7, 9);
    expect(pose?.lat).toBeCloseTo(8, 9);
  });

  test("is marked stale after the cap even when it was not moving", () => {
    expect(poseAt([fix(0, 7, 8)], at(400))?.stale).toBe(true);
  });

  test("the time of the last fix is the fix", () => {
    const pose = poseAt(moving, at(0));
    expect(pose?.lon).toBeCloseTo(0, 9);
  });
});

describe("before the first fix", () => {
  const arriving = [fix(0, 10, 0, { sog: 360, cog: 90 })];

  test("a new entity glides in from behind its first fix", () => {
    const pose = poseAt(arriving, at(-60));
    const metres = 360 * METRES_PER_KNOT * 60;
    expect(pose?.lon).toBeCloseTo(10 - metres / DEGREE_METRES, 3);
    expect(pose?.mode).toBe("warmup");
    expect(pose?.stale).toBe(false);
  });

  test("reaches the first fix exactly when its time comes", () => {
    expect(poseAt(arriving, at(0))?.lon).toBeCloseTo(10, 9);
  });

  test("is continuous with the interpolation that follows", () => {
    const fixes = [fix(0, 10, 0, { sog: 360, cog: 90 }), fix(100, 11)];
    const before = poseAt(fixes, at(-0.001));
    const after = poseAt(fixes, at(0.001));
    expect(Math.abs((after?.lon ?? 0) - (before?.lon ?? 0))).toBeLessThan(1e-4);
  });

  test("goes no further back than the cap", () => {
    const edge = poseAt(arriving, at(-WARMUP_CAP_SECONDS));
    const far = poseAt(arriving, at(-5000));
    expect(WARMUP_CAP_SECONDS).toBe(300);
    expect(far?.lon).toBeCloseTo(edge?.lon ?? 0, 9);
  });

  test("an entity with no motion stays on its first fix", () => {
    const pose = poseAt([fix(0, 3, 4)], at(-90));
    expect(pose?.lon).toBeCloseTo(3, 9);
    expect(pose?.lat).toBeCloseTo(4, 9);
  });

  test("keeps gliding behind the first fix when there are two", () => {
    const fixes = [fix(0, 10, 0, { sog: 360, cog: 90 }), fix(100, 11)];
    const pose = poseAt(fixes, at(-30));
    expect(pose?.lon).toBeLessThan(10);
    expect(pose?.mode).toBe("warmup");
  });
});

describe("edges", () => {
  test("no fixes means no pose", () => {
    expect(poseAt([], at(0))).toBeNull();
  });

  test("reuses the pose it is given", () => {
    const out = newPose();
    const result = poseAt([fix(0, 1), fix(100, 3)], at(50), out);
    expect(result).toBe(out);
    expect(out.lon).toBeCloseTo(2, 6);
  });

  test("clears the stale flag when the entity is fresh again", () => {
    const out = newPose();
    poseAt([fix(0, 0, 0, { sog: 100, cog: 90 })], at(1000), out);
    expect(out.stale).toBe(true);
    poseAt([fix(0, 0, 0, { sog: 100, cog: 90 })], at(10), out);
    expect(out.stale).toBe(false);
  });

  test("reports the track of the fix it is following", () => {
    const fixes = [fix(0, 0, 0, { track: 10 }), fix(100, 1, 0, { track: 20 })];
    expect(poseAt(fixes, at(50))?.track).toBe(10);
    expect(poseAt(fixes, at(150))?.track).toBe(20);
  });
});
