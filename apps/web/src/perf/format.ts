import type { Percentiles, PerfSnapshot } from "./metrics";

const COUNT = new Intl.NumberFormat("en-US");

export function formatMs(value: number): string {
  return value.toFixed(1);
}

export function formatPair(values: Percentiles): string {
  return `${formatMs(values.p50)} / ${formatMs(values.p95)} ms`;
}

export function formatCount(value: number): string {
  return COUNT.format(Math.round(value));
}

export function formatLongTasks(tasks: PerfSnapshot["longTasks"]): string {
  if (tasks === null) return "n/a";
  if (tasks.count === 0) return "0";
  return `${formatCount(tasks.count)}, worst ${formatMs(tasks.worstMs)} ms`;
}

export function formatBusy(share: number | null): string {
  return share === null ? "n/a" : `${(share * 100).toFixed(0)} %`;
}

export function hudRows(
  snapshot: PerfSnapshot,
  loaded: number,
  renderer: string,
): readonly { key: string; label: string; value: string }[] {
  return [
    { key: "fps", label: "fps", value: snapshot.fps.toFixed(1) },
    {
      key: "draws",
      label: "draws per s",
      value: snapshot.drawsPerSecond.toFixed(1),
    },
    {
      key: "frame",
      label: "frame p50 / p95",
      value: formatPair(snapshot.frameMs),
    },
    {
      key: "draw",
      label: "draw p50 / p95",
      value: formatPair(snapshot.drawMs),
    },
    {
      key: "step",
      label: "step p50 / p95",
      value: formatPair(snapshot.stepMs),
    },
    {
      key: "longtasks",
      label: "long tasks (5 s)",
      value: formatLongTasks(snapshot.longTasks),
    },
    { key: "busy", label: "busy", value: formatBusy(snapshot.busyShare) },
    {
      key: "markers",
      label: "markers drawn / in view",
      value: `${formatCount(snapshot.markers.drawn)} / ${formatCount(snapshot.markers.inView)}`,
    },
    { key: "loaded", label: "markers loaded", value: formatCount(loaded) },
    { key: "renderer", label: "renderer", value: renderer },
  ];
}
