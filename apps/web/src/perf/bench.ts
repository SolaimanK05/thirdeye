import {
  POSITION_STRIDE,
  SEGMENT_FADED,
  SEGMENT_H0,
  SEGMENT_H1,
  SEGMENT_LAT0,
  SEGMENT_LAT1,
  SEGMENT_LON0,
  SEGMENT_LON1,
  SEGMENT_STRIDE,
  SEGMENT_T0,
  SEGMENT_T1,
} from "@/components/console/markers";
import { bearingDegrees, destination } from "@/motion/sphere";

export type BenchGlyph = "plane" | "ship" | "dot";

export type BenchMover = {
  id: string;
  lon: number;
  lat: number;
  courseDeg: number;
  speedMps: number;
  glyph: BenchGlyph;
};

export const BENCH_SEED = 7;

const PLANE_SHARE = 0.45;
const SHIP_SHARE = 0.9;
const PLANE_SPEED: readonly [number, number] = [150, 280];
const SHIP_SPEED: readonly [number, number] = [2, 12];
const DOT_SPEED: readonly [number, number] = [0, 8000];
const LOOK_AHEAD_METRES = 1000;

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function between(random: () => number, [low, high]: readonly [number, number]) {
  return low + random() * (high - low);
}

export function benchMovers(count: number, seed: number): BenchMover[] {
  const random = mulberry32(seed);
  const movers: BenchMover[] = [];
  for (let i = 0; i < count; i++) {
    const kind = random();
    const glyph: BenchGlyph =
      kind < PLANE_SHARE ? "plane" : kind < SHIP_SHARE ? "ship" : "dot";
    const range =
      glyph === "plane"
        ? PLANE_SPEED
        : glyph === "ship"
          ? SHIP_SPEED
          : DOT_SPEED;
    movers.push({
      id: `bench-${i}`,
      lon: random() * 360 - 180,
      lat: (Math.asin(2 * random() - 1) * 180) / Math.PI,
      courseDeg: random() * 360,
      speedMps: between(random, range),
      glyph,
    });
  }
  return movers;
}

export function benchPositions(
  movers: readonly BenchMover[],
  seconds: number,
  out: Float64Array,
): Float64Array {
  const here = { lon: 0, lat: 0 };
  const ahead = { lon: 0, lat: 0 };
  for (let i = 0; i < movers.length; i++) {
    const mover = movers[i];
    const metres = mover.speedMps * seconds;
    destination(mover.lon, mover.lat, mover.courseDeg, metres, here);
    const at = i * POSITION_STRIDE;
    out[at] = here.lon;
    out[at + 1] = here.lat;
    if (mover.glyph === "dot") {
      out[at + 2] = Number.NaN;
    } else {
      destination(
        mover.lon,
        mover.lat,
        mover.courseDeg,
        metres + LOOK_AHEAD_METRES,
        ahead,
      );
      out[at + 2] = bearingDegrees(here.lon, here.lat, ahead.lon, ahead.lat);
    }
    out[at + 3] = 0;
  }
  return out;
}

function headingAt(
  mover: BenchMover,
  metres: number,
  here: { lon: number; lat: number },
  ahead: { lon: number; lat: number },
): number {
  if (mover.glyph === "dot") return Number.NaN;
  destination(
    mover.lon,
    mover.lat,
    mover.courseDeg,
    metres + LOOK_AHEAD_METRES,
    ahead,
  );
  return bearingDegrees(here.lon, here.lat, ahead.lon, ahead.lat);
}

export function benchSegmentRows(
  movers: readonly BenchMover[],
  from: number,
  to: number,
  elapsed: number,
  horizon: number,
  start: number,
  chained: boolean,
  out: Float64Array,
): Float64Array {
  const here = { lon: 0, lat: 0 };
  const ahead = { lon: 0, lat: 0 };
  for (let i = from; i < to; i++) {
    const mover = movers[i];
    const at = i * SEGMENT_STRIDE;
    if (chained) {
      out[at + SEGMENT_LON0] = out[at + SEGMENT_LON1];
      out[at + SEGMENT_LAT0] = out[at + SEGMENT_LAT1];
      out[at + SEGMENT_H0] = out[at + SEGMENT_H1];
    } else {
      const metres = mover.speedMps * elapsed;
      destination(mover.lon, mover.lat, mover.courseDeg, metres, here);
      out[at + SEGMENT_LON0] = here.lon;
      out[at + SEGMENT_LAT0] = here.lat;
      out[at + SEGMENT_H0] = headingAt(mover, metres, here, ahead);
    }
    const metres = mover.speedMps * (elapsed + horizon);
    destination(mover.lon, mover.lat, mover.courseDeg, metres, here);
    out[at + SEGMENT_LON1] = here.lon;
    out[at + SEGMENT_LAT1] = here.lat;
    out[at + SEGMENT_H1] = headingAt(mover, metres, here, ahead);
    out[at + SEGMENT_T0] = start;
    out[at + SEGMENT_T1] = start + horizon;
    out[at + SEGMENT_FADED] = 0;
  }
  return out;
}
