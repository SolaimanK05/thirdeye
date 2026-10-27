import type { EntityRow } from "@/api/client";
import type { RefineSpec } from "../refine";

export const SPEED_MAX_KNOTS = 30;

export const SHIP_TYPES = [
  { value: "cargo", label: "CARGO" },
  { value: "tanker", label: "TANKER" },
  { value: "passenger", label: "PASSENGER" },
  { value: "fishing", label: "FISHING" },
  { value: "tug", label: "TUG" },
  { value: "pleasure", label: "PLEASURE" },
  { value: "military", label: "MILITARY" },
  { value: "other", label: "OTHER" },
] as const;

const KNOWN = new Set<string>(SHIP_TYPES.map((type) => type.value));
export const UNKNOWN_TYPE = "other";

export function shipTypeOf(row: EntityRow): string | null {
  const type = row.attrs.ship_type;
  if (typeof type !== "string") return null;
  return KNOWN.has(type) ? type : UNKNOWN_TYPE;
}

export const vesselRefine: RefineSpec<EntityRow> = {
  controls: [
    {
      kind: "choices",
      id: "type",
      label: "SHIP TYPE",
      short: "TYPE",
      options: SHIP_TYPES,
      initial: SHIP_TYPES.map((type) => type.value),
    },
    {
      kind: "range",
      id: "speed",
      label: "SPEED",
      short: "SPD",
      min: 0,
      max: SPEED_MAX_KNOTS,
      step: 1,
      initial: [0, SPEED_MAX_KNOTS],
      unit: "kn",
      format: (value) => String(value),
    },
  ],
  read: {
    type: (row) => shipTypeOf(row) ?? UNKNOWN_TYPE,
    speed: (row) => row.sog,
  },
};
