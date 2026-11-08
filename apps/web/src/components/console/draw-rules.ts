import type { Filter, ZoomLevel } from "./types";

/**
 * Every zoom rule in one place. Rendering asks these functions and nothing
 * else decides what is drawn at a zoom level.
 *
 * The rules, in the order they apply:
 * 1. The filter comes first. NONE draws nothing, not even starred items, and
 *    a module that needs a key it does not have draws nothing.
 * 2. STARRED draws only starred items, at any zoom.
 * 3. ALL inside the module's zoom range draws everything, except that a
 *    module may ask for a minimum severity at some levels (earthquakes show
 *    only M5 and up at ORBIT). That table lives in the registry as data.
 * 4. ALL outside the range draws nothing, except starred items, which ignore
 *    zoom, and except a module the user pinned with SHOW HERE, which draws
 *    only what is in the current view.
 * 5. A selected item is never dropped by the severity floor.
 */

export type DrawModule = {
  filter: Filter;
  /** False when the module cannot run (its API key is missing). */
  usable: boolean;
  zoomRange: readonly [ZoomLevel, ZoomLevel] | null;
  /** SHOW HERE: draw what is in view although the zoom is out of range. */
  pinned?: boolean;
  /** The lowest severity drawn at a level; levels not listed have no floor. */
  minSeverityAt?: Readonly<Partial<Record<ZoomLevel, number>>>;
};

/** `over` is true while the zoom is past the module's own percent cap. */
export type DrawView = { level: ZoomLevel; over: boolean };

export type DrawItem = {
  starred: boolean;
  selected?: boolean;
  severity?: number | null;
  /** Whether the item is in the current view; asked only of a pinned module. */
  inView?: boolean;
};

/** What a module draws as a whole: everything, only its starred items, or nothing. */
export type Scope = "all" | "starred" | "none";

export function inZoomRange(
  zoomRange: DrawModule["zoomRange"],
  view: DrawView,
): boolean {
  return (
    zoomRange !== null &&
    !view.over &&
    view.level >= zoomRange[0] &&
    view.level <= zoomRange[1]
  );
}

export function scopeOf(module: DrawModule, view: DrawView): Scope {
  if (!module.usable || module.filter === "none") return "none";
  if (module.filter === "starred") return "starred";
  return inZoomRange(module.zoomRange, view) || module.pinned === true
    ? "all"
    : "starred";
}

/** A pinned module out of its range draws only what is in view. */
export function clipsToView(module: DrawModule, view: DrawView): boolean {
  return (
    module.pinned === true &&
    scopeOf(module, view) === "all" &&
    !inZoomRange(module.zoomRange, view)
  );
}

export function severityFloor(module: DrawModule, level: ZoomLevel): number {
  return module.minSeverityAt?.[level] ?? 0;
}

export function isDrawn(
  module: DrawModule,
  item: DrawItem,
  view: DrawView,
): boolean {
  const scope = scopeOf(module, view);
  if (scope === "none") return false;
  if (item.starred) return true;
  if (scope === "starred") return false;
  if (item.selected) return true;
  if (item.inView === false && clipsToView(module, view)) return false;
  const floor = severityFloor(module, view.level);
  return floor === 0 || (item.severity ?? 0) >= floor;
}
