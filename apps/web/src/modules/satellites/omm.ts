import type { OMMJsonObject } from "satellite.js";

export type Omm = OMMJsonObject;

const NUMBERS = [
  "MEAN_MOTION",
  "ECCENTRICITY",
  "INCLINATION",
  "RA_OF_ASC_NODE",
  "ARG_OF_PERICENTER",
  "MEAN_ANOMALY",
  "BSTAR",
  "MEAN_MOTION_DOT",
  "MEAN_MOTION_DDOT",
  "NORAD_CAT_ID",
  "ELEMENT_SET_NO",
] as const;

type NumberField = (typeof NUMBERS)[number];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

export function epochMs(epoch: string): number {
  return Date.parse(epoch.endsWith("Z") ? epoch : `${epoch}Z`);
}

export function parseOmm(value: unknown, name: string | null): Omm | null {
  if (!isRecord(value)) return null;
  const numbers: Partial<Record<NumberField, number>> = {};
  for (const field of NUMBERS) {
    const found = value[field];
    if (typeof found !== "number" || !Number.isFinite(found)) return null;
    numbers[field] = found;
  }
  const epoch = text(value.EPOCH);
  if (epoch === "" || !Number.isFinite(epochMs(epoch))) return null;
  const { MEAN_MOTION, ECCENTRICITY, NORAD_CAT_ID } = numbers;
  if (
    MEAN_MOTION === undefined ||
    ECCENTRICITY === undefined ||
    NORAD_CAT_ID === undefined ||
    MEAN_MOTION <= 0 ||
    ECCENTRICITY < 0 ||
    ECCENTRICITY >= 1
  ) {
    return null;
  }
  return {
    OBJECT_NAME: name ?? text(value.OBJECT_NAME),
    OBJECT_ID: text(value.OBJECT_ID),
    EPOCH: epoch,
    MEAN_MOTION,
    ECCENTRICITY,
    INCLINATION: numbers.INCLINATION ?? 0,
    RA_OF_ASC_NODE: numbers.RA_OF_ASC_NODE ?? 0,
    ARG_OF_PERICENTER: numbers.ARG_OF_PERICENTER ?? 0,
    MEAN_ANOMALY: numbers.MEAN_ANOMALY ?? 0,
    BSTAR: numbers.BSTAR ?? 0,
    MEAN_MOTION_DOT: numbers.MEAN_MOTION_DOT ?? 0,
    MEAN_MOTION_DDOT: numbers.MEAN_MOTION_DDOT ?? 0,
    NORAD_CAT_ID,
    ELEMENT_SET_NO: numbers.ELEMENT_SET_NO ?? 0,
  };
}
