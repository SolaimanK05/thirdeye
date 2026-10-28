import type { RawElement } from "./propagator";

export const ISS_EPOCH = "2026-10-26T12:34:56.123456";
export const ISS_EPOCH_MS = Date.parse("2026-10-26T12:34:56.123Z");
export const MINUTE_MS = 60_000;

export const ISS_OMM = {
  OBJECT_NAME: "ISS (ZARYA)",
  OBJECT_ID: "1998-067A",
  EPOCH: ISS_EPOCH,
  MEAN_MOTION: 15.4991,
  ECCENTRICITY: 0.0006,
  INCLINATION: 51.6416,
  RA_OF_ASC_NODE: 120.5,
  ARG_OF_PERICENTER: 80.1,
  MEAN_ANOMALY: 280.0,
  EPHEMERIS_TYPE: 0,
  CLASSIFICATION_TYPE: "U",
  NORAD_CAT_ID: 25544,
  ELEMENT_SET_NO: 999,
  REV_AT_EPOCH: 50000,
  BSTAR: 0.00025,
  MEAN_MOTION_DOT: 0.00012,
  MEAN_MOTION_DDOT: 0,
};

export const GEO_OMM = {
  ...ISS_OMM,
  OBJECT_NAME: "GOES 16",
  OBJECT_ID: "2016-071A",
  MEAN_MOTION: 1.0027,
  ECCENTRICITY: 0.0001,
  INCLINATION: 0.03,
  MEAN_ANOMALY: 160.1,
  BSTAR: 0,
  MEAN_MOTION_DOT: 0,
  NORAD_CAT_ID: 41866,
};

export const FALLING_OMM = {
  ...ISS_OMM,
  OBJECT_NAME: "FALLING",
  OBJECT_ID: "2026-001A",
  MEAN_MOTION: 16.4,
  ECCENTRICITY: 0.0005,
  BSTAR: 0.05,
  MEAN_MOTION_DOT: 0.01,
  NORAD_CAT_ID: 270001,
};

export function element(
  id: string,
  omm: Record<string, unknown> = ISS_OMM,
  name: string | null = String(omm.OBJECT_NAME ?? ""),
): RawElement {
  return { id, name, omm };
}
