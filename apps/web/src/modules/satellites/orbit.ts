import type { Omm } from "./omm";
import { epochMs } from "./omm";

export const EARTH_RADIUS_KM = 6378.137;
export const EARTH_MU_KM3_S2 = 398600.4418;
const MINUTES_PER_DAY = 1440;
const SECONDS_PER_DAY = 86400;

export type OrbitShape = {
  periodMinutes: number;
  semiMajorKm: number;
  perigeeKm: number;
  apogeeKm: number;
  inclinationDeg: number;
  eccentricity: number;
};

export type OrbitClass =
  | "Low Earth orbit"
  | "Medium Earth orbit"
  | "Geostationary orbit"
  | "Geosynchronous orbit"
  | "Highly elliptical orbit"
  | "High orbit";

const LOW_ORBIT_MAX_MINUTES = 128;
const ELLIPTICAL_MIN_ECCENTRICITY = 0.25;
const SYNCHRONOUS_MIN_MINUTES = 1300;
const SYNCHRONOUS_MAX_MINUTES = 1500;
const STATIONARY_MAX_INCLINATION = 5;
const STATIONARY_MAX_ECCENTRICITY = 0.01;

export function orbitShape(omm: Omm): OrbitShape {
  const revsPerDay = Number(omm.MEAN_MOTION);
  const eccentricity = Number(omm.ECCENTRICITY);
  const radiansPerSecond = (revsPerDay * 2 * Math.PI) / SECONDS_PER_DAY;
  const semiMajorKm = (EARTH_MU_KM3_S2 / radiansPerSecond ** 2) ** (1 / 3);
  return {
    periodMinutes: MINUTES_PER_DAY / revsPerDay,
    semiMajorKm,
    perigeeKm: semiMajorKm * (1 - eccentricity) - EARTH_RADIUS_KM,
    apogeeKm: semiMajorKm * (1 + eccentricity) - EARTH_RADIUS_KM,
    inclinationDeg: Number(omm.INCLINATION),
    eccentricity,
  };
}

export function orbitClass(shape: OrbitShape): OrbitClass {
  if (shape.periodMinutes < LOW_ORBIT_MAX_MINUTES) return "Low Earth orbit";
  if (shape.eccentricity >= ELLIPTICAL_MIN_ECCENTRICITY) {
    return "Highly elliptical orbit";
  }
  if (
    shape.periodMinutes >= SYNCHRONOUS_MIN_MINUTES &&
    shape.periodMinutes <= SYNCHRONOUS_MAX_MINUTES
  ) {
    return shape.inclinationDeg <= STATIONARY_MAX_INCLINATION &&
      shape.eccentricity <= STATIONARY_MAX_ECCENTRICITY
      ? "Geostationary orbit"
      : "Geosynchronous orbit";
  }
  return shape.periodMinutes < SYNCHRONOUS_MIN_MINUTES
    ? "Medium Earth orbit"
    : "High orbit";
}

export function elementAgeMs(omm: Omm, nowMs: number): number {
  return nowMs - epochMs(omm.EPOCH);
}
