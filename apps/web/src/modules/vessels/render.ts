import type { EntityRow } from "@/api/client";
import type { ColumnarStyle } from "@/components/console/layer-state";
import type { Marker, MarkerSizing } from "@/components/console/markers";
import type { ZoomLevel } from "@/components/console/types";

export const SHIP_MAX_SIZE = 16;
export const SHIP_MIN_SIZE = 4;
export const SHIP_FROM_SIZE = 8;
export const FULL_SIZE_AT = 200;
export const MIN_SIZE_AT = 8000;
const DOT_PER_SHIP = 0.7;
export const SHIPS_FROM_LEVEL: ZoomLevel = 3;
export const FAR_DOT_SIZE = 4;

export function vesselHeading(row: EntityRow): number {
  return row.heading ?? row.cog ?? 0;
}

export function vesselSizing(inView: number): MarkerSizing {
  const span = Math.log(MIN_SIZE_AT / FULL_SIZE_AT);
  const progress = Math.log(Math.max(inView, 1) / FULL_SIZE_AT) / span;
  const share = Math.min(1, Math.max(0, progress));
  const size = Math.round(
    SHIP_MAX_SIZE - share * (SHIP_MAX_SIZE - SHIP_MIN_SIZE),
  );
  if (size >= SHIP_FROM_SIZE) return { glyph: "ship", size };
  return { glyph: "dot", size: Math.round(size * DOT_PER_SHIP) };
}

export function vesselMarkers(
  rows: readonly EntityRow[],
  context: { level: ZoomLevel },
): Marker[] {
  const far = context.level < SHIPS_FROM_LEVEL;
  return rows.map((row) => ({
    id: row.id,
    lon: row.lon,
    lat: row.lat,
    glyph: far ? "dot" : "ship",
    size: far ? FAR_DOT_SIZE : SHIP_MAX_SIZE,
    tone: "default",
    label: row.name,
    entity: true,
    adaptive: !far,
    rotation: vesselHeading(row),
  }));
}

export function vesselStyle(context: { level: ZoomLevel }): ColumnarStyle {
  const far = context.level < SHIPS_FROM_LEVEL;
  return {
    glyph: far ? "dot" : "ship",
    size: far ? FAR_DOT_SIZE : SHIP_MAX_SIZE,
    adaptive: !far,
  };
}
