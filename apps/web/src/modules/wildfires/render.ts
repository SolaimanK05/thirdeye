import type { EventRow } from "@/api/client";
import { formatCount } from "@/components/console/count";
import type { Marker } from "@/components/console/markers";

const MIN_SIZE = 8;
const MAX_SIZE = 18;
const SIZE_PER_DECADE = 3;
const CLUSTER_GROWTH = 4;

export function fireSize(frp: number | null): number {
  const size =
    MIN_SIZE + SIZE_PER_DECADE * Math.log10(1 + Math.max(0, frp ?? 0));
  return Math.round(Math.min(MAX_SIZE, size));
}

export function powerLabel(frp: number | null): string {
  if (frp === null) return "FRP ?";
  return `${frp < 10 ? frp.toFixed(1) : Math.round(frp)} MW`;
}

export function memberCount(row: EventRow): number {
  const count = row.attrs.cluster_count;
  return typeof count === "number" && Number.isInteger(count) && count > 1
    ? count
    : 1;
}

export function fireMarkers(rows: readonly EventRow[]): Marker[] {
  return rows.map((row) => {
    const count = memberCount(row);
    const base = {
      id: row.id,
      lon: row.lon,
      lat: row.lat,
      tone: "notable",
    } as const;
    if (count === 1) {
      return {
        ...base,
        glyph: "flame",
        size: fireSize(row.severity),
        label: powerLabel(row.severity),
      };
    }
    return {
      ...base,
      glyph: "flame-ring",
      size: fireSize(row.severity) + CLUSTER_GROWTH,
      label: `${formatCount(count)} detections, ${powerLabel(row.severity)}`,
      cluster: { count, megawatts: row.severity ?? 0 },
    };
  });
}
