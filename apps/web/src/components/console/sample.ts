import type { ConsoleSnapshot } from "./types";

export const SAMPLE: ConsoleSnapshot = {
  instance: "thirdeye-local",
  sampleData: true,
  zoomPercent: 100,
  centre: { lat: 11, lon: 86 },
  globeStyle: "GREEN",
  hud: { entities: 31, contacts: 153, layers: 7 },
  domains: [
    {
      label: "EARTH",
      modules: [
        {
          id: "earthquakes",
          name: "Earthquakes",
          health: "fresh",
          zoomRange: [1, 4],
          filter: "all",
          inView: 4,
        },
        {
          id: "wildfires",
          name: "Wildfires",
          health: "missing-key",
          zoomRange: [2, 4],
          filter: "all",
          missingKey: "FIRMS_MAP_KEY",
        },
      ],
    },
    {
      label: "MOVERS",
      modules: [
        {
          id: "vessels",
          name: "Vessels",
          health: "fresh",
          zoomRange: [2, 4],
          filter: "all",
          inView: 15,
        },
        {
          id: "aircraft",
          name: "Aircraft",
          health: "stale",
          zoomRange: [2, 4],
          filter: "all",
          inView: 160,
          lastGood: "11:21Z",
        },
        {
          id: "satellites",
          name: "Satellites",
          health: "fresh",
          zoomRange: [1, 2],
          filter: "all",
          inView: 6,
        },
      ],
    },
    {
      label: "INFRASTRUCTURE",
      modules: [
        {
          id: "ports",
          name: "Ports",
          health: "fresh",
          zoomRange: [2, 4],
          filter: "all",
          inView: 5,
        },
      ],
    },
  ],
  starred: [],
  selection: {
    kind: "EVENT",
    name: "M5.1 Andaman Islands region",
    subline: "Earthquake, automatic review",
    starred: false,
    actions: ["center"],
    sections: [
      {
        label: "DETAILS",
        rows: [
          { key: "MAGNITUDE", value: "5.1 mww", confidence: "OBS" },
          { key: "DEPTH", value: "10 km", confidence: "OBS" },
          { key: "ORIGIN", value: "10:58:12Z", confidence: "OBS" },
          { key: "REGION", value: "Andaman Islands region", confidence: "DER" },
        ],
      },
    ],
    provenance: {
      source: "USGS Earthquake Hazards Program",
      retrieved: "11:00:04Z, 23 min ago",
      reliability: "primary",
      licence: "Public domain (US Government work)",
    },
    limitations: [
      "Magnitudes are revised in the hours after an event.",
      "Detection density varies by region.",
      "Depth is least reliable for shallow offshore events.",
    ],
  },
  alerts: { count: 0, latest: null },
  status: [
    { health: "fresh", text: "worker 11:23:01Z" },
    { health: "stale", text: "opensky cooldown to 11:32Z" },
  ],
  attribution: [
    "USGS",
    "AISStream.io",
    "OpenSky Network",
    "CelesTrak",
    "World Port Index",
  ],
};
