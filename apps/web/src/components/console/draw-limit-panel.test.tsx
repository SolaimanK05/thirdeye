import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  DrawLimitFields,
  drawSummary,
  drawsAnything,
} from "./draw-limit-panel";
import type { ModuleRow } from "./types";

const ROW: ModuleRow = {
  id: "aircraft",
  name: "Aircraft",
  health: "fresh",
  zoomRange: [1, 4],
  filter: "all",
  loaded: 6000,
  starredCount: 0,
};

const html = (row: ModuleRow = ROW) =>
  renderToStaticMarkup(<DrawLimitFields row={row} />).replaceAll(
    "<!-- -->",
    "",
  );

describe("the draw limit fields", () => {
  test("offer ALL and the presets, with ALL pressed until a limit is chosen", () => {
    const markup = html();
    expect(markup).toContain("MOST MARKERS DRAWN");
    expect(markup).toContain(">ALL<");
    expect(markup).toContain('aria-pressed="true"');
  });

  test("summarise as plain words for the module's one-line summary", () => {
    expect(drawSummary(null)).toBe("draw all");
    expect(drawSummary(3000)).toBe("draw 3,000");
    expect(drawSummary(3000, true)).toBe("draw 3,000 (2D default)");
  });

  test("is left out for a module with no key or nothing to draw", () => {
    expect(html({ ...ROW, health: "missing-key" })).toBe("");
    expect(html({ ...ROW, id: "unknown" })).toBe("");
  });

  test("covers every module the console can draw", () => {
    for (const id of [
      "earthquakes",
      "wildfires",
      "ports",
      "aircraft",
      "vessels",
      "satellites",
    ]) {
      expect(drawsAnything(id), id).toBe(true);
    }
  });
});
