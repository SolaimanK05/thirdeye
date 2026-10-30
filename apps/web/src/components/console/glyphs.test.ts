import { describe, expect, test } from "vitest";
import {
  GLYPH_COUNT,
  GLYPH_ORDER,
  glyphExtent,
  glyphIndex,
  glyphPath,
  isRotating,
  LINE_WIDTH,
  type PathSink,
} from "./glyphs";
import type { MarkerGlyph } from "./markers";

type Recording = {
  calls: Record<string, number>;
  points: [number, number][];
};

function recorder(): { sink: PathSink; recording: Recording } {
  const recording: Recording = { calls: {}, points: [] };
  const count = (name: string) => {
    recording.calls[name] = (recording.calls[name] ?? 0) + 1;
  };
  const sink: PathSink = {
    moveTo(x, y) {
      count("moveTo");
      recording.points.push([x, y]);
    },
    lineTo(x, y) {
      count("lineTo");
      recording.points.push([x, y]);
    },
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
      count("bezierCurveTo");
      recording.points.push([c1x, c1y], [c2x, c2y], [x, y]);
    },
    arc(x, y, radius) {
      count("arc");
      recording.points.push([x + radius, y], [x - radius, y]);
      recording.points.push([x, y + radius], [x, y - radius]);
    },
    rect(x, y, width, height) {
      count("rect");
      recording.points.push([x, y], [x + width, y + height]);
    },
    closePath() {
      count("closePath");
    },
  };
  return { sink, recording };
}

function draw(glyph: MarkerGlyph, size: number, rotation = 0): Recording {
  const { sink, recording } = recorder();
  glyphPath(sink, glyph, size, rotation, 0, 0);
  return recording;
}

describe("glyph order", () => {
  test("the atlas and the shader agree on the index of every glyph", () => {
    expect(GLYPH_ORDER).toEqual([
      "triangle",
      "flame",
      "flame-ring",
      "square",
      "plane",
      "ship",
      "dot",
    ]);
    expect(GLYPH_COUNT).toBe(7);
    expect(glyphIndex("triangle")).toBe(0);
    expect(glyphIndex("dot")).toBe(6);
  });

  test("only planes and ships turn", () => {
    expect(GLYPH_ORDER.filter(isRotating)).toEqual(["plane", "ship"]);
  });
});

describe("path calls", () => {
  test("plane is one closed polygon of 18 points", () => {
    expect(draw("plane", 20).calls).toEqual({
      moveTo: 1,
      lineTo: 17,
      closePath: 1,
    });
  });

  test("ship is one closed polygon of 7 points", () => {
    expect(draw("ship", 20).calls).toEqual({
      moveTo: 1,
      lineTo: 6,
      closePath: 1,
    });
  });

  test("dot is one arc", () => {
    expect(draw("dot", 6).calls).toEqual({ moveTo: 1, arc: 1 });
  });

  test("square is one rect", () => {
    expect(draw("square", 8).calls).toEqual({ rect: 1 });
  });

  test("triangle is three points and a close", () => {
    expect(draw("triangle", 10).calls).toEqual({
      moveTo: 1,
      lineTo: 2,
      closePath: 1,
    });
  });

  test("flame is two curves, the ring adds a circle around a smaller flame", () => {
    expect(draw("flame", 12).calls).toEqual({
      moveTo: 2,
      bezierCurveTo: 10,
    });
    expect(draw("flame-ring", 12).calls).toEqual({
      moveTo: 3,
      arc: 1,
      bezierCurveTo: 10,
    });
  });
});

describe("rotation convention", () => {
  test("a plane turned 90 degrees points its nose to the right on screen", () => {
    const up = draw("plane", 20, 0).points[0];
    const right = draw("plane", 20, 90).points[0];
    expect(up[0]).toBeCloseTo(0, 9);
    expect(up[1]).toBeCloseTo(-10, 9);
    expect(right[0]).toBeCloseTo(10, 9);
    expect(right[1]).toBeCloseTo(0, 9);
  });
});

describe("extent", () => {
  const sizes = [1, 3, 6, 10, 22, 40, 64];

  test.each(GLYPH_ORDER)(
    "%s extent holds every point at every angle",
    (glyph) => {
      for (const size of sizes) {
        const extent = glyphExtent(glyph, size);
        const angles = isRotating(glyph) ? [0, 17, 45, 90, 133, 200, 311] : [0];
        for (const angle of angles) {
          for (const [x, y] of draw(glyph, size, angle).points) {
            expect(Math.abs(x)).toBeLessThanOrEqual(
              extent.halfWidth - LINE_WIDTH / 2 + 1e-9,
            );
            expect(Math.abs(y)).toBeLessThanOrEqual(
              extent.halfHeight - LINE_WIDTH / 2 + 1e-9,
            );
          }
        }
      }
    },
  );

  test("extent includes half the stroke and a 1 px margin", () => {
    expect(glyphExtent("dot", 10)).toEqual({
      halfWidth: 5 + LINE_WIDTH / 2 + 1,
      halfHeight: 5 + LINE_WIDTH / 2 + 1,
    });
  });

  test("rotating glyphs use a square extent so a turn never clips", () => {
    for (const glyph of ["plane", "ship"] as const) {
      const extent = glyphExtent(glyph, 20);
      expect(extent.halfWidth).toBe(extent.halfHeight);
    }
  });

  test("extent grows with size", () => {
    for (const glyph of GLYPH_ORDER) {
      expect(glyphExtent(glyph, 20).halfWidth).toBeGreaterThan(
        glyphExtent(glyph, 10).halfWidth,
      );
    }
  });
});
