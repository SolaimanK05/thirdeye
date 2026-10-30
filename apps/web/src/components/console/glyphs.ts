import type { MarkerGlyph } from "./markers";

export type PathSink = {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number,
  ): void;
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
  ): void;
  rect(x: number, y: number, width: number, height: number): void;
  closePath(): void;
};

export const LINE_WIDTH = 1.5;
export const FLAME_HEIGHT = 1.3;
export const FLAME_IN_RING = 0.62;
export const GLYPH_ORDER: readonly MarkerGlyph[] = [
  "triangle",
  "flame",
  "flame-ring",
  "square",
  "plane",
  "ship",
  "dot",
];
export const GLYPH_COUNT = GLYPH_ORDER.length;
export const SIZE_MAX = 64;
const EXTENT_MARGIN = 1;

export function glyphIndex(glyph: MarkerGlyph): number {
  return GLYPH_ORDER.indexOf(glyph);
}

export function isRotating(glyph: MarkerGlyph): boolean {
  return glyph === "plane" || glyph === "ship";
}

export function trianglePath(
  ctx: PathSink,
  x: number,
  y: number,
  size: number,
) {
  const half = size / 2;
  const height = size * 0.866;
  ctx.moveTo(x, y - height * 0.6);
  ctx.lineTo(x + half, y + height * 0.4);
  ctx.lineTo(x - half, y + height * 0.4);
  ctx.closePath();
}

export function flamePath(ctx: PathSink, x: number, y: number, size: number) {
  const h = size * FLAME_HEIGHT;
  const px = (u: number) => x + u * h;
  const py = (v: number) => y + v * h;
  ctx.moveTo(px(0.04), py(-0.5));
  ctx.bezierCurveTo(px(0.1), py(-0.3), px(0.36), py(-0.12), px(0.32), py(0.16));
  ctx.bezierCurveTo(px(0.3), py(0.38), px(0.16), py(0.5), px(0), py(0.5));
  ctx.bezierCurveTo(
    px(-0.17),
    py(0.5),
    px(-0.32),
    py(0.38),
    px(-0.32),
    py(0.18),
  );
  ctx.bezierCurveTo(
    px(-0.32),
    py(0.02),
    px(-0.22),
    py(-0.08),
    px(-0.14),
    py(-0.18),
  );
  ctx.bezierCurveTo(
    px(-0.12),
    py(-0.08),
    px(-0.08),
    py(-0.02),
    px(-0.03),
    py(0),
  );
  ctx.bezierCurveTo(
    px(-0.06),
    py(-0.22),
    px(-0.04),
    py(-0.38),
    px(0.04),
    py(-0.5),
  );
  ctx.moveTo(px(0), py(0.5));
  ctx.bezierCurveTo(
    px(-0.12),
    py(0.5),
    px(-0.17),
    py(0.38),
    px(-0.1),
    py(0.28),
  );
  ctx.bezierCurveTo(px(-0.05), py(0.2), px(0), py(0.14), px(0), py(0.06));
  ctx.bezierCurveTo(px(0.1), py(0.16), px(0.16), py(0.26), px(0.14), py(0.34));
  ctx.bezierCurveTo(px(0.12), py(0.44), px(0.06), py(0.5), px(0), py(0.5));
}

export function flameRingPath(
  ctx: PathSink,
  x: number,
  y: number,
  size: number,
) {
  const radius = size / 2;
  ctx.moveTo(x + radius, y);
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  flamePath(ctx, x, y, size * FLAME_IN_RING);
}

export function squarePath(ctx: PathSink, x: number, y: number, size: number) {
  ctx.rect(x - size / 2, y - size / 2, size, size);
}

export const PLANE_OUTLINE: readonly (readonly [number, number])[] = [
  [0, -0.5],
  [0.07, -0.3],
  [0.07, -0.1],
  [0.5, 0.12],
  [0.5, 0.22],
  [0.07, 0.12],
  [0.07, 0.32],
  [0.2, 0.42],
  [0.2, 0.5],
  [0, 0.45],
  [-0.2, 0.5],
  [-0.2, 0.42],
  [-0.07, 0.32],
  [-0.07, 0.12],
  [-0.5, 0.22],
  [-0.5, 0.12],
  [-0.07, -0.1],
  [-0.07, -0.3],
];

export function planePath(
  ctx: PathSink,
  x: number,
  y: number,
  size: number,
  rotation: number,
) {
  const angle = (rotation * Math.PI) / 180;
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  PLANE_OUTLINE.forEach(([px, py], index) => {
    const dx = px * size;
    const dy = py * size;
    const sx = x + dx * cos - dy * sin;
    const sy = y + dx * sin + dy * cos;
    if (index === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
  ctx.closePath();
}

export const SHIP_OUTLINE: readonly (readonly [number, number])[] = [
  [0, -0.5],
  [0.2, -0.15],
  [0.2, 0.38],
  [0.12, 0.5],
  [-0.12, 0.5],
  [-0.2, 0.38],
  [-0.2, -0.15],
];

export function shipPath(
  ctx: PathSink,
  x: number,
  y: number,
  size: number,
  rotation: number,
) {
  const angle = (rotation * Math.PI) / 180;
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  SHIP_OUTLINE.forEach(([px, py], index) => {
    const dx = px * size;
    const dy = py * size;
    const sx = x + dx * cos - dy * sin;
    const sy = y + dx * sin + dy * cos;
    if (index === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
  ctx.closePath();
}

export function dotPath(ctx: PathSink, x: number, y: number, size: number) {
  const radius = size / 2;
  ctx.moveTo(x + radius, y);
  ctx.arc(x, y, radius, 0, Math.PI * 2);
}

export function glyphPath(
  ctx: PathSink,
  glyph: MarkerGlyph,
  size: number,
  rotation: number,
  x: number,
  y: number,
) {
  if (glyph === "plane") planePath(ctx, x, y, size, rotation);
  else if (glyph === "ship") shipPath(ctx, x, y, size, rotation);
  else if (glyph === "dot") dotPath(ctx, x, y, size);
  else if (glyph === "flame") flamePath(ctx, x, y, size);
  else if (glyph === "flame-ring") flameRingPath(ctx, x, y, size);
  else if (glyph === "square") squarePath(ctx, x, y, size);
  else trianglePath(ctx, x, y, size);
}

export type GlyphExtent = { halfWidth: number; halfHeight: number };

function outlineRadius(
  outline: readonly (readonly [number, number])[],
): number {
  let radius = 0;
  for (const [x, y] of outline) radius = Math.max(radius, Math.hypot(x, y));
  return radius;
}

const PLANE_RADIUS = outlineRadius(PLANE_OUTLINE);
const SHIP_RADIUS = outlineRadius(SHIP_OUTLINE);
const TRIANGLE_HEIGHT = 0.866;
const TRIANGLE_TOP = 0.6;

export function glyphExtent(glyph: MarkerGlyph, size: number): GlyphExtent {
  const margin = LINE_WIDTH / 2 + EXTENT_MARGIN;
  if (glyph === "plane") {
    const reach = PLANE_RADIUS * size + margin;
    return { halfWidth: reach, halfHeight: reach };
  }
  if (glyph === "ship") {
    const reach = SHIP_RADIUS * size + margin;
    return { halfWidth: reach, halfHeight: reach };
  }
  if (glyph === "flame") {
    const height = size * FLAME_HEIGHT;
    return {
      halfWidth: 0.36 * height + margin,
      halfHeight: 0.5 * height + margin,
    };
  }
  if (glyph === "triangle") {
    return {
      halfWidth: size / 2 + margin,
      halfHeight: size * TRIANGLE_HEIGHT * TRIANGLE_TOP + margin,
    };
  }
  const reach = size / 2 + margin;
  return { halfWidth: reach, halfHeight: reach };
}
