import type { OrbitSample, RawElement } from "./propagator";

export type WorkerRequest =
  | { type: "load"; elements: readonly RawElement[] }
  | {
      type: "tick";
      atMs: number;
      selected: string | null;
      recycle: Float64Array | null;
    }
  | { type: "clear" };

export type WorkerResponse =
  | { type: "loaded"; loaded: number; rejected: number }
  | {
      type: "frame";
      atMs: number;
      count: number;
      positions: Float64Array;
      ids: readonly string[] | null;
      sample: OrbitSample | null;
    }
  | { type: "failed"; message: string };
