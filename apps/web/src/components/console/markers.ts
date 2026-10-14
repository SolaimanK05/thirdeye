export type ClusterInfo = { count: number; megawatts: number };

export type MarkerGlyph = "triangle" | "flame" | "flame-ring";

export type MarkerTone = "default" | "notable";

export type Marker = {
  id: string;
  lon: number;
  lat: number;
  glyph: MarkerGlyph;
  size: number;
  tone: MarkerTone;
  label: string;
  cluster?: ClusterInfo;
};

export const HIT_RADIUS_PX = 22;
