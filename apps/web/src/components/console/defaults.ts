import type { ConsoleSnapshot } from "./types";

export const DEFAULT_INSTANCE_NAME = "thirdeye-local";

export const CONSOLE_DEFAULTS: Omit<ConsoleSnapshot, "instance"> = {
  zoomPercent: 100,
  centre: { lat: 11, lon: 86 },
  globeStyle: "GREEN",
  alerts: { count: 0, latest: null },
};
