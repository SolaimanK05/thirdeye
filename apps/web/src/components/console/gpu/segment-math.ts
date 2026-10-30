import { DIRTY_BLOCK } from "../renderer";
import { ecefToGeodetic, geodeticToEcef } from "./encode";

const SEGMENT_SECONDS = 10;
const SEGMENT_STAGGER_SECONDS = 3;
const STAGGER_STEPS = 8;

export function segmentLength(index: number): number {
  const block = Math.floor(index / DIRTY_BLOCK);
  return (
    SEGMENT_SECONDS -
    (SEGMENT_STAGGER_SECONDS * (block % STAGGER_STEPS)) / STAGGER_STEPS
  );
}

const TWO_PI = Math.PI * 2;

export function segmentFraction(
  startTime: number,
  endTime: number,
  now: number,
): number {
  if (!(endTime > startTime)) return 0;
  const fraction = (now - startTime) / (endTime - startTime);
  return fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
}

export function wrapAngle(radians: number): number {
  return radians - TWO_PI * Math.floor(radians / TWO_PI + 0.5);
}

export function segmentHeading(
  startHeading: number,
  endHeading: number,
  fraction: number,
): number {
  return startHeading + wrapAngle(endHeading - startHeading) * fraction;
}

export function evaluateSegmentEcef(
  ecef: ArrayLike<number>,
  delta: ArrayLike<number>,
  at: number,
  startTime: number,
  endTime: number,
  now: number,
  out: Float64Array,
  outAt: number,
): void {
  const px = ecef[at];
  const py = ecef[at + 1];
  const pz = ecef[at + 2];
  const fraction = segmentFraction(startTime, endTime, now);
  if (fraction === 0) {
    out[outAt] = px;
    out[outAt + 1] = py;
    out[outAt + 2] = pz;
    return;
  }
  const dx = delta[at];
  const dy = delta[at + 1];
  const dz = delta[at + 2];
  const radius = Math.hypot(px, py, pz);
  const ux = px / radius;
  const uy = py / radius;
  const uz = pz / radius;
  const cx = dy * uz - dz * uy;
  const cy = dz * ux - dx * uz;
  const cz = dx * uy - dy * ux;
  const sag =
    (fraction * (1 - fraction) * (cx * cx + cy * cy + cz * cz)) / (2 * radius);
  out[outAt] = px + dx * fraction + ux * sag;
  out[outAt + 1] = py + dy * fraction + uy * sag;
  out[outAt + 2] = pz + dz * fraction + uz * sag;
}

const endpoints = new Float64Array(6);
const offset = new Float64Array(3);

export function segmentLonLat(
  startLon: number,
  startLat: number,
  endLon: number,
  endLat: number,
  startTime: number,
  endTime: number,
  now: number,
  out: { lon: number; lat: number },
): void {
  geodeticToEcef(startLon, startLat, endpoints, 0);
  geodeticToEcef(endLon, endLat, endpoints, 3);
  offset[0] = endpoints[3] - endpoints[0];
  offset[1] = endpoints[4] - endpoints[1];
  offset[2] = endpoints[5] - endpoints[2];
  evaluateSegmentEcef(
    endpoints,
    offset,
    0,
    startTime,
    endTime,
    now,
    endpoints,
    0,
  );
  ecefToGeodetic(endpoints[0], endpoints[1], endpoints[2], out);
}
