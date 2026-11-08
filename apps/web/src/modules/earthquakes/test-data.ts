import type { EventDetail, EventRow } from "@/api/client";

export const QUAKE_DETAIL: EventDetail = {
  id: "earthquakes:us7000abcd",
  module_id: "earthquakes",
  category: "earthquake",
  geometry: { type: "Point", coordinates: [93.31, 22.41] },
  position: { lon: 93.31, lat: 22.41 },
  t_start: "2026-10-14T05:50:12Z",
  t_end: "2026-10-14T05:50:12Z",
  severity: 5.2,
  attrs: {
    depth_km: 10,
    place: "29 km SW of Falam, Myanmar",
    mag_type: "mww",
    status: "reviewed",
    tsunami: false,
    felt: 3,
  },
  confidence: "observed",
  retrieved_at: "2026-10-14T05:52:04Z",
  source: {
    id: "usgs-earthquakes",
    url: "earthquake.usgs.gov",
    licence: "Public domain (US Government work)",
    reliability: "primary",
  },
  provenance: {
    source_id: "usgs-earthquakes",
    source:
      "USGS Earthquake Hazards Program, real-time GeoJSON feed (past day)",
    licence: "Public domain (US Government work)",
    attribution: "USGS",
    freshness: "Feed regenerated every minute",
    confidence: "observed",
    limitations: [
      "Magnitudes are revised in the hours after an event.",
      "Detection density varies by region.",
      "Depth is least reliable for shallow offshore events.",
    ],
  },
};

export function quakeRow(id: string, severity: number | null): EventRow {
  return {
    id,
    category: "earthquake",
    lon: 90,
    lat: 23,
    t_start: "2026-10-14T05:00:00Z",
    t_end: null,
    severity,
    confidence: "observed",
    attrs: {},
  };
}
