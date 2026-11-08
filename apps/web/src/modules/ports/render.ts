import type { EntityRow } from "@/api/client";
import type { Marker } from "@/components/console/markers";
import type { ZoomLevel } from "@/components/console/types";

export const LABEL_FROM_LEVEL: ZoomLevel = 4;

const SIZE: Readonly<Record<string, number>> = { L: 20, M: 17, S: 14, V: 11 };
const DEFAULT_SIZE = 14;

const LEVEL_SCALE: Readonly<Record<ZoomLevel, number>> = {
  1: 0.7,
  2: 0.7,
  3: 0.9,
  4: 1,
};
const MIN_SIZE = 7;

export function portSize(harborSize: unknown, level: ZoomLevel = 4): number {
  const base =
    typeof harborSize === "string"
      ? (SIZE[harborSize] ?? DEFAULT_SIZE)
      : DEFAULT_SIZE;
  return Math.max(MIN_SIZE, Math.round(base * LEVEL_SCALE[level]));
}

export function portMarkers(
  rows: readonly EntityRow[],
  context: { level: ZoomLevel },
): Marker[] {
  const labelled = context.level >= LABEL_FROM_LEVEL;
  return rows.map((row) => ({
    id: row.id,
    lon: row.lon,
    lat: row.lat,
    glyph: "anchor",
    size: portSize(row.attrs.harbor_size, context.level),
    tone: "default",
    label: row.name,
    entity: true,
    persistentLabel: labelled,
  }));
}
