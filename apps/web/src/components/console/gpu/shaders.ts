import { HIT_RADIUS_PX } from "../markers";

const HIT = HIT_RADIUS_PX.toFixed(1);

export const VERTEX_SOURCE = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec3 a_high;
layout(location = 2) in vec3 a_low;
layout(location = 3) in float a_rotation;
layout(location = 4) in uvec4 a_style;
layout(location = 5) in vec3 a_delta;
layout(location = 6) in vec2 a_times;
layout(location = 7) in vec2 a_headings;

uniform mat4 u_viewProjectionRte;
uniform vec3 u_eyeHigh;
uniform vec3 u_eyeLow;
uniform vec3 u_eyeScaled;
uniform vec3 u_inverseRadii;
uniform vec2 u_viewport;
uniform ivec2 u_sized;
uniform sampler2D u_cells;
uniform vec4 u_tones[3];
uniform int u_pick;
uniform int u_layerIndex;
uniform int u_layerStale;
uniform float u_staleAlpha;
uniform int u_moving;
uniform float u_now;

out vec2 v_uv;
out vec2 v_local;
flat out vec4 v_colour;
flat out float v_alpha;
flat out uint v_id;

void main() {
  vec3 base = a_high + a_low;
  vec3 shift = vec3(0.0);
  float rotation = a_rotation;
  if (u_moving == 1) {
    float span = a_times.y - a_times.x;
    float fraction = span > 0.0 ? clamp((u_now - a_times.x) / span, 0.0, 1.0) : 0.0;
    vec3 up = normalize(base);
    vec3 across = cross(a_delta, up);
    float sag = fraction * (1.0 - fraction) * dot(across, across) / (2.0 * length(base));
    shift = a_delta * fraction + up * sag;
    float turn = a_headings.y - a_headings.x;
    turn -= 6.283185307179586 * floor(turn / 6.283185307179586 + 0.5);
    rotation = a_headings.x + turn * fraction;
  }
  vec3 relative = (a_high - u_eyeHigh) + (a_low - u_eyeLow) + shift;
  vec3 world = base + shift;
  vec4 clip = u_viewProjectionRte * vec4(relative, 1.0);
  bool culled = dot(world * u_inverseRadii, u_eyeScaled) <= 1.0
    || clip.z < 0.0
    || clip.w <= 0.0
    || (a_style.w & 4u) != 0u;

  int glyph = int(a_style.x);
  int size = int(a_style.y);
  if ((a_style.w & 2u) != 0u && u_sized.x >= 0) {
    glyph = u_sized.x;
    size = u_sized.y;
  }

  vec4 rect = texelFetch(u_cells, ivec2(size, 2 * glyph), 0);
  vec2 extent = texelFetch(u_cells, ivec2(size, 2 * glyph + 1), 0).xy;
  bool known = extent.x > 0.0;

  vec2 offset = a_corner * extent;
  if (glyph == 4 || glyph == 5) {
    float c = cos(rotation);
    float s = sin(rotation);
    offset = vec2(offset.x * c - offset.y * s, offset.x * s + offset.y * c);
  }
  if (u_pick == 1) {
    offset = a_corner * ${HIT};
  }

  bool faded = (a_style.w & 1u) != 0u || u_layerStale == 1;
  v_alpha = (culled || (u_pick == 0 && !known)) ? 0.0 : (faded ? u_staleAlpha : 1.0);
  v_local = offset;
  v_uv = mix(rect.xy, rect.zw, a_corner * 0.5 + 0.5);
  v_colour = u_tones[min(int(a_style.z), 2)];
  v_id = (uint(u_layerIndex + 1) << 24) | uint(gl_InstanceID);

  if (v_alpha == 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  } else {
    vec2 centre = clip.xy / clip.w;
    gl_Position = vec4(centre + vec2(offset.x, -offset.y) * 2.0 / u_viewport, 0.0, 1.0);
  }
}
`;

export const DRAW_FRAGMENT_SOURCE = `#version 300 es
precision highp float;

uniform sampler2D u_atlas;

in vec2 v_uv;
flat in vec4 v_colour;
flat in float v_alpha;

out vec4 o_colour;

void main() {
  float coverage = texture(u_atlas, v_uv).a * v_alpha;
  if (coverage <= 0.0) {
    discard;
  }
  o_colour = v_colour * coverage;
}
`;

export const PICK_FRAGMENT_SOURCE = `#version 300 es
precision highp float;
precision highp int;

in vec2 v_local;
flat in float v_alpha;
flat in uint v_id;

layout(location = 0) out uvec4 o_id;

void main() {
  float distance = length(v_local);
  if (v_alpha == 0.0 || distance > ${HIT}) {
    discard;
  }
  o_id = uvec4(v_id, 0u, 0u, 0u);
  gl_FragDepth = distance / (${HIT} * 2.0);
}
`;

export const QUAD_CORNERS_DATA = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
