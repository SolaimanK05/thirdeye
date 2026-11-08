import type { SatelliteElement } from "@/api/client";
import { formatCount } from "@/components/console/count";
import type { PickOption } from "@/state/refine-options";
import type { ChoiceOption, RefineSpec } from "../refine";

/** What a person can sort the satellites by, read once from each element set. */
export type SatelliteTraits = {
  id: string;
  orbit: string;
  family: string;
  owner: string | null;
  status: string | null;
  altitudeKm: number;
  inclination: number;
  launchYear: number | null;
};

const MU_KM3_S2 = 398_600.4418;
const EARTH_EQUATORIAL_RADIUS_KM = 6378.137;
const SECONDS_PER_DAY = 86_400;
export const LEO_APOGEE_KM = 2_000;
export const HEO_ECCENTRICITY = 0.25;
export const GEO_PERIOD_MIN: readonly [number, number] = [1_300, 1_500];

export const ORBITS: readonly ChoiceOption[] = [
  { value: "LEO", label: "LEO" },
  { value: "MEO", label: "MEO" },
  { value: "GEO", label: "GEO" },
  { value: "HEO", label: "HEO" },
  { value: "BEYOND", label: "BEYOND" },
];

export type Orbit = {
  orbit: string;
  altitudeKm: number;
};

/**
 * The orbit class and mean height from the shape of the orbit. LEO is an apogee
 * under 2,000 km, HEO a stretched ellipse, GEO a day-long period, MEO what is
 * left below that, and BEYOND anything that goes out past geostationary.
 */
export function orbitOf(meanMotion: number, eccentricity: number): Orbit {
  const periodS = SECONDS_PER_DAY / meanMotion;
  const axis = Math.cbrt(MU_KM3_S2 * (periodS / (2 * Math.PI)) ** 2);
  const altitudeKm = axis - EARTH_EQUATORIAL_RADIUS_KM;
  const apogee = axis * (1 + eccentricity) - EARTH_EQUATORIAL_RADIUS_KM;
  const minutes = periodS / 60;
  let orbit = "BEYOND";
  if (apogee <= LEO_APOGEE_KM) orbit = "LEO";
  else if (eccentricity >= HEO_ECCENTRICITY) orbit = "HEO";
  else if (minutes >= GEO_PERIOD_MIN[0] && minutes <= GEO_PERIOD_MIN[1]) {
    orbit = "GEO";
  } else if (minutes < GEO_PERIOD_MIN[0]) orbit = "MEO";
  return { orbit, altitudeKm };
}

/**
 * The name without its number: STARLINK-1007 is STARLINK, NAVSTAR 81 (USA 319)
 * is NAVSTAR. Satellites of one family share it, and nothing is lumped together.
 */
export function familyOf(name: string): string {
  const bare = name
    .toUpperCase()
    .replace(/\(.*?\)/g, " ")
    .trim();
  const stem = /^(.*?)[\s_-]*(?=\d|$)/.exec(bare)?.[1].trim() ?? "";
  return stem === "" ? bare || "UNNAMED" : stem;
}

/** Full names for the owner codes people are likely to look for. */
export const OWNER_NAMES: Readonly<Record<string, string>> = {
  US: "United States",
  PRC: "China",
  CIS: "Russia and the CIS",
  UK: "United Kingdom",
  JPN: "Japan",
  IND: "India",
  FR: "France",
  GER: "Germany",
  ESA: "European Space Agency",
  ITSO: "Intelsat",
  SES: "SES",
  ISS: "International Space Station",
  CA: "Canada",
  AUS: "Australia",
  KOR: "South Korea",
  ISRA: "Israel",
  ITA: "Italy",
  SPN: "Spain",
  TURK: "Turkey",
  BRAZ: "Brazil",
  UAE: "United Arab Emirates",
  LUXE: "Luxembourg",
  NOR: "Norway",
  GLOB: "Globalstar",
  ORB: "Orbcomm",
  EUTE: "Eutelsat",
  O3B: "O3b Networks",
};

export const ownerLabel = (code: string): string =>
  OWNER_NAMES[code] === undefined ? code : `${OWNER_NAMES[code]} (${code})`;

export const STATUSES: readonly (ChoiceOption & {
  codes: readonly string[];
})[] = [
  { value: "OPERATIONAL", label: "OPERATIONAL", codes: ["+"] },
  { value: "PARTIAL", label: "PARTIAL", codes: ["P"] },
  { value: "STANDBY", label: "STANDBY", codes: ["B", "S"] },
  { value: "EXTENDED", label: "EXTENDED", codes: ["X"] },
  { value: "INACTIVE", label: "INACTIVE", codes: ["-", "D"] },
  { value: "UNKNOWN", label: "UNKNOWN", codes: ["?"] },
];

export function statusOf(code: string | undefined): string | null {
  if (code === undefined || code === "") return null;
  return STATUSES.find((s) => s.codes.includes(code))?.value ?? "UNKNOWN";
}

function ownerOf(code: string | undefined): string | null {
  return code === undefined || code === "" ? null : code;
}

export function launchYearOf(designator: unknown): number | null {
  if (typeof designator !== "string") return null;
  const year = /^(\d{4})-/.exec(designator.trim());
  return year === null ? null : Number(year[1]);
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

export function traitsOf(element: SatelliteElement): SatelliteTraits | null {
  const { omm, satcat } = element;
  const motion = omm.MEAN_MOTION;
  const eccentricity = omm.ECCENTRICITY;
  if (
    typeof motion !== "number" ||
    typeof eccentricity !== "number" ||
    !Number.isFinite(motion) ||
    motion <= 0
  ) {
    return null;
  }
  const { orbit, altitudeKm } = orbitOf(motion, eccentricity);
  const inclination = omm.INCLINATION;
  return {
    id: element.id,
    orbit,
    family: familyOf(element.name ?? text(omm.OBJECT_NAME) ?? ""),
    owner: ownerOf(text(satcat?.OWNER)),
    status: statusOf(text(satcat?.OPS_STATUS_CODE)),
    altitudeKm,
    inclination: typeof inclination === "number" ? inclination : 0,
    launchYear: launchYearOf(omm.OBJECT_ID),
  };
}

const all = (options: readonly ChoiceOption[]) =>
  options.map((option) => option.value);

export const ALTITUDE_MAX_KM = 40_000;
export const INCLINATION_MAX = 180;
export const FIRST_LAUNCH_YEAR = 1957;
export const LAST_LAUNCH_YEAR = 2026;

export const satelliteRefine: RefineSpec<SatelliteTraits> = {
  controls: [
    {
      kind: "choices",
      id: "orbit",
      label: "ORBIT",
      short: "ORB",
      options: ORBITS,
      initial: all(ORBITS),
    },
    {
      kind: "pick",
      id: "families",
      label: "NAME FAMILY",
      short: "FAM",
      noun: "family",
      initial: [],
    },
    {
      kind: "pick",
      id: "owners",
      label: "OWNER",
      short: "OWN",
      noun: "owner",
      initial: [],
      format: ownerLabel,
    },
    {
      kind: "choices",
      id: "status",
      label: "STATUS",
      short: "STA",
      options: STATUSES,
      initial: all(STATUSES),
    },
    {
      kind: "range",
      id: "altitude",
      label: "ALTITUDE",
      short: "ALT",
      min: 0,
      max: ALTITUDE_MAX_KM,
      step: 100,
      initial: [0, ALTITUDE_MAX_KM],
      unit: "km",
      format: formatCount,
    },
    {
      kind: "range",
      id: "inclination",
      label: "INCLINATION",
      short: "INC",
      min: 0,
      max: INCLINATION_MAX,
      step: 1,
      initial: [0, INCLINATION_MAX],
      unit: "deg",
      format: (value) => String(value),
    },
    {
      kind: "range",
      id: "launched",
      label: "LAUNCHED",
      short: "LCH",
      min: FIRST_LAUNCH_YEAR,
      max: LAST_LAUNCH_YEAR,
      step: 1,
      initial: [FIRST_LAUNCH_YEAR, LAST_LAUNCH_YEAR],
      unit: "",
      format: (value) => String(value),
    },
  ],
  read: {
    orbit: (row) => row.orbit,
    families: (row) => row.family,
    owners: (row) => row.owner,
    status: (row) => row.status,
    altitude: (row) => row.altitudeKm,
    inclination: (row) => row.inclination,
    launched: (row) => row.launchYear,
  },
};

/** Every owner and name family in the loaded satellites, most numerous first. */
export function pickOptionsOf(
  rows: readonly SatelliteTraits[],
): Record<string, readonly PickOption[]> {
  const families = new Map<string, number>();
  const owners = new Map<string, number>();
  for (const row of rows) {
    families.set(row.family, (families.get(row.family) ?? 0) + 1);
    if (row.owner !== null) {
      owners.set(row.owner, (owners.get(row.owner) ?? 0) + 1);
    }
  }
  const list = (counts: Map<string, number>, label: (v: string) => string) =>
    [...counts]
      .map(([value, count]) => ({ value, label: label(value), count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  return {
    families: list(families, (value) => value),
    owners: list(owners, ownerLabel),
  };
}
