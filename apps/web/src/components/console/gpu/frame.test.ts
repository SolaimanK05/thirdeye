import { describe, expect, test } from "vitest";
import { WGS84_RADII } from "./encode";
import {
  createFrame,
  fillFrame,
  premultipliedTones,
  STALE_ALPHA,
} from "./frame";

describe("frame uniforms", () => {
  test("the eye is split into high and low parts that add back up", () => {
    const frame = createFrame();
    const eye: [number, number, number] = [6378137.25, -4000000.125, 12345.5];
    fillFrame(frame, {
      viewProjectionRte: new Float32Array(16),
      viewProjection: new Float64Array(16),
      eye,
      width: 800,
      height: 600,
      ratio: 2,
      tones: new Float32Array(12),
      now: 1_700_000_123.5,
      epoch: 1_700_000_000,
    });
    for (let axis = 0; axis < 3; axis++) {
      expect(
        Math.abs(frame.eyeHigh[axis] + frame.eyeLow[axis] - eye[axis]),
      ).toBeLessThan(0.0005);
      expect(frame.cpuEyeScaled[axis]).toBeCloseTo(
        eye[axis] / WGS84_RADII[axis],
        12,
      );
    }
    expect(frame).toMatchObject({ width: 800, height: 600, ratio: 2 });
    expect(frame.staleAlpha).toBe(STALE_ALPHA);
    expect(frame.now).toBe(1_700_000_123.5);
    expect(frame.epoch).toBe(1_700_000_000);
  });

  test("the CPU matrix keeps full precision while the GPU copy is float32", () => {
    const frame = createFrame();
    const matrix = Array.from({ length: 16 }, (_, i) => 1 / 3 + i);
    fillFrame(frame, {
      viewProjectionRte: matrix,
      viewProjection: matrix,
      eye: [1, 2, 3],
      width: 1,
      height: 1,
      ratio: 1,
      tones: new Float32Array(12),
      now: 1_700_000_123.5,
      epoch: 1_700_000_000,
    });
    expect(frame.cpuViewProjection[0]).toBe(1 / 3);
    expect(frame.viewProjectionRte[0]).toBe(Math.fround(1 / 3));
  });

  test("inverse radii are the reciprocal of the WGS84 radii", () => {
    const frame = createFrame();
    expect(frame.inverseRadii[0]).toBeCloseTo(1 / WGS84_RADII[0], 12);
    expect(frame.inverseRadii[2]).toBeCloseTo(1 / WGS84_RADII[2], 12);
  });

  test("tones are premultiplied by alpha", () => {
    const tones = premultipliedTones([
      [255, 0, 0, 1],
      [0, 255, 0, 0.5],
      [0, 0, 255, 0],
    ]);
    expect(Array.from(tones)).toEqual([1, 0, 0, 1, 0, 0.5, 0, 0.5, 0, 0, 0, 0]);
  });
});
