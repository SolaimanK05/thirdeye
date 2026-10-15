import type { EntityRow } from "@/api/client";
import type { Marker } from "@/components/console/markers";
import type { ZoomLevel } from "@/components/console/types";

export const LABEL_FROM_LEVEL: ZoomLevel = 4;

const SIZE: Readonly<Record<string, number>> = { L: 13, M: 11, S: 9, V: 7 };
const DEFAULT_SIZE = 9;

const LEVEL_SCALE: Readonly<Record<ZoomLevel, number>> = {
  1: 0.6,
  2: 0.6,
  3: 0.85,
  4: 1,
};
const MIN_SIZE = 4;

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
    glyph: "square",
    size: portSize(row.attrs.harbor_size, context.level),
    tone: "default",
    label: row.name,
    entity: true,
    persistentLabel: labelled,
  }));
}
