import { describe, expect, test } from "vitest";
import { GLYPH_COUNT, GLYPH_ORDER, glyphExtent, SIZE_MAX } from "../glyphs";
import {
  ATLAS_SIZE,
  AtlasLayout,
  CELL_PAD,
  SUPERSAMPLE,
  TABLE_HEIGHT,
  TABLE_WIDTH,
} from "./atlas";

function fill(layout: AtlasLayout, sizes: readonly number[]) {
  for (let glyph = 0; glyph < GLYPH_COUNT; glyph++) {
    for (const size of sizes) layout.add(glyph, size);
  }
}

const SIZES = [1, 3, 6, 9, 10, 12, 16, 22, 32];

describe("atlas layout", () => {
  test("is deterministic", () => {
    const a = new AtlasLayout(1);
    const b = new AtlasLayout(1);
    fill(a, SIZES);
    fill(b, SIZES);
    expect(a.cells()).toEqual(b.cells());
    expect(Array.from(a.table())).toEqual(Array.from(b.table()));
  });

  test("scale is the pixel ratio times the supersample", () => {
    expect(new AtlasLayout(1.5).scale).toBe(1.5 * SUPERSAMPLE);
  });

  test("no two cells, with their padding, overlap", () => {
    const layout = new AtlasLayout(2);
    fill(layout, SIZES);
    const boxes = layout.cells().map((cell) => ({
      left: cell.x - CELL_PAD,
      top: cell.y - CELL_PAD,
      right: cell.x + cell.width + CELL_PAD,
      bottom: cell.y + cell.height + CELL_PAD,
    }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const apart =
          a.right <= b.left ||
          b.right <= a.left ||
          a.bottom <= b.top ||
          b.bottom <= a.top;
        expect(apart).toBe(true);
      }
    }
  });

  test("every cell lies inside the texture, padding included", () => {
    const layout = new AtlasLayout(2);
    fill(layout, SIZES);
    for (const cell of layout.cells()) {
      expect(cell.x - CELL_PAD).toBeGreaterThanOrEqual(0);
      expect(cell.y - CELL_PAD).toBeGreaterThanOrEqual(0);
      expect(cell.x + cell.width + CELL_PAD).toBeLessThanOrEqual(ATLAS_SIZE);
      expect(cell.y + cell.height + CELL_PAD).toBeLessThanOrEqual(ATLAS_SIZE);
      expect(cell.u1).toBeGreaterThan(cell.u0);
      expect(cell.v1).toBeGreaterThan(cell.v0);
      expect(cell.u1).toBeLessThanOrEqual(1);
      expect(cell.v1).toBeLessThanOrEqual(1);
    }
  });

  test("extents cover glyphExtent and exceed it by less than one device pixel", () => {
    const layout = new AtlasLayout(1);
    fill(layout, SIZES);
    for (const cell of layout.cells()) {
      const wanted = glyphExtent(GLYPH_ORDER[cell.glyph], cell.size);
      expect(cell.halfWidth).toBeGreaterThanOrEqual(wanted.halfWidth - 1e-9);
      expect(cell.halfHeight).toBeGreaterThanOrEqual(wanted.halfHeight - 1e-9);
      expect(cell.halfWidth - wanted.halfWidth).toBeLessThan(
        1 / (2 * layout.scale) + 1e-9,
      );
      expect(cell.halfHeight - wanted.halfHeight).toBeLessThan(
        1 / (2 * layout.scale) + 1e-9,
      );
    }
  });

  test("the lookup table holds the rectangle and the extent of each cell", () => {
    const layout = new AtlasLayout(1);
    fill(layout, SIZES);
    const table = layout.table();
    expect(table.length).toBe(TABLE_WIDTH * TABLE_HEIGHT * 4);
    for (const cell of layout.cells()) {
      const first = (cell.glyph * 2 * TABLE_WIDTH + cell.size) * 4;
      const second = ((cell.glyph * 2 + 1) * TABLE_WIDTH + cell.size) * 4;
      expect(Array.from(table.subarray(first, first + 4))).toEqual(
        [cell.u0, cell.v0, cell.u1, cell.v1].map(Math.fround),
      );
      expect(Array.from(table.subarray(second, second + 2))).toEqual(
        [cell.halfWidth, cell.halfHeight].map(Math.fround),
      );
    }
  });

  test("a cell that was never added reads as zero", () => {
    const layout = new AtlasLayout(1);
    layout.add(4, 10);
    const table = layout.table();
    const missing = (4 * 2 * TABLE_WIDTH + 11) * 4;
    expect(Array.from(table.subarray(missing, missing + 4))).toEqual([
      0, 0, 0, 0,
    ]);
  });

  test("adding the same cell twice returns the same cell", () => {
    const layout = new AtlasLayout(1);
    const first = layout.add(4, 10);
    expect(layout.add(4, 10)).toBe(first);
    expect(layout.count).toBe(1);
  });

  test("rejects glyphs and sizes outside the table", () => {
    const layout = new AtlasLayout(1);
    expect(layout.add(-1, 10)).toBeNull();
    expect(layout.add(GLYPH_COUNT, 10)).toBeNull();
    expect(layout.add(0, 0)).toBeNull();
    expect(layout.add(0, SIZE_MAX + 1)).toBeNull();
    expect(layout.add(0, 2.5)).toBeNull();
  });

  test("reports overflow instead of overlapping, and reset frees the room", () => {
    const layout = new AtlasLayout(2, 256);
    let overflowed = false;
    for (let size = 1; size <= SIZE_MAX && !overflowed; size++) {
      for (let glyph = 0; glyph < GLYPH_COUNT; glyph++) {
        if (layout.add(glyph, size) === null) overflowed = true;
      }
    }
    expect(overflowed).toBe(true);
    layout.reset();
    expect(layout.count).toBe(0);
    expect(layout.add(6, 4)).not.toBeNull();
  });

  test("the sizes in use at 200 percent scale fit the texture with room to spare", () => {
    const layout = new AtlasLayout(2);
    const sizes = Array.from({ length: SIZE_MAX }, (_, i) => i + 1).filter(
      (size) => size <= 24,
    );
    for (let glyph = 0; glyph < GLYPH_COUNT; glyph++) {
      for (const size of sizes) {
        expect(layout.add(glyph, size)).not.toBeNull();
      }
    }
  });
});
