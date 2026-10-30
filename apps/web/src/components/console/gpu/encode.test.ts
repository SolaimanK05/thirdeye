import { Cartesian3, Ellipsoid } from "cesium";
import { describe, expect, test } from "vitest";
import { SIZE_MAX } from "../glyphs";
import {
  clampSize,
  FLAG_ADAPTIVE,
  FLAG_FADED,
  geodeticToEcef,
  INSTANCE_BYTES,
  instanceViews,
  MAX_INSTANCES,
  MAX_LAYERS,
  OFFSET_HIGH,
  OFFSET_LOW,
  OFFSET_ROTATION,
  OFFSET_STYLE,
  packId,
  packInstance,
  SPLIT_STEP,
  splitHigh,
  toneIndex,
  unpackId,
  unpackInstance,
  WGS84_RADII,
} from "./encode";

describe("high and low split", () => {
  const values = [0, 1, 6378137, -6378137.123, 6356752.3142, 4095.9999, -0.5];

  test.each(values)("%d is rebuilt from two float32 parts", (value) => {
    const high = splitHigh(value);
    const low = value - high;
    expect(Math.fround(high)).toBe(high);
    expect(Math.abs(Math.fround(high) + Math.fround(low) - value)).toBeLessThan(
      0.0005,
    );
    expect(low).toBeGreaterThanOrEqual(0);
    expect(low).toBeLessThan(SPLIT_STEP);
  });

  test("two points one metre apart stay one millimetre accurate next to each other", () => {
    const base = 6378137.25;
    const a = Math.fround(base - splitHigh(base));
    const b = Math.fround(base + 1 - splitHigh(base + 1));
    expect(Math.abs(b - a - 1)).toBeLessThan(0.001);
  });
});

describe("geodetic to ECEF", () => {
  test("matches Cesium within a millimetre for 200 points including the poles and the dateline", () => {
    const points: [number, number][] = [
      [0, 90],
      [0, -90],
      [180, 0],
      [-180, 0],
      [179.9999, 45],
      [-179.9999, -45],
      [0, 0],
    ];
    let seed = 11;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    while (points.length < 200) {
      points.push([
        next() * 360 - 180,
        Math.asin(next() * 2 - 1) / (Math.PI / 180),
      ]);
    }
    const out = new Float64Array(3);
    for (const [lon, lat] of points) {
      geodeticToEcef(lon, lat, out, 0);
      const expected = Cartesian3.fromDegrees(lon, lat, 0, Ellipsoid.WGS84);
      expect(Math.abs(out[0] - expected.x)).toBeLessThan(0.001);
      expect(Math.abs(out[1] - expected.y)).toBeLessThan(0.001);
      expect(Math.abs(out[2] - expected.z)).toBeLessThan(0.001);
    }
  });

  test("writes at the given offset", () => {
    const out = new Float64Array(6);
    geodeticToEcef(0, 0, out, 3);
    expect(out[3]).toBeCloseTo(6378137, 6);
    expect(out[4]).toBeCloseTo(0, 6);
    expect(out[5]).toBeCloseTo(0, 6);
    expect(out[0]).toBe(0);
  });

  test("radii are the WGS84 radii Cesium uses", () => {
    expect(WGS84_RADII[0]).toBe(Ellipsoid.WGS84.radii.x);
    expect(WGS84_RADII[2]).toBeCloseTo(Ellipsoid.WGS84.radii.z, 6);
  });
});

describe("instance layout", () => {
  test("offsets are the ones the vertex array expects", () => {
    expect(INSTANCE_BYTES).toBe(32);
    expect(OFFSET_HIGH).toBe(0);
    expect(OFFSET_LOW).toBe(12);
    expect(OFFSET_ROTATION).toBe(24);
    expect(OFFSET_STYLE).toBe(28);
  });

  test("a packed instance round trips and lands at the documented byte offsets", () => {
    const buffer = new ArrayBuffer(INSTANCE_BYTES * 3);
    const views = instanceViews(buffer);
    const ecef = new Float64Array([1, 2, 3, 6378137.5, -4000000.25, 100.125]);
    packInstance(views, 2, ecef, 3, 1.5, 4, 22, 2, FLAG_FADED | FLAG_ADAPTIVE);
    const read = unpackInstance(views, 2);
    expect(read.high[0] + read.low[0]).toBeCloseTo(6378137.5, 3);
    expect(read.high[1] + read.low[1]).toBeCloseTo(-4000000.25, 3);
    expect(read.high[2] + read.low[2]).toBeCloseTo(100.125, 3);
    expect(read.rotation).toBeCloseTo(1.5, 6);
    expect(read).toMatchObject({ glyph: 4, size: 22, tone: 2, flags: 3 });

    const bytes = new DataView(buffer);
    const base = 2 * INSTANCE_BYTES;
    expect(bytes.getFloat32(base + OFFSET_HIGH, true)).toBe(read.high[0]);
    expect(bytes.getFloat32(base + OFFSET_LOW, true)).toBe(read.low[0]);
    expect(bytes.getFloat32(base + OFFSET_ROTATION, true)).toBeCloseTo(1.5, 6);
    expect(bytes.getUint8(base + OFFSET_STYLE)).toBe(4);
    expect(bytes.getUint8(base + OFFSET_STYLE + 1)).toBe(22);
    expect(bytes.getUint8(base + OFFSET_STYLE + 2)).toBe(2);
    expect(bytes.getUint8(base + OFFSET_STYLE + 3)).toBe(3);
  });

  test("neighbouring instances are untouched", () => {
    const views = instanceViews(new ArrayBuffer(INSTANCE_BYTES * 3));
    packInstance(views, 1, new Float64Array([5, 6, 7]), 0, 0, 1, 3, 0, 0);
    expect(unpackInstance(views, 0).size).toBe(0);
    expect(unpackInstance(views, 2).size).toBe(0);
  });

  test("size is rounded and kept inside 1 to 64", () => {
    expect(clampSize(0)).toBe(1);
    expect(clampSize(-4)).toBe(1);
    expect(clampSize(9.6)).toBe(10);
    expect(clampSize(500)).toBe(SIZE_MAX);
  });

  test("tones map to 0, 1 and 2", () => {
    expect(toneIndex("default")).toBe(0);
    expect(toneIndex("notable")).toBe(1);
    expect(toneIndex("accent")).toBe(2);
  });
});

describe("pick ids", () => {
  test.each([
    [0, 0],
    [0, MAX_INSTANCES - 1],
    [254, 0],
    [254, MAX_INSTANCES - 1],
    [7, 123456],
  ])("layer %d instance %d round trips", (layer, instance) => {
    const id = packId(layer, instance);
    expect(id).toBeLessThanOrEqual(0xffffffff);
    expect(unpackId(id)).toEqual({
      layerIndex: layer,
      instanceIndex: instance,
    });
  });

  test("zero means nothing was hit", () => {
    expect(unpackId(0)).toBeNull();
  });

  test("overflow throws", () => {
    expect(() => packId(MAX_LAYERS, 0)).toThrow(RangeError);
    expect(() => packId(-1, 0)).toThrow(RangeError);
    expect(() => packId(0, MAX_INSTANCES)).toThrow(RangeError);
    expect(() => packId(0, -1)).toThrow(RangeError);
    expect(() => packId(0.5, 0)).toThrow(RangeError);
  });

  test("an id above the last layer is rejected", () => {
    expect(unpackId(256 * MAX_INSTANCES)).toBeNull();
  });
});
