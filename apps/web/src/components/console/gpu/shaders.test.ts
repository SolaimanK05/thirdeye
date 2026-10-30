import { describe, expect, test } from "vitest";
import { HIT_RADIUS_PX } from "../markers";
import {
  DRAW_FRAGMENT_SOURCE,
  PICK_FRAGMENT_SOURCE,
  QUAD_CORNERS_DATA,
  VERTEX_SOURCE,
} from "./shaders";

const SOURCES = {
  vertex: VERTEX_SOURCE,
  draw: DRAW_FRAGMENT_SOURCE,
  pick: PICK_FRAGMENT_SOURCE,
};

describe("shader sources", () => {
  test.each(Object.entries(SOURCES))(
    "%s starts with the ES 3.00 version line",
    (_name, source) => {
      expect(source.startsWith("#version 300 es\n")).toBe(true);
    },
  );

  test.each(Object.entries(SOURCES))(
    "%s has no preprocessor defines and no comments",
    (_name, source) => {
      expect(source).not.toContain("#define");
      expect(source).not.toContain("//");
      expect(source).not.toContain("/*");
    },
  );

  test("the hit radius comes from markers.ts into both programs", () => {
    const radius = HIT_RADIUS_PX.toFixed(1);
    expect(VERTEX_SOURCE).toContain(`a_corner * ${radius}`);
    expect(PICK_FRAGMENT_SOURCE).toContain(`distance > ${radius}`);
    expect(PICK_FRAGMENT_SOURCE).toContain(`${radius} * 2.0`);
  });

  test("attribute locations match the vertex array setup", () => {
    expect(VERTEX_SOURCE).toContain("layout(location = 0) in vec2 a_corner;");
    expect(VERTEX_SOURCE).toContain("layout(location = 1) in vec3 a_high;");
    expect(VERTEX_SOURCE).toContain("layout(location = 2) in vec3 a_low;");
    expect(VERTEX_SOURCE).toContain(
      "layout(location = 3) in float a_rotation;",
    );
    expect(VERTEX_SOURCE).toContain("layout(location = 4) in uvec4 a_style;");
  });

  test("the pick program writes an unsigned id and a depth, the draw program a premultiplied colour", () => {
    expect(PICK_FRAGMENT_SOURCE).toContain("out uvec4 o_id");
    expect(PICK_FRAGMENT_SOURCE).toContain("gl_FragDepth");
    expect(DRAW_FRAGMENT_SOURCE).toContain("out vec4 o_colour");
    expect(DRAW_FRAGMENT_SOURCE).toContain("v_colour * coverage");
  });

  test("culling follows the CPU rules", () => {
    expect(VERTEX_SOURCE).toContain(
      "dot(world * u_inverseRadii, u_eyeScaled) <= 1.0",
    );
    expect(VERTEX_SOURCE).toContain("clip.z < 0.0");
    expect(VERTEX_SOURCE).toContain("clip.w <= 0.0");
  });

  test("the quad is a four-vertex strip", () => {
    expect(Array.from(QUAD_CORNERS_DATA)).toEqual([-1, -1, 1, -1, -1, 1, 1, 1]);
  });
});
