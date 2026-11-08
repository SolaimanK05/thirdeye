import type { Fix } from "./history";
import {
  angleBetween,
  bearingDegrees,
  destination,
  distanceMetres,
  EARTH_RADIUS_M,
  latOf,
  lonOf,
  METRES_PER_KNOT,
  slerp,
  toVector,
  type Vec3,
} from "./sphere";

export const EXTRAPOLATION_CAP_SECONDS = 300;
export const WARMUP_CAP_SECONDS = 300;

export type PoseMode = "interpolated" | "extrapolated" | "warmup";

export type Pose = {
  lon: number;
  lat: number;
  course: number | null;
  speedKn: number | null;
  mode: PoseMode;
  stale: boolean;
  track: number | null;
};

export function newPose(): Pose {
  return {
    lon: 0,
    lat: 0,
    course: null,
    speedKn: null,
    mode: "interpolated",
    stale: false,
    track: null,
  };
}

const scratchA: Vec3 = [0, 0, 0];
const scratchB: Vec3 = [0, 0, 0];
const scratchC: Vec3 = [0, 0, 0];
const scratchPoint = { lon: 0, lat: 0 };

function derivedMotion(
  fixes: readonly Fix[],
  index: number,
): { course: number; speedKn: number } | null {
  const from = index > 0 ? fixes[index - 1] : fixes[index];
  const to = index > 0 ? fixes[index] : fixes[index + 1];
  if (!from || !to || to.t <= from.t) return null;
  const metres = distanceMetres(from.lon, from.lat, to.lon, to.lat);
  const seconds = (to.t - from.t) / 1000;
  return {
    course: bearingDegrees(from.lon, from.lat, to.lon, to.lat),
    speedKn: metres / seconds / METRES_PER_KNOT,
  };
}

function project(
  fixes: readonly Fix[],
  index: number,
  seconds: number,
  out: Pose,
): void {
  const fix = fixes[index];
  const derived =
    fix.sog === null || fix.cog === null ? derivedMotion(fixes, index) : null;
  const speedKn = fix.sog ?? derived?.speedKn ?? null;
  const course = fix.cog ?? derived?.course ?? null;
  out.course = course;
  out.speedKn = speedKn;
  out.track = fix.track;
  if (speedKn === null || course === null || seconds === 0) {
    out.lon = fix.lon;
    out.lat = fix.lat;
    return;
  }
  destination(
    fix.lon,
    fix.lat,
    course,
    speedKn * METRES_PER_KNOT * seconds,
    scratchPoint,
  );
  out.lon = scratchPoint.lon;
  out.lat = scratchPoint.lat;
}

export function poseAt(
  fixes: readonly Fix[],
  renderMs: number,
  out: Pose = newPose(),
): Pose | null {
  const count = fixes.length;
  if (count === 0) return null;
  out.stale = false;

  const first = fixes[0];
  if (renderMs <= first.t) {
    const seconds = Math.max(-WARMUP_CAP_SECONDS, (renderMs - first.t) / 1000);
    out.mode = seconds === 0 && count > 1 ? "interpolated" : "warmup";
    project(fixes, 0, seconds, out);
    return out;
  }

  const lastIndex = count - 1;
  const last = fixes[lastIndex];
  if (renderMs >= last.t) {
    const elapsed = (renderMs - last.t) / 1000;
    const seconds = Math.min(EXTRAPOLATION_CAP_SECONDS, elapsed);
    out.mode = elapsed === 0 && count > 1 ? "interpolated" : "extrapolated";
    out.stale = elapsed > EXTRAPOLATION_CAP_SECONDS;
    project(fixes, lastIndex, seconds, out);
    return out;
  }

  let upper = 1;
  while (fixes[upper].t < renderMs) upper += 1;
  const a = fixes[upper - 1];
  const b = fixes[upper];
  const fraction = (renderMs - a.t) / (b.t - a.t);
  toVector(a.lon, a.lat, scratchA);
  toVector(b.lon, b.lat, scratchB);
  slerp(scratchA, scratchB, fraction, scratchC);
  out.lon = lonOf(scratchC);
  out.lat = latOf(scratchC);
  out.mode = "interpolated";
  out.track = a.track;

  const separation = angleBetween(scratchA, scratchB);
  const metres = separation * EARTH_RADIUS_M;
  out.speedKn = metres / ((b.t - a.t) / 1000) / METRES_PER_KNOT;
  out.course =
    metres < 1
      ? (a.cog ?? a.track)
      : fraction < 1 - 1e-6
        ? bearingDegrees(out.lon, out.lat, b.lon, b.lat)
        : (bearingDegrees(b.lon, b.lat, a.lon, a.lat) + 180) % 360;
  return out;
}
