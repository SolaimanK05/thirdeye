import type { EntityRow, EventRow } from "@/api/client";
import { FEET_PER_METRE } from "./aircraft/refine";
import { SHIP_TYPES, shipTypeOf, UNKNOWN_TYPE } from "./vessels/refine";

/**
 * How each module ranks its own markers when a draw limit has to leave some
 * out: higher is kept first. These are the row versions; data/importance-columns
 * reads the same measures from the data worker's columns, and a parity test
 * checks the two agree.
 */
const SHIP_SIZE_CLASS: Readonly<Record<string, number>> = {
  tanker: 6,
  cargo: 6,
  passenger: 5,
  military: 5,
  fishing: 3,
  tug: 2,
  other: 2,
  pleasure: 1,
};

export function shipSizeClass(type: string): number {
  return SHIP_SIZE_CLASS[type] ?? SHIP_SIZE_CLASS[UNKNOWN_TYPE];
}

export function shipTypeAt(classIndex: number): string {
  return classIndex >= 1 && classIndex <= SHIP_TYPES.length
    ? SHIP_TYPES[classIndex - 1].value
    : UNKNOWN_TYPE;
}

const HARBOUR_SIZE: Readonly<Record<string, number>> = {
  L: 4,
  M: 3,
  S: 2,
  V: 1,
};

export function harbourRank(size: unknown): number {
  return typeof size === "string" ? (HARBOUR_SIZE[size] ?? 0) : 0;
}

export function aircraftAltitudeFeet(
  onGround: boolean,
  metres: number | null,
): number {
  if (onGround) return 0;
  return metres === null || Number.isNaN(metres)
    ? Number.NaN
    : metres * FEET_PER_METRE;
}

export const eventImportance = {
  earthquakes: (row: EventRow) => row.severity ?? Number.NaN,
  wildfires: (row: EventRow) => row.severity ?? Number.NaN,
} as const;

export const entityImportance = {
  aircraft: (row: EntityRow) =>
    aircraftAltitudeFeet(row.attrs.on_ground === true, row.alt),
  vessels: (row: EntityRow) => shipSizeClass(shipTypeOf(row) ?? UNKNOWN_TYPE),
  ports: (row: EntityRow) => harbourRank(row.attrs.harbor_size),
} as const;
