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
  alerts: { count: 0, latest: null },
};
