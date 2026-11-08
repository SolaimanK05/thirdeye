import type { GlobeStyle } from "./types";
import { zoomLevelFor } from "./zoom";

export type MapDetail = "110m" | "50m";

export const DESIGN_SCALE = 0.732;
export const GRATICULE_STEP = 15;

export type LineLook = { width: number; alpha: number };

export function hairline(designWidth: number, opacity: number): LineLook {
  const width = designWidth * DESIGN_SCALE;
  return width >= 1
    ? { width, alpha: opacity }
    : { width: 1, alpha: opacity * width };
}

export const LINE_LOOK = {
  coast: hairline(1.3, 1),
  border: { ...hairline(0.7, 0.8 * 0.75), dash: 6 * DESIGN_SCALE },
  grid: hairline(0.8, 0.55),
  landFill: { alpha: 0.13 },
};

export const DASH_PATTERN = 0xff00;

export const FILL_WIDTH: Record<MapDetail, number> = {
  "110m": 2048,
  "50m": 4096,
};

export const GLOBE_STYLES: readonly GlobeStyle[] = [
  "GREEN",
  "NATURAL",
  "BLACK",
];

export const isGlobeStyle = (value: unknown): value is GlobeStyle =>
  GLOBE_STYLES.includes(value as GlobeStyle);

export const GLOBE_STYLE_KEY = "thirdeye.globeStyle";

/** The style saved in this browser, or null when there is none or storage is blocked. */
export function readSavedStyle(): GlobeStyle | null {
  try {
    const saved = localStorage.getItem(GLOBE_STYLE_KEY);
    return isGlobeStyle(saved) ? saved : null;
  } catch {
    return null;
  }
}

export function saveStyle(style: GlobeStyle): void {
  try {
    localStorage.setItem(GLOBE_STYLE_KEY, style);
  } catch {
    // Blocked storage only means the choice is not remembered.
  }
}

export function isVectorStyle(style: GlobeStyle): boolean {
  return style !== "NATURAL";
}

export function mapDetailFor(zoomPercent: number): MapDetail {
  const { name } = zoomLevelFor(zoomPercent);
  return name === "ORBIT" || name === "GLOBAL" ? "110m" : "50m";
}
