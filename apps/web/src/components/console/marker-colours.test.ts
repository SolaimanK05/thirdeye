import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { COLOURED_MODULES, markerLook, type Token } from "./marker-colours";
import type { GlobeStyle } from "./types";

const STYLES: readonly GlobeStyle[] = ["GREEN", "NATURAL", "BLACK"];

const CSS = readFileSync(
  join(fileURLToPath(new URL(".", import.meta.url)), "../../app/globals.css"),
  "utf8",
);

/** The custom properties in globals.css, the way the browser would resolve them. */
const token: Token = (name) => {
  const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6});`).exec(CSS);
  if (!match) throw new Error(`${name} is not defined in globals.css`);
  return match[1].toLowerCase();
};

const GROUND = token("--color-ground");

function rgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio. */
function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

const look = (style: GlobeStyle, id: string) => markerLook(style, id, token);

describe("marker colours", () => {
  test("every module has a look on every style", () => {
    for (const style of STYLES) {
      for (const id of COLOURED_MODULES) {
        expect(look(style, id), `${style} ${id}`).toBeDefined();
      }
    }
  });

  test("a module with no colours of its own gets none", () => {
    expect(look("GREEN", "synthetic")).toBeUndefined();
  });

  test("the agreed hues", () => {
    expect(look("GREEN", "aircraft")?.default).toBe("#ffe600");
    expect(look("GREEN", "vessels")?.default).toBe("#5ad1ff");
    expect(look("BLACK", "vessels")?.default).toBe("#5ad1ff");
    expect(look("NATURAL", "vessels")?.default).toBe("#ff9500");
    expect(look("GREEN", "ports")?.default).toBe("#3d5afe");
    expect(look("BLACK", "ports")?.default).toBe("#3d5afe");
    expect(look("NATURAL", "ports")?.default).toBe("#b388ff");
    expect(look("GREEN", "earthquakes")?.default).toBe("#ffb000");
    expect(look("GREEN", "earthquakes")?.notable).toBe("#b0001e");
    expect(look("GREEN", "wildfires")?.default).toBe("#ff3b30");
    expect(look("GREEN", "satellites")?.default).toBe("#ffffff");
    expect(look("GREEN", "satellites")?.outline).toBe("#000000");
  });

  test("starred is white on GREEN and brand green elsewhere", () => {
    expect(look("GREEN", "ports")?.accent).toBe("#ffffff");
    expect(look("NATURAL", "ports")?.accent).toBe("#00ff41");
    expect(look("BLACK", "ports")?.accent).toBe("#00ff41");
  });

  test("the halo is 1.8 px on NATURAL and 1.2 px elsewhere", () => {
    expect(look("NATURAL", "ports")?.outlinePx).toBe(1.8);
    expect(look("GREEN", "ports")?.outlinePx).toBe(1.2);
    expect(look("BLACK", "ports")?.outlinePx).toBe(1.2);
  });

  test("GREEN and BLACK use no green for modules", () => {
    for (const id of COLOURED_MODULES) {
      for (const style of ["GREEN", "BLACK"] as const) {
        const hues = look(style, id);
        for (const hex of [hues?.default, hues?.notable]) {
          const [r, g, b] = rgb(hex ?? "#000000");
          expect(g > r + 60 && g > b + 60, `${style} ${id} ${hex}`).toBe(false);
        }
      }
    }
  });

  test("ports are a deep blue, clearly darker than the vessels' blue", () => {
    const luminance = (hex: string) => {
      const [r, g, b] = rgb(hex);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (const style of ["GREEN", "BLACK"] as const) {
      const port = look(style, "ports")?.default ?? "";
      const vessel = look(style, "vessels")?.default ?? "";
      const [r, g, b] = rgb(port);
      expect(b > r + 60 && b > g + 60, `${style} port ${port}`).toBe(true);
      expect(luminance(vessel) - luminance(port)).toBeGreaterThan(80);
    }
  });

  test("NATURAL uses no green for modules, and no white except the satellite line", () => {
    for (const id of COLOURED_MODULES) {
      const hues = look("NATURAL", id);
      for (const hex of [hues?.default, hues?.notable]) {
        const [r, g, b] = rgb(hex ?? "#000000");
        expect(g > r + 60 && g > b + 60, `${id} ${hex}`).toBe(false);
        if (id !== "satellites") {
          expect(r > 240 && g > 240 && b > 240, `${id} ${hex}`).toBe(false);
        }
      }
    }
  });

  // WCAG 2.2 non-text contrast is 3:1. The big-quake red is the one accepted
  // exception (2.77:1 measured; it is drawn larger instead).
  test("every colour reads against the ground, or against its own halo", () => {
    for (const style of STYLES) {
      for (const id of COLOURED_MODULES) {
        const hues = look(style, id);
        if (!hues) continue;
        const tones = {
          default: hues.default,
          notable: hues.notable,
          accent: hues.accent,
        };
        for (const [tone, hex] of Object.entries(tones)) {
          const against = style === "NATURAL" ? hues.outline : GROUND;
          const ratio = contrast(hex, against);
          if (id === "earthquakes" && tone === "notable") {
            expect(ratio, `${style} big quake`).toBeGreaterThan(2.7);
          } else {
            expect(ratio, `${style} ${id} ${tone}`).toBeGreaterThanOrEqual(3);
          }
        }
      }
    }
  });
});
