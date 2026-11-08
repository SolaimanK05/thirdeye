import { WGS84_RADII } from "./encode";

const INVERSE_X = 1 / WGS84_RADII[0];
const INVERSE_Y = 1 / WGS84_RADII[1];
const INVERSE_Z = 1 / WGS84_RADII[2];

export function behindHorizonPlane(
  x: number,
  y: number,
  z: number,
  eyeScaled: ArrayLike<number>,
): boolean {
  return (
    x * INVERSE_X * eyeScaled[0] +
      y * INVERSE_Y * eyeScaled[1] +
      z * INVERSE_Z * eyeScaled[2] <=
    1
  );
}

export function occludedByGlobe(
  x: number,
  y: number,
  z: number,
  eyeScaled: ArrayLike<number>,
): boolean {
  const qx = x * INVERSE_X;
  const qy = y * INVERSE_Y;
  const qz = z * INVERSE_Z;
  const ex = eyeScaled[0];
  const ey = eyeScaled[1];
  const ez = eyeScaled[2];
  const along = qx * ex + qy * ey + qz * ez;
  if (along > 1) return false;
  const eyeSquared = ex * ex + ey * ey + ez * ez;
  const horizonSquared = eyeSquared - 1;
  if (horizonSquared <= 0) return false;
  const dx = qx - ex;
  const dy = qy - ey;
  const dz = qz - ez;
  const towards = eyeSquared - along;
  return towards * towards > horizonSquared * (dx * dx + dy * dy + dz * dz);
}
