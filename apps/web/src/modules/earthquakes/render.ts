import type { EventRow } from "@/api/client";
import type { Marker } from "@/components/console/markers";

export const NOTABLE_MAGNITUDE = 5;
const MIN_SIZE = 8;
const MAX_SIZE = 24;

export function quakeSize(magnitude: number | null): number {
  const size = MIN_SIZE + Math.max(0, magnitude ?? 0) * 2;
  return Math.round(Math.min(MAX_SIZE, size));
}

export function magnitudeLabel(magnitude: number | null): string {
  return magnitude === null ? "M?" : `M${magnitude.toFixed(1)}`;
}

export function quakeMarkers(rows: readonly EventRow[]): Marker[] {
  return rows.map((row) => ({
    id: row.id,
    lon: row.lon,
    lat: row.lat,
    glyph: "triangle",
    size: quakeSize(row.severity),
    tone:
      row.severity !== null && row.severity >= NOTABLE_MAGNITUDE
        ? "notable"
        : "default",
    label: magnitudeLabel(row.severity),
  }));
}
