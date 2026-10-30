import { HIT_RADIUS_PX } from "../markers";
import {
  FLAG_ADAPTIVE,
  FLAG_FADED,
  type UnpackedInstance,
  type UnpackedMovingInstance,
} from "./encode";
import { type FrameUniforms, STALE_ALPHA } from "./frame";
import { wrapAngle } from "./segment-math";

const f = Math.fround;

export type Sized = { glyph: number; size: number };

export type VertexCentre = {
  culled: boolean;
  x: number;
  y: number;
  clipZ: number;
  clipW: number;
  glyph: number;
  size: number;
  alpha: number;
  tone: number;
};

export type Shift = [number, number, number];

export const NO_SHIFT: Shift = [0, 0, 0];

export type MotionState = { shift: Shift; rotation: number };

export function motionAt(
  instance: UnpackedMovingInstance,
  now: number,
): MotionState {
  const span = f(instance.endTime - instance.startTime);
  const fraction =
    span > 0
      ? Math.min(1, Math.max(0, f(f(now - instance.startTime) / span)))
      : 0;
  const base = [0, 1, 2].map((axis) =>
    f(instance.high[axis] + instance.low[axis]),
  );
  const length = f(Math.hypot(base[0], base[1], base[2]));
  const up = base.map((value) => f(value / length));
  const [dx, dy, dz] = instance.delta;
  const cx = f(f(dy * up[2]) - f(dz * up[1]));
  const cy = f(f(dz * up[0]) - f(dx * up[2]));
  const cz = f(f(dx * up[1]) - f(dy * up[0]));
  const across = f(f(f(cx * cx) + f(cy * cy)) + f(cz * cz));
  const sag = f(f(f(fraction * f(1 - fraction)) * across) / f(2 * length));
  const shift: Shift = [
    f(f(dx * fraction) + f(up[0] * sag)),
    f(f(dy * fraction) + f(up[1] * sag)),
    f(f(dz * fraction) + f(up[2] * sag)),
  ];
  const turn = wrapAngle(f(instance.endHeading - instance.startHeading));
  return {
    shift,
    rotation: f(instance.startHeading + f(turn * fraction)),
  };
}

export function relativeToEye(
  instance: UnpackedInstance,
  frame: FrameUniforms,
  shift: Shift = NO_SHIFT,
): [number, number, number] {
  return [
    f(
      f(
        f(instance.high[0] - frame.eyeHigh[0]) +
          f(instance.low[0] - frame.eyeLow[0]),
      ) + shift[0],
    ),
    f(
      f(
        f(instance.high[1] - frame.eyeHigh[1]) +
          f(instance.low[1] - frame.eyeLow[1]),
      ) + shift[1],
    ),
    f(
      f(
        f(instance.high[2] - frame.eyeHigh[2]) +
          f(instance.low[2] - frame.eyeLow[2]),
      ) + shift[2],
    ),
  ];
}

export function beyondHorizon(
  instance: UnpackedInstance,
  frame: FrameUniforms,
  shift: Shift = NO_SHIFT,
): boolean {
  let dot = 0;
  for (let axis = 0; axis < 3; axis++) {
    const world = f(f(instance.high[axis] + instance.low[axis]) + shift[axis]);
    dot += f(world * frame.inverseRadii[axis]) * frame.eyeScaled[axis];
  }
  return dot <= 1;
}

export function resolveStyle(
  instance: UnpackedInstance,
  sized: Sized | null,
): Sized {
  if (sized && sized.glyph >= 0 && instance.flags & FLAG_ADAPTIVE) {
    return sized;
  }
  return { glyph: instance.glyph, size: instance.size };
}

export function vertexCentre(
  instance: UnpackedInstance,
  frame: FrameUniforms,
  options: {
    sized: Sized | null;
    layerStale: boolean;
    shift?: Shift;
  },
): VertexCentre {
  const style = resolveStyle(instance, options.sized);
  const centre: VertexCentre = {
    culled: true,
    x: 0,
    y: 0,
    clipZ: 0,
    clipW: 0,
    glyph: style.glyph,
    size: style.size,
    alpha: 0,
    tone: instance.tone,
  };
  const shift = options.shift ?? NO_SHIFT;
  if (beyondHorizon(instance, frame, shift)) return centre;
  const [rx, ry, rz] = relativeToEye(instance, frame, shift);
  const m = frame.viewProjectionRte;
  const clipX = m[0] * rx + m[4] * ry + m[8] * rz + m[12];
  const clipY = m[1] * rx + m[5] * ry + m[9] * rz + m[13];
  const clipZ = m[2] * rx + m[6] * ry + m[10] * rz + m[14];
  const clipW = m[3] * rx + m[7] * ry + m[11] * rz + m[15];
  centre.clipZ = clipZ;
  centre.clipW = clipW;
  if (clipZ < 0 || clipW <= 0) return centre;
  const ndcX = clipX / clipW;
  const ndcY = clipY / clipW;
  centre.culled = false;
  centre.x = (ndcX * 0.5 + 0.5) * frame.width;
  centre.y = (0.5 - ndcY * 0.5) * frame.height;
  centre.alpha =
    instance.flags & FLAG_FADED || options.layerStale ? STALE_ALPHA : 1;
  return centre;
}

export function rotateOffset(
  dx: number,
  dy: number,
  radians: number,
): [number, number] {
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  return [dx * cos - dy * sin, dx * sin + dy * cos];
}

export type Corner = readonly [number, number];

export const QUAD_CORNERS: readonly Corner[] = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

export function quadPosition(
  centre: VertexCentre,
  corner: Corner,
  extent: { halfWidth: number; halfHeight: number },
  rotating: boolean,
  radians: number,
  pick: boolean,
): { x: number; y: number } {
  let dx = pick ? corner[0] * HIT_RADIUS_PX : corner[0] * extent.halfWidth;
  let dy = pick ? corner[1] * HIT_RADIUS_PX : corner[1] * extent.halfHeight;
  if (rotating && !pick) [dx, dy] = rotateOffset(dx, dy, radians);
  return { x: centre.x + dx, y: centre.y + dy };
}
