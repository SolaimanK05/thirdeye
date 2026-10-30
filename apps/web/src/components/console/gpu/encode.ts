import { SIZE_MAX } from "../glyphs";
import type { MarkerTone } from "../markers";

export const WGS84_A = 6378137;
export const WGS84_F = 1 / 298.257223563;
export const WGS84_B = WGS84_A * (1 - WGS84_F);
export const WGS84_RADII: readonly [number, number, number] = [
  WGS84_A,
  WGS84_A,
  WGS84_B,
];
const ECCENTRICITY_SQUARED = WGS84_F * (2 - WGS84_F);
const DEGREES = Math.PI / 180;

export const SPLIT_STEP = 4096;

export const INSTANCE_BYTES = 32;
export const INSTANCE_FLOATS = INSTANCE_BYTES / 4;
export const OFFSET_HIGH = 0;
export const OFFSET_LOW = 12;
export const OFFSET_ROTATION = 24;
export const OFFSET_STYLE = 28;

export const MOVING_INSTANCE_BYTES = 56;
export const MOVING_INSTANCE_FLOATS = MOVING_INSTANCE_BYTES / 4;
export const OFFSET_DELTA = 24;
export const OFFSET_TIMES = 36;
export const OFFSET_HEADINGS = 44;
export const OFFSET_MOVING_STYLE = 52;

export const FLAG_FADED = 1;
export const FLAG_ADAPTIVE = 2;
export const FLAG_HIDDEN = 4;

export const MAX_LAYERS = 255;
export const MAX_INSTANCES = 1 << 24;
const ID_LAYER_SHIFT = MAX_INSTANCES;

export function toneIndex(tone: MarkerTone): number {
  return tone === "notable" ? 1 : tone === "accent" ? 2 : 0;
}

export function splitHigh(value: number): number {
  return Math.floor(value / SPLIT_STEP) * SPLIT_STEP;
}

export function geodeticToEcef(
  lonDegrees: number,
  latDegrees: number,
  out: Float64Array,
  at: number,
): void {
  const lon = lonDegrees * DEGREES;
  const lat = latDegrees * DEGREES;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const radius =
    WGS84_A / Math.sqrt(1 - ECCENTRICITY_SQUARED * sinLat * sinLat);
  out[at] = radius * cosLat * Math.cos(lon);
  out[at + 1] = radius * cosLat * Math.sin(lon);
  out[at + 2] = radius * (1 - ECCENTRICITY_SQUARED) * sinLat;
}

export function ecefToGeodetic(
  x: number,
  y: number,
  z: number,
  out: { lon: number; lat: number },
): void {
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - ECCENTRICITY_SQUARED));
  for (let step = 0; step < 4; step++) {
    const sin = Math.sin(lat);
    const radius = WGS84_A / Math.sqrt(1 - ECCENTRICITY_SQUARED * sin * sin);
    lat = Math.atan2(z + ECCENTRICITY_SQUARED * radius * sin, p);
  }
  out.lon = Math.atan2(y, x) / DEGREES;
  out.lat = lat / DEGREES;
}

export function clampSize(size: number): number {
  return Math.min(SIZE_MAX, Math.max(1, Math.round(size)));
}

export type InstanceViews = { f32: Float32Array; u8: Uint8Array };

export function instanceViews(buffer: ArrayBuffer): InstanceViews {
  return { f32: new Float32Array(buffer), u8: new Uint8Array(buffer) };
}

export function packInstance(
  views: InstanceViews,
  instance: number,
  ecef: Float64Array,
  at: number,
  rotation: number,
  glyph: number,
  size: number,
  tone: number,
  flags: number,
): void {
  const { f32, u8 } = views;
  const base = instance * INSTANCE_FLOATS;
  for (let axis = 0; axis < 3; axis++) {
    const value = ecef[at + axis];
    const high = splitHigh(value);
    f32[base + axis] = high;
    f32[base + 3 + axis] = value - high;
  }
  f32[base + 6] = rotation;
  const style = instance * INSTANCE_BYTES + OFFSET_STYLE;
  u8[style] = glyph;
  u8[style + 1] = clampSize(size);
  u8[style + 2] = tone;
  u8[style + 3] = flags;
}

export function packMovingInstance(
  views: InstanceViews,
  instance: number,
  ecef: Float64Array,
  delta: Float64Array,
  at: number,
  startTime: number,
  endTime: number,
  startHeading: number,
  endHeading: number,
  glyph: number,
  size: number,
  tone: number,
  flags: number,
): void {
  const { f32, u8 } = views;
  const base = instance * MOVING_INSTANCE_FLOATS;
  for (let axis = 0; axis < 3; axis++) {
    const value = ecef[at + axis];
    const high = splitHigh(value);
    f32[base + axis] = high;
    f32[base + 3 + axis] = value - high;
    f32[base + 6 + axis] = delta[at + axis];
  }
  f32[base + 9] = startTime;
  f32[base + 10] = endTime;
  f32[base + 11] = startHeading;
  f32[base + 12] = endHeading;
  const style = instance * MOVING_INSTANCE_BYTES + OFFSET_MOVING_STYLE;
  u8[style] = glyph;
  u8[style + 1] = clampSize(size);
  u8[style + 2] = tone;
  u8[style + 3] = flags;
}

export type UnpackedMovingInstance = UnpackedInstance & {
  delta: [number, number, number];
  startTime: number;
  endTime: number;
  startHeading: number;
  endHeading: number;
};

export function unpackMovingInstance(
  views: InstanceViews,
  instance: number,
): UnpackedMovingInstance {
  const { f32, u8 } = views;
  const base = instance * MOVING_INSTANCE_FLOATS;
  const style = instance * MOVING_INSTANCE_BYTES + OFFSET_MOVING_STYLE;
  return {
    high: [f32[base], f32[base + 1], f32[base + 2]],
    low: [f32[base + 3], f32[base + 4], f32[base + 5]],
    delta: [f32[base + 6], f32[base + 7], f32[base + 8]],
    startTime: f32[base + 9],
    endTime: f32[base + 10],
    startHeading: f32[base + 11],
    endHeading: f32[base + 12],
    rotation: 0,
    glyph: u8[style],
    size: u8[style + 1],
    tone: u8[style + 2],
    flags: u8[style + 3],
  };
}

export type UnpackedInstance = {
  high: [number, number, number];
  low: [number, number, number];
  rotation: number;
  glyph: number;
  size: number;
  tone: number;
  flags: number;
};

export function unpackInstance(
  views: InstanceViews,
  instance: number,
): UnpackedInstance {
  const { f32, u8 } = views;
  const base = instance * INSTANCE_FLOATS;
  const style = instance * INSTANCE_BYTES + OFFSET_STYLE;
  return {
    high: [f32[base], f32[base + 1], f32[base + 2]],
    low: [f32[base + 3], f32[base + 4], f32[base + 5]],
    rotation: f32[base + 6],
    glyph: u8[style],
    size: u8[style + 1],
    tone: u8[style + 2],
    flags: u8[style + 3],
  };
}

export function packId(layerIndex: number, instanceIndex: number): number {
  if (
    !Number.isInteger(layerIndex) ||
    layerIndex < 0 ||
    layerIndex >= MAX_LAYERS
  ) {
    throw new RangeError(`layer index ${layerIndex} is outside 0..254`);
  }
  if (
    !Number.isInteger(instanceIndex) ||
    instanceIndex < 0 ||
    instanceIndex >= MAX_INSTANCES
  ) {
    throw new RangeError(
      `instance index ${instanceIndex} is outside 0..${MAX_INSTANCES - 1}`,
    );
  }
  return (layerIndex + 1) * ID_LAYER_SHIFT + instanceIndex;
}

export function unpackId(
  id: number,
): { layerIndex: number; instanceIndex: number } | null {
  const layer = Math.floor(id / ID_LAYER_SHIFT);
  if (!Number.isInteger(id) || id < 0 || layer === 0 || layer > MAX_LAYERS) {
    return null;
  }
  return { layerIndex: layer - 1, instanceIndex: id % ID_LAYER_SHIFT };
}
