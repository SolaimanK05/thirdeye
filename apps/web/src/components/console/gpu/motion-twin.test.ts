import { describe, expect, test } from "vitest";
import {
  geodeticToEcef,
  instanceViews,
  MOVING_INSTANCE_BYTES,
  MOVING_INSTANCE_FLOATS,
  OFFSET_DELTA,
  OFFSET_HEADINGS,
  OFFSET_HIGH,
  OFFSET_LOW,
  OFFSET_MOVING_STYLE,
  OFFSET_TIMES,
  packMovingInstance,
  unpackMovingInstance,
} from "./encode";
import { evaluateSegmentEcef } from "./segment-math";
import { motionAt } from "./vertex-math";

const EPOCH = 1_793_000_000;
const START = EPOCH + 5000.25;
const SPAN = 10;

type Pair = readonly [string, number, number, number, number];

const PAIRS: readonly Pair[] = [
  ["an aircraft in ten seconds", 10, 20, 10.02, 20.01],
  ["a long straight leg", 10, 20, 10.2, 20.1],
  ["a satellite in one second", -103.17, 0, -103.09, 0.02],
  ["across the dateline", 179.99, 10, -179.99, 10.01],
  ["next to the pole", 30, 89.99, 210, 89.99],
  ["a very long hop", 0, 0, 7, 0],
  ["no motion at all", 45, 45, 45, 45],
];

function build(pair: Pair, headings: readonly [number, number] = [0, 0]) {
  const [, lon0, lat0, lon1, lat1] = pair;
  const ends = new Float64Array(6);
  geodeticToEcef(lon0, lat0, ends, 0);
  geodeticToEcef(lon1, lat1, ends, 3);
  const delta = new Float64Array([
    ends[3] - ends[0],
    ends[4] - ends[1],
    ends[5] - ends[2],
  ]);
  const views = instanceViews(new ArrayBuffer(MOVING_INSTANCE_BYTES));
  packMovingInstance(
    views,
    0,
    ends,
    delta,
    0,
    START - EPOCH,
    START - EPOCH + SPAN,
    headings[0],
    headings[1],
    4,
    10,
    0,
    0,
  );
  return { ends, delta, instance: unpackMovingInstance(views, 0) };
}

function twinPosition(
  instance: ReturnType<typeof unpackMovingInstance>,
  now: number,
): number[] {
  const { shift } = motionAt(instance, now - EPOCH);
  return [0, 1, 2].map(
    (axis) => instance.high[axis] + instance.low[axis] + shift[axis],
  );
}

describe("the moving instance layout", () => {
  test("is 56 bytes with the documented offsets", () => {
    expect(MOVING_INSTANCE_BYTES).toBe(56);
    expect(MOVING_INSTANCE_FLOATS).toBe(14);
    expect(OFFSET_HIGH).toBe(0);
    expect(OFFSET_LOW).toBe(12);
    expect(OFFSET_DELTA).toBe(24);
    expect(OFFSET_TIMES).toBe(36);
    expect(OFFSET_HEADINGS).toBe(44);
    expect(OFFSET_MOVING_STYLE).toBe(52);
  });

  test("a packed instance round trips and lands at the documented byte offsets", () => {
    const buffer = new ArrayBuffer(MOVING_INSTANCE_BYTES * 3);
    const views = instanceViews(buffer);
    const ends = new Float64Array([6378137.5, -400000.25, 100.125]);
    const delta = new Float64Array([10.5, -20.25, 30.125]);
    packMovingInstance(
      views,
      2,
      ends,
      delta,
      0,
      12.5,
      22.5,
      0.5,
      1.5,
      5,
      9,
      1,
      3,
    );
    const read = unpackMovingInstance(views, 2);
    expect(read.high[0] + read.low[0]).toBeCloseTo(6378137.5, 3);
    expect(read.delta).toEqual([10.5, -20.25, 30.125]);
    expect(read.startTime).toBe(12.5);
    expect(read.endTime).toBe(22.5);
    expect(read.startHeading).toBe(0.5);
    expect(read.endHeading).toBe(1.5);
    expect(read).toMatchObject({ glyph: 5, size: 9, tone: 1, flags: 3 });
    const bytes = new DataView(buffer);
    const base = 2 * MOVING_INSTANCE_BYTES;
    expect(bytes.getFloat32(base + OFFSET_DELTA, true)).toBe(10.5);
    expect(bytes.getFloat32(base + OFFSET_TIMES, true)).toBe(12.5);
    expect(bytes.getFloat32(base + OFFSET_TIMES + 4, true)).toBe(22.5);
    expect(bytes.getFloat32(base + OFFSET_HEADINGS, true)).toBe(0.5);
    expect(bytes.getFloat32(base + OFFSET_HEADINGS + 4, true)).toBe(1.5);
    expect(bytes.getUint8(base + OFFSET_MOVING_STYLE)).toBe(5);
    expect(bytes.getUint8(base + OFFSET_MOVING_STYLE + 3)).toBe(3);
  });

  test("neighbouring instances are untouched", () => {
    const views = instanceViews(new ArrayBuffer(MOVING_INSTANCE_BYTES * 3));
    packMovingInstance(
      views,
      1,
      new Float64Array([5, 6, 7]),
      new Float64Array([1, 1, 1]),
      0,
      1,
      2,
      0,
      0,
      1,
      3,
      0,
      0,
    );
    expect(unpackMovingInstance(views, 0).size).toBe(0);
    expect(unpackMovingInstance(views, 2).size).toBe(0);
  });
});

describe("the CPU twin of the shader motion", () => {
  for (const pair of PAIRS) {
    test(`follows the exact segment for ${pair[0]} within 0.2 m`, () => {
      const { ends, delta, instance } = build(pair);
      const out = new Float64Array(3);
      for (const fraction of [-0.5, 0, 0.1, 0.25, 0.5, 0.9, 1, 1.5]) {
        const now = START + SPAN * fraction;
        evaluateSegmentEcef(ends, delta, 0, START, START + SPAN, now, out, 0);
        const twin = twinPosition(instance, now);
        for (let axis = 0; axis < 3; axis++) {
          expect(Math.abs(twin[axis] - out[axis])).toBeLessThan(0.2);
        }
      }
    });
  }

  test("holds at the start before the segment and at the end after it", () => {
    const { ends, instance } = build(PAIRS[0]);
    const before = twinPosition(instance, START - 100);
    const after = twinPosition(instance, START + 100);
    expect(Math.abs(before[0] - ends[0])).toBeLessThan(0.01);
    expect(
      Math.hypot(
        after[0] - before[0],
        after[1] - before[1],
        after[2] - before[2],
      ),
    ).toBeGreaterThan(1000);
  });

  test("a segment with no duration stays at its start", () => {
    const { ends, delta } = build(PAIRS[0]);
    const views = instanceViews(new ArrayBuffer(MOVING_INSTANCE_BYTES));
    packMovingInstance(views, 0, ends, delta, 0, 100, 100, 0, 0, 4, 10, 0, 0);
    const still = motionAt(unpackMovingInstance(views, 0), 150);
    expect(still.shift).toEqual([0, 0, 0]);
  });

  test("the heading turns the short way across north", () => {
    const degrees = (value: number) => (value * Math.PI) / 180;
    const { instance } = build(PAIRS[0], [degrees(350), degrees(10)]);
    const middle = motionAt(instance, START - EPOCH + SPAN / 2);
    const wrapped =
      ((middle.rotation % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    expect(Math.min(wrapped, 2 * Math.PI - wrapped)).toBeLessThan(0.001);
    const quarter = motionAt(instance, START - EPOCH + SPAN / 4);
    expect(quarter.rotation).toBeCloseTo(degrees(350) + degrees(20) * 0.25, 4);
  });
});
