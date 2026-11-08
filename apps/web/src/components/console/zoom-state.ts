import type { ZoomLevel } from "./types";
import { clampZoom, levelBounds, levelName, zoomLevelFor } from "./zoom";

/**
 * The zoom as the draw rules see it: a level that does not flicker.
 *
 * Zooming in takes effect at the boundary, so a button press from 100% to 200%
 * reaches REGIONAL at once. Zooming out has to cross the boundary by this much
 * more before the level drops, so a camera resting on a boundary stays put.
 */
export const HYSTERESIS = 0.08;

/** A module's own cap, in percent, by module id (satellites hide above 300%). */
export type ZoomCaps = Readonly<Record<string, number>>;

export type ZoomState = {
  percent: number;
  level: ZoomLevel;
  name: string;
  /** The modules whose cap the zoom is past. */
  over: ReadonlySet<string>;
};

export function stableLevel(previous: ZoomLevel, percent: number): ZoomLevel {
  const plain = zoomLevelFor(percent).level;
  if (plain >= previous) return plain;
  const edge = levelBounds(previous).from;
  return percent < edge / (1 + HYSTERESIS) ? plain : previous;
}

/** Past the cap once the zoom is 8% beyond it, back inside as soon as it is at it. */
export function stableOver(
  wasOver: boolean,
  percent: number,
  cap: number,
): boolean {
  return wasOver ? percent > cap : percent > cap * (1 + HYSTERESIS);
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

export function initialZoomState(percent: number, caps: ZoomCaps): ZoomState {
  const clamped = clampZoom(percent);
  const { level } = zoomLevelFor(clamped);
  const over = new Set(
    Object.entries(caps).flatMap(([id, cap]) => (clamped > cap ? [id] : [])),
  );
  return { percent: clamped, level, name: levelName(level), over };
}

export function nextZoomState(
  previous: ZoomState,
  percent: number,
  caps: ZoomCaps,
): ZoomState {
  const clamped = clampZoom(percent);
  const level = stableLevel(previous.level, clamped);
  const over = new Set(
    Object.entries(caps).flatMap(([id, cap]) =>
      stableOver(previous.over.has(id), clamped, cap) ? [id] : [],
    ),
  );
  return {
    percent: clamped,
    level,
    name: levelName(level),
    over: sameSet(over, previous.over) ? previous.over : over,
  };
}
