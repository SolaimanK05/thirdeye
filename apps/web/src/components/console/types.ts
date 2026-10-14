export type ZoomLevel = 1 | 2 | 3 | 4;

export type Health = "fresh" | "stale" | "failed" | "empty" | "missing-key";

export type Filter = "all" | "starred" | "none";

export type LatLon = { lat: number; lon: number };

export type GlobeStyle = "GREEN" | "NATURAL" | "BLACK";

export type ConfidenceTag = "OBS" | "REP" | "DER" | "INF";

export type ModuleRow = {
  id: string;
  name: string;
  health: Health;
  zoomRange: readonly [ZoomLevel, ZoomLevel] | null;
  filter: Filter;
  loaded: number;
  starredCount: number;
  inView?: number;
  missingKey?: string;
  failure?: string;
  lastGood?: string;
};

export type DomainGroup = {
  label: string;
  modules: readonly ModuleRow[];
};

export type StarredEntity = {
  id: string;
  name: string;
  module: string;
  age: string;
  tone: "normal" | "stale" | "gap";
};

export type SelectionRow = {
  key: string;
  value: string;
  confidence: ConfidenceTag;
};

export type SelectionAction = "star" | "follow" | "center";

export type Selection = {
  kind: string;
  name: string;
  subline: string;
  starred: boolean;
  actions: readonly SelectionAction[];
  sections: readonly { label: string; rows: readonly SelectionRow[] }[];
  provenance: {
    source: string;
    retrieved: string;
    reliability: string;
    licence: string;
  };
  limitations: readonly string[];
};

export type StatusLine = {
  health: Health;
  text: string;
};

export type ConsoleSnapshot = {
  instance: string;
  zoomPercent: number;
  centre: LatLon;
  globeStyle: GlobeStyle;
  alerts: { count: number; latest: string | null };
};
