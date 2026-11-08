import type { GlobeStyle } from "./types";

/** What one module's markers look like on one globe style. */
export type MarkerLook = {
  /** Plain markers, and the module's own hue. */
  default: string;
  /** Markers that stand out inside the module (a quake of magnitude 6 or more). */
  notable: string;
  /** Starred and selected markers. */
  accent: string;
  /** The halo that keeps a marker readable on any ground. */
  outline: string;
  /** Halo width in CSS pixels. */
  outlinePx: number;
};

const OUTLINE_PX: Record<GlobeStyle, number> = {
  GREEN: 1.2,
  NATURAL: 1.8,
  BLACK: 1.2,
};

/** The CSS custom properties (in globals.css) that hold each colour. */
export type Token = (name: string) => string;

/** GREEN is green already, so starred turns white there; the others keep the brand green. */
const ACCENT: Record<GlobeStyle, string> = {
  GREEN: "--marker-starred-green",
  NATURAL: "--marker-starred",
  BLACK: "--marker-starred",
};

type Hue = { default: string; notable?: string; outline?: string };

function hueOf(moduleId: string, style: GlobeStyle): Hue | undefined {
  switch (moduleId) {
    case "aircraft":
      return { default: "--marker-aircraft" };
    case "vessels":
      return {
        default:
          style === "NATURAL" ? "--marker-vessel-natural" : "--marker-vessel",
      };
    // A deep blue on the dark globes, set well apart from the pale blue vessels.
    case "ports":
      return {
        default: style === "NATURAL" ? "--marker-port" : "--marker-port-dark",
      };
    case "earthquakes":
      return { default: "--marker-quake", notable: "--marker-quake-big" };
    case "wildfires":
      return { default: "--marker-wildfire" };
    // Drawn as line art, so a white line on a black halo stands for white on black.
    case "satellites":
      return {
        default: "--marker-satellite",
        outline: "--marker-satellite-halo",
      };
    default:
      return undefined;
  }
}

/** The look of a module's markers, or undefined for a module with no colours of its own. */
export function markerLook(
  style: GlobeStyle,
  moduleId: string,
  token: Token,
): MarkerLook | undefined {
  const hue = hueOf(moduleId, style);
  if (!hue) return undefined;
  return {
    default: token(hue.default),
    notable: token(hue.notable ?? hue.default),
    accent: token(ACCENT[style]),
    outline: token(hue.outline ?? "--marker-halo"),
    outlinePx: OUTLINE_PX[style],
  };
}

export const COLOURED_MODULES = [
  "aircraft",
  "vessels",
  "ports",
  "earthquakes",
  "wildfires",
  "satellites",
] as const;
