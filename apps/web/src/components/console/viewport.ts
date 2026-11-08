import type { ViewBox } from "@/state/viewport";

export const WORLD_BOX: ViewBox = {
  west: -180,
  south: -90,
  east: 180,
  north: 90,
};

const PADDING = 0.25;
const GRID_STEPS = [1, 2, 5, 10, 20, 45] as const;
const CELLS_ACROSS = 4;

function lonSpan(box: ViewBox): number {
  return box.east >= box.west ? box.east - box.west : box.east + 360 - box.west;
}

function gridStep(span: number): number {
  const wanted = span / CELLS_ACROSS;
  return (
    GRID_STEPS.find((step) => step >= wanted) ??
    GRID_STEPS[GRID_STEPS.length - 1]
  );
}

function wrapLon(lon: number): number {
  if (lon > 180) return lon - 360;
  if (lon < -180) return lon + 360;
  return lon;
}

export function queryBox(view: ViewBox | null): ViewBox {
  if (view === null) return WORLD_BOX;
  const width = lonSpan(view);
  const height = view.north - view.south;
  const step = gridStep(Math.max(width, height));
  const south = Math.max(
    -90,
    Math.floor((view.south - height * PADDING) / step) * step,
  );
  const north = Math.min(
    90,
    Math.ceil((view.north + height * PADDING) / step) * step,
  );
  const west = Math.floor((view.west - width * PADDING) / step) * step;
  const east = Math.ceil((view.west + width * (1 + PADDING)) / step) * step;
  if (east - west >= 360) return { ...WORLD_BOX, south, north };
  return { west: wrapLon(west), south, east: wrapLon(east), north };
}

export function boxParam(box: ViewBox): string {
  return [box.west, box.south, box.east, box.north].join(",");
}

const CELL_STEPS = [0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8] as const;
const CELLS_ACROSS_VIEW = 45;
const MIN_POWER_BY_CELL = [
  { cell: 4, megawatts: 30 },
  { cell: 2, megawatts: 10 },
  { cell: 0.5, megawatts: 3 },
  { cell: 0.1, megawatts: 1 },
] as const;

export type Clustering = { cell: number; minSeverity: number };

export function clusterFor(box: ViewBox): Clustering | null {
  const span = Math.max(lonSpan(box), box.north - box.south);
  const wanted = span / CELLS_ACROSS_VIEW;
  if (wanted < CELL_STEPS[0]) return null;
  const cell =
    CELL_STEPS.find((step) => step >= wanted) ??
    CELL_STEPS[CELL_STEPS.length - 1];
  const floor = MIN_POWER_BY_CELL.find((tier) => cell >= tier.cell);
  return { cell, minSeverity: floor?.megawatts ?? 0 };
}
