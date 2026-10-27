import type { ChartPoint, SelectionChart } from "./types";

export const CHART_WIDTH = 240;
export const CHART_HEIGHT = 56;
const PAD = 2;
const MINUTE_MS = 60_000;
const HOUR_MINUTES = 60;

export type ChartGeometry = {
  path: string;
  end: { x: number; y: number };
  max: number;
  spanMs: number;
};

export function chartGeometry(
  points: readonly ChartPoint[],
  width = CHART_WIDTH,
  height = CHART_HEIGHT,
): ChartGeometry | null {
  const usable = points.filter(
    (point) => Number.isFinite(point.t) && Number.isFinite(point.v),
  );
  if (usable.length < 2) return null;
  const first = usable[0].t;
  const spanMs = usable[usable.length - 1].t - first;
  if (spanMs <= 0) return null;
  const max = Math.max(1, ...usable.map((point) => point.v));
  const innerWidth = width - PAD * 2;
  const innerHeight = height - PAD * 2;
  const coords = usable.map((point) => ({
    x: PAD + ((point.t - first) / spanMs) * innerWidth,
    y: PAD + (1 - Math.max(0, point.v) / max) * innerHeight,
  }));
  const path = coords
    .map(
      ({ x, y }, index) =>
        `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`,
    )
    .join(" ");
  return { path, end: coords[coords.length - 1], max, spanMs };
}

export function spanLabel(spanMs: number): string {
  const minutes = Math.max(1, Math.round(spanMs / MINUTE_MS));
  if (minutes < HOUR_MINUTES) return `${minutes} min`;
  const hours = Math.floor(minutes / HOUR_MINUTES);
  const rest = minutes % HOUR_MINUTES;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function describeChart(
  chart: SelectionChart,
  geometry: ChartGeometry,
): string {
  const last = chart.points[chart.points.length - 1];
  return `${chart.label} over the last ${spanLabel(geometry.spanMs)}, latest ${last.v.toFixed(1)} ${chart.unit}, peak ${geometry.max.toFixed(1)} ${chart.unit}`;
}
