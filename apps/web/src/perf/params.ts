export type PerfFlags = {
  perf: boolean;
  bench: number;
  renderer: "auto" | "canvas";
  /** False for `?worker=0`: keep movers on the main thread over JSON, as in Phase 15. */
  worker: boolean;
  /** `?synthetic=1`: also draw the server's synthetic movers (needs SYNTHETIC_MOVERS). */
  synthetic: boolean;
};

export const BENCH_MAX = 1_000_000;

export const DEFAULT_FLAGS: PerfFlags = {
  perf: false,
  bench: 0,
  renderer: "auto",
  worker: true,
  synthetic: false,
};

const DIGITS = /^\d+$/;

function benchCount(value: string | null): number {
  if (value === null || !DIGITS.test(value)) return 0;
  return Math.min(BENCH_MAX, Number(value));
}

export function readFlags(search: string): PerfFlags {
  const params = new URLSearchParams(search);
  return {
    perf: params.get("perf") === "1",
    bench: benchCount(params.get("bench")),
    renderer: params.get("renderer") === "canvas" ? "canvas" : "auto",
    worker: params.get("worker") !== "0",
    synthetic: params.get("synthetic") === "1",
  };
}
