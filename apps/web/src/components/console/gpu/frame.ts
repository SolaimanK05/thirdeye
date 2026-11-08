import { splitHigh, WGS84_RADII } from "./encode";

export const STALE_ALPHA = 0.5;

export type FrameUniforms = {
  viewProjectionRte: Float32Array;
  eyeHigh: Float32Array;
  eyeLow: Float32Array;
  eyeScaled: Float32Array;
  inverseRadii: Float32Array;
  cpuViewProjection: Float64Array;
  cpuEyeScaled: Float64Array;
  width: number;
  height: number;
  ratio: number;
  tones: Float32Array;
  staleAlpha: number;
  now: number;
  epoch: number;
};

export type FrameInput = {
  viewProjectionRte: ArrayLike<number>;
  viewProjection: ArrayLike<number>;
  eye: readonly [number, number, number];
  width: number;
  height: number;
  ratio: number;
  tones: ArrayLike<number>;
  now: number;
  epoch: number;
};

export function createFrame(): FrameUniforms {
  return {
    viewProjectionRte: new Float32Array(16),
    eyeHigh: new Float32Array(3),
    eyeLow: new Float32Array(3),
    eyeScaled: new Float32Array(3),
    inverseRadii: new Float32Array(WGS84_RADII.map((radius) => 1 / radius)),
    cpuViewProjection: new Float64Array(16),
    cpuEyeScaled: new Float64Array(3),
    width: 1,
    height: 1,
    ratio: 1,
    tones: new Float32Array(12),
    staleAlpha: STALE_ALPHA,
    now: 0,
    epoch: 0,
  };
}

export function fillFrame(frame: FrameUniforms, input: FrameInput): void {
  for (let i = 0; i < 16; i++) {
    frame.viewProjectionRte[i] = input.viewProjectionRte[i];
    frame.cpuViewProjection[i] = input.viewProjection[i];
  }
  for (let axis = 0; axis < 3; axis++) {
    const value = input.eye[axis];
    const high = splitHigh(value);
    frame.eyeHigh[axis] = high;
    frame.eyeLow[axis] = value - high;
    frame.eyeScaled[axis] = value / WGS84_RADII[axis];
    frame.cpuEyeScaled[axis] = value / WGS84_RADII[axis];
  }
  frame.width = input.width;
  frame.height = input.height;
  frame.ratio = input.ratio;
  for (let i = 0; i < 12; i++) frame.tones[i] = input.tones[i];
  frame.now = input.now;
  frame.epoch = input.epoch;
}

export function premultipliedTones(
  colours: readonly (readonly [number, number, number, number])[],
): Float32Array {
  const out = new Float32Array(colours.length * 4);
  colours.forEach(([red, green, blue, alpha], index) => {
    out[index * 4] = (red / 255) * alpha;
    out[index * 4 + 1] = (green / 255) * alpha;
    out[index * 4 + 2] = (blue / 255) * alpha;
    out[index * 4 + 3] = alpha;
  });
  return out;
}
