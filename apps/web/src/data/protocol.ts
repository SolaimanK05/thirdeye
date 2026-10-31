import type { RefineValues } from "@/modules/refine";
import type { MotionMode } from "@/state/motion";

/**
 * Messages between the page and the data worker. Everything here is plain data
 * or typed arrays; buffers are transferred, never shared.
 */

export type MoverSpec = { id: string; delaySeconds: number };

/** "segments" feeds the WebGL renderer; "positions" feeds the 2D canvas fallback. */
export type MotionFeed = "segments" | "positions";

export type ToWorker =
  | {
      type: "init";
      apiUrl: string;
      movers: MoverSpec[];
      clockOffsetMs: number;
      feed: MotionFeed;
    }
  | { type: "movers"; movers: MoverSpec[] }
  | { type: "notice"; moduleId: string; version: number }
  | { type: "resync" }
  | { type: "clock"; offsetMs: number }
  | { type: "feed"; feed: MotionFeed }
  | { type: "refine"; moduleId: string; values: RefineValues }
  | {
      type: "keep";
      moduleId: string;
      keep: Uint32Array;
      starred: Uint32Array;
      onlyStarred: boolean;
    }
  | { type: "visible"; moduleId: string; visible: boolean }
  | { type: "announce"; moduleId: string }
  | { type: "stop" };

export type FromWorker =
  | {
      type: "dictionary";
      moduleId: string;
      epoch: number;
      reset: boolean;
      slots: Uint32Array;
      idOffsets: Uint32Array;
      idBytes: Uint8Array;
      nameOffsets: Uint32Array;
      nameBytes: Uint8Array;
    }
  | {
      type: "layer";
      moduleId: string;
      seq: number;
      epoch: number;
      version: number;
      slots: Uint32Array;
      rotation: Float32Array;
      lon: Float64Array;
      lat: Float64Array;
      kept: number;
      total: number;
      fetchedMs: number;
      sentAt: number;
    }
  | {
      type: "segments";
      moduleId: string;
      seq: number;
      /** Rows the packed data belongs to; null means every row, in order. */
      rows: Uint32Array | null;
      data: Float64Array;
      sentAt: number;
    }
  | {
      type: "positions";
      moduleId: string;
      seq: number;
      data: Float64Array;
      sentAt: number;
    }
  | { type: "mode"; moduleId: string; mode: MotionMode | null }
  | {
      type: "status";
      moduleId: string;
      state: "loading" | "ready" | "error";
      message?: string;
    }
  | { type: "stats"; stats: DataStats; sentAt: number };

export type DataStats = {
  bytes: number;
  frames: number;
  snapshots: number;
  applyMs: { p50: number; p95: number };
  rows: number;
};

export const SEGMENT_PACK_STRIDE = 9;
export const POSITION_PACK_STRIDE = 4;
