export type ClusterInfo = { count: number; megawatts: number };

export type MarkerGlyph =
  | "triangle"
  | "flame"
  | "flame-ring"
  | "square"
  | "plane"
  | "ship"
  | "dot";

export type MarkerTone = "default" | "notable" | "accent";

export type MarkerSizing = { glyph: MarkerGlyph; size: number };

export type LayerSizing = (inView: number) => MarkerSizing;

export type Marker = {
  id: string;
  lon: number;
  lat: number;
  glyph: MarkerGlyph;
  size: number;
  tone: MarkerTone;
  label: string;
  cluster?: ClusterInfo;
  entity?: boolean;
  persistentLabel?: boolean;
  rotation?: number;
  adaptive?: boolean;
};

export type LayerOptions = { pickable?: boolean; reported?: boolean };

export type OverlayStats = {
  layers: number;
  markers: number;
};

export type SegmentUpdate = {
  data: Float64Array;
  rows: Uint32Array | null;
  count: number;
};

export type OverlayPort = {
  setLayer: (
    moduleId: string,
    markers: readonly Marker[],
    stale: boolean,
    sizing?: LayerSizing,
    options?: LayerOptions,
  ) => void;
  removeLayer: (moduleId: string) => void;
  setPositions: (moduleId: string, data: Float64Array) => void;
  setSegments?: (moduleId: string, update: SegmentUpdate) => void;
  segmentMotion?: () => boolean;
  invalidate: () => void;
};

export const HIT_RADIUS_PX = 22;

export function withStars(
  markers: readonly Marker[],
  starred: ReadonlySet<string>,
  onlyStarred: boolean,
): Marker[] {
  const result: Marker[] = [];
  for (const marker of markers) {
    if (starred.has(marker.id)) {
      result.push({ ...marker, tone: "accent", persistentLabel: true });
    } else if (!onlyStarred) {
      result.push(marker);
    }
  }
  return result;
}

export const POSITION_STRIDE = 4;

export const SEGMENT_STRIDE = 9;
export const SEGMENT_LON0 = 0;
export const SEGMENT_LAT0 = 1;
export const SEGMENT_LON1 = 2;
export const SEGMENT_LAT1 = 3;
export const SEGMENT_T0 = 4;
export const SEGMENT_T1 = 5;
export const SEGMENT_H0 = 6;
export const SEGMENT_H1 = 7;
export const SEGMENT_FADED = 8;
