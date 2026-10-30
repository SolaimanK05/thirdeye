export type PerfFlags = {
  perf: boolean;
  bench: number;
  renderer: "auto" | "canvas";
};

export const BENCH_MAX = 1_000_000;

export const DEFAULT_FLAGS: PerfFlags = {
  perf: false,
  bench: 0,
  renderer: "auto",
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
  };
}
