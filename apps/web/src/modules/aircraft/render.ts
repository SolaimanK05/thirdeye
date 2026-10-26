import type { EntityRow } from "@/api/client";
import type { Marker, MarkerSizing } from "@/components/console/markers";

export const PLANE_MAX_SIZE = 22;
export const PLANE_MIN_SIZE = 5;
export const PLANE_FROM_SIZE = 9;
export const FULL_SIZE_AT = 150;
export const MIN_SIZE_AT = 3000;
const DOT_PER_PLANE = 0.6;

export function aircraftHeading(row: EntityRow): number {
  return row.heading ?? row.cog ?? 0;
}

export function aircraftSizing(inView: number): MarkerSizing {
  const span = Math.log(MIN_SIZE_AT / FULL_SIZE_AT);
  const progress = Math.log(Math.max(inView, 1) / FULL_SIZE_AT) / span;
  const share = Math.min(1, Math.max(0, progress));
  const size = Math.round(
    PLANE_MAX_SIZE - share * (PLANE_MAX_SIZE - PLANE_MIN_SIZE),
  );
  if (size >= PLANE_FROM_SIZE) return { glyph: "plane", size };
  return { glyph: "dot", size: Math.round(size * DOT_PER_PLANE) };
}

export function aircraftMarkers(rows: readonly EntityRow[]): Marker[] {
  return rows.map((row) => ({
    id: row.id,
    lon: row.lon,
    lat: row.lat,
    glyph: "plane",
    size: PLANE_MAX_SIZE,
    tone: "default",
    label: row.name,
    entity: true,
    adaptive: true,
    rotation: aircraftHeading(row),
  }));
}
