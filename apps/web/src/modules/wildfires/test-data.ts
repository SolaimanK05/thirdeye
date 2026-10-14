import type { EventDetail, EventRow } from "@/api/client";

export const FIRE_DETAIL: EventDetail = {
  id: "wildfires:n:20261014T0647:16.521:98.043",
  module_id: "wildfires",
  category: "thermal-anomaly",
  geometry: { type: "Point", coordinates: [98.04327, 16.52066] },
  position: { lon: 98.04327, lat: 16.52066 },
  t_start: "2026-10-14T06:47:00Z",
  t_end: "2026-10-14T06:47:00Z",
  severity: 27.6,
  attrs: {
    satellite: "N",
    instrument: "VIIRS",
    detection_confidence: "high",
    day_night: "D",
    brightness_ti4_k: 361.2,
    brightness_ti5_k: 304.88,
    frp_mw: 27.6,
    scan_km: 0.51,
    track_km: 0.42,
    version: "2.0NRT",
  },
  confidence: "derived",
  retrieved_at: "2026-10-14T09:00:04Z",
  source: {
    id: "nasa-firms",
    url: "firms.modaps.eosdis.nasa.gov",
    licence: "Open, attribution required",
    reliability: "primary",
  },
  provenance: {
    source_id: "nasa-firms",
    source: "NASA FIRMS, VIIRS S-NPP near real time active fire detections",
    licence: "Open, attribution required",
    attribution: "NASA FIRMS",
    freshness:
      "Polled every 3 hours; detections arrive minutes to hours after a satellite pass",
    confidence: "derived",
    limitations: [
      "A thermal anomaly is not a confirmed fire: gas flares, industrial heat and sun glint also trigger detections.",
      "Cloud cover hides fires entirely, so absence means not seen this pass.",
      "Each point is one 375 m pixel at the moment of a satellite overpass, not a fire perimeter.",
    ],
  },
};

export function fireRow(id: string, frp: number | null): EventRow {
  return {
    id,
    category: "thermal-anomaly",
    lon: 98.04,
    lat: 16.52,
    t_start: "2026-10-14T06:47:00Z",
    t_end: "2026-10-14T06:47:00Z",
    severity: frp,
    confidence: "derived",
    attrs: {},
  };
}
