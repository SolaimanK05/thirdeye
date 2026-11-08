export type ClusterInfo = { count: number; megawatts: number };

export type MarkerGlyph =
  | "triangle"
  | "flame"
  | "flame-ring"
  | "square"
  | "plane"
  | "ship"
  | "dot"
  | "quake"
  | "anchor";

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

/** A dashed circle on the ground around marker `index`, `radiusKm` out from it. */
export type FootprintRing = { index: number; radiusKm: number };

export type LayerOptions = { pickable?: boolean; reported?: boolean };

export type OverlayStats = {
  layers: number;
  markers: number;
};

export type SegmentUpdate = {
  data: Float64Array;
  rows: Uint32Array | null;
  count: number;
  /**
   * True when `data` holds only the listed rows, one after another, instead of
   * a slot for every row of the layer.
   */
  packed?: boolean;
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
  setHeights?: (moduleId: string, heights: Float32Array | null) => void;
  setRings?: (moduleId: string, rings: readonly FootprintRing[] | null) => void;
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
