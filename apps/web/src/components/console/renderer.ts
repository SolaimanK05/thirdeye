import type { FrameUniforms } from "./gpu/frame";
import type { LayerSizing } from "./markers";

export type RenderLayer = {
  slot: number;
  count: number;
  stale: boolean;
  pickable: boolean;
  order: Uint32Array;
  ecef: Float64Array;
  rotationDeg: Float32Array;
  glyph: Uint8Array;
  size: Uint8Array;
  tone: Uint8Array;
  adaptive: Uint8Array;
  faded: Uint8Array;
  fadedCount: number;
  sizing: LayerSizing | undefined;
  sizedGlyph: number;
  sizedSize: number;
  dirtyBlocks: Uint8Array;
  dirtyCount: number;
  moving: boolean;
  delta: Float64Array | null;
  times: Float64Array | null;
  headings: Float32Array | null;
  epoch: number;
};

export const DIRTY_BLOCK = 256;

export type PickResult = { slot: number; marker: number };

export type DrawOutcome = {
  counts: ReadonlyMap<number, number>;
  masks: ReadonlyMap<number, Uint8Array>;
};

export interface MarkerRenderer {
  readonly kind: "webgl2" | "canvas";
  resize(cssWidth: number, cssHeight: number, ratio: number): void;
  syncLayer(layer: RenderLayer): void;
  updatePositions(layer: RenderLayer, from: number, to: number): void;
  removeLayer(slot: number): void;
  draw(
    frame: FrameUniforms,
    layers: readonly RenderLayer[],
  ): DrawOutcome | null;
  pick(
    cssX: number,
    cssY: number,
    frame: FrameUniforms,
    layers: readonly RenderLayer[],
  ): PickResult | null;
  destroy(): void;
}

export class RendererError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RendererError";
  }
}

export type MarkerPalette = {
  default: string;
  notable: string;
  accent: string;
  plate: string;
  font: string;
};
