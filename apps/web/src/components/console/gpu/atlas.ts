import {
  GLYPH_COUNT,
  GLYPH_ORDER,
  glyphExtent,
  glyphPath,
  LINE_WIDTH,
  SIZE_MAX,
} from "../glyphs";

export const ATLAS_SIZE = 2048;
export const CELL_PAD = 8;
export const SUPERSAMPLE = 2;
export const TABLE_WIDTH = SIZE_MAX + 1;
export const TABLE_HEIGHT = GLYPH_COUNT * 2;
export const MIP_LEVELS = 4;
const SHELF_GROWTH = 1.3;

export type Cell = {
  glyph: number;
  size: number;
  x: number;
  y: number;
  width: number;
  height: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  halfWidth: number;
  halfHeight: number;
};

type Shelf = { y: number; height: number; cursor: number };

function cellKey(glyph: number, size: number): number {
  return glyph * TABLE_WIDTH + size;
}

export class AtlasLayout {
  readonly scale: number;
  readonly textureSize: number;
  private readonly known = new Map<number, Cell>();
  private shelves: Shelf[] = [];
  private nextShelfY = 0;

  constructor(ratio: number, textureSize = ATLAS_SIZE) {
    this.scale = ratio * SUPERSAMPLE;
    this.textureSize = textureSize;
  }

  get count(): number {
    return this.known.size;
  }

  has(glyph: number, size: number): boolean {
    return this.known.has(cellKey(glyph, size));
  }

  get(glyph: number, size: number): Cell | undefined {
    return this.known.get(cellKey(glyph, size));
  }

  cells(): readonly Cell[] {
    return [...this.known.values()];
  }

  reset(): void {
    this.known.clear();
    this.shelves = [];
    this.nextShelfY = 0;
  }

  add(glyph: number, size: number): Cell | null {
    const existing = this.get(glyph, size);
    if (existing) return existing;
    if (
      !Number.isInteger(glyph) ||
      glyph < 0 ||
      glyph >= GLYPH_COUNT ||
      !Number.isInteger(size) ||
      size < 1 ||
      size > SIZE_MAX
    ) {
      return null;
    }
    const extent = glyphExtent(GLYPH_ORDER[glyph], size);
    const width = Math.ceil(2 * extent.halfWidth * this.scale);
    const height = Math.ceil(2 * extent.halfHeight * this.scale);
    const slotWidth = width + CELL_PAD * 2;
    const slotHeight = height + CELL_PAD * 2;
    if (slotWidth > this.textureSize) return null;
    const placed = this.place(slotWidth, slotHeight);
    if (!placed) return null;
    const left = placed.x + CELL_PAD;
    const top = placed.y + CELL_PAD;
    const cell: Cell = {
      glyph,
      size,
      x: left,
      y: top,
      width,
      height,
      u0: left / this.textureSize,
      v0: top / this.textureSize,
      u1: (left + width) / this.textureSize,
      v1: (top + height) / this.textureSize,
      halfWidth: width / (2 * this.scale),
      halfHeight: height / (2 * this.scale),
    };
    this.known.set(cellKey(glyph, size), cell);
    return cell;
  }

  table(): Float32Array {
    const out = new Float32Array(TABLE_WIDTH * TABLE_HEIGHT * 4);
    for (const cell of this.known.values()) {
      const first = (cell.glyph * 2 * TABLE_WIDTH + cell.size) * 4;
      const second = first + TABLE_WIDTH * 4;
      out[first] = cell.u0;
      out[first + 1] = cell.v0;
      out[first + 2] = cell.u1;
      out[first + 3] = cell.v1;
      out[second] = cell.halfWidth;
      out[second + 1] = cell.halfHeight;
    }
    return out;
  }

  private place(
    width: number,
    height: number,
  ): { x: number; y: number } | null {
    let best: Shelf | null = null;
    for (const shelf of this.shelves) {
      if (
        shelf.height >= height &&
        shelf.height <= height * 2 &&
        shelf.cursor + width <= this.textureSize &&
        (best === null || shelf.height < best.height)
      ) {
        best = shelf;
      }
    }
    if (best) {
      const x = best.cursor;
      best.cursor += width;
      return { x, y: best.y };
    }
    if (this.nextShelfY + height > this.textureSize) return null;
    const room = this.textureSize - this.nextShelfY;
    const shelf: Shelf = {
      y: this.nextShelfY,
      height: Math.min(room, Math.ceil(height * SHELF_GROWTH)),
      cursor: width,
    };
    this.shelves.push(shelf);
    this.nextShelfY += shelf.height;
    return { x: 0, y: shelf.y };
  }
}

export function rasteriseCell(
  cell: Cell,
  scale: number,
  create: () => HTMLCanvasElement = () => document.createElement("canvas"),
): HTMLCanvasElement | null {
  const canvas = create();
  canvas.width = cell.width + CELL_PAD * 2;
  canvas.height = cell.height + CELL_PAD * 2;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.setTransform(
    scale,
    0,
    0,
    scale,
    CELL_PAD + cell.width / 2,
    CELL_PAD + cell.height / 2,
  );
  context.strokeStyle = "white";
  context.lineWidth = LINE_WIDTH;
  context.lineJoin = "round";
  context.beginPath();
  glyphPath(context, GLYPH_ORDER[cell.glyph], cell.size, 0, 0, 0);
  context.stroke();
  return canvas;
}
