import { normaliseDegrees, signedDelta } from "./sphere";

export const REPORTED_ONLY_BELOW_KN = 1;
export const FULL_COURSE_AT_KN = 15;
export const MAX_TURN_DEGREES_PER_SECOND = 90;

const DEG = Math.PI / 180;

export function courseWeight(speedKn: number | null): number {
  if (speedKn === null || speedKn <= REPORTED_ONLY_BELOW_KN) return 0;
  const span = FULL_COURSE_AT_KN - REPORTED_ONLY_BELOW_KN;
  return Math.min(1, (speedKn - REPORTED_ONLY_BELOW_KN) / span);
}

export function blendHeading(
  reported: number | null,
  course: number | null,
  speedKn: number | null,
): number | null {
  if (course === null) return reported;
  if (reported === null) return speedKn === null ? null : course;
  const weight = courseWeight(speedKn);
  if (weight === 0) return reported;
  if (weight === 1) return course;
  const x =
    weight * Math.sin(course * DEG) + (1 - weight) * Math.sin(reported * DEG);
  const y =
    weight * Math.cos(course * DEG) + (1 - weight) * Math.cos(reported * DEG);
  return normaliseDegrees(Math.atan2(x, y) / DEG);
}

export function limitTurn(
  shown: number,
  target: number,
  seconds: number,
  maxPerSecond: number = MAX_TURN_DEGREES_PER_SECOND,
): number {
  const delta = signedDelta(shown, target);
  const allowed = Math.max(0, maxPerSecond * seconds);
  if (Math.abs(delta) <= allowed) return normaliseDegrees(target);
  return normaliseDegrees(shown + Math.sign(delta) * allowed);
}
