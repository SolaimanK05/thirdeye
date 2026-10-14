export type MarkerGlyph = "triangle";

export type MarkerTone = "default" | "notable";

export type Marker = {
  id: string;
  lon: number;
  lat: number;
  glyph: MarkerGlyph;
  size: number;
  tone: MarkerTone;
  label: string;
};

export const HIT_RADIUS_PX = 22;
