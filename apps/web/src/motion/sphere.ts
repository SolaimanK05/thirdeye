export const EARTH_RADIUS_M = 6_371_008.8;
export const METRES_PER_KNOT = 1852 / 3600;

const DEG = Math.PI / 180;
const TINY_ANGLE = 1e-9;

export type Vec3 = [number, number, number];

export function normaliseLon(lon: number): number {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 && lon > 0 ? 180 : wrapped;
}

export function normaliseDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

export function signedDelta(from: number, to: number): number {
  const turn = normaliseDegrees(to - from);
  return turn > 180 ? turn - 360 : turn;
}

export function toVector(lon: number, lat: number, out: Vec3): Vec3 {
  const phi = lat * DEG;
  const lambda = lon * DEG;
  const cosPhi = Math.cos(phi);
  out[0] = cosPhi * Math.cos(lambda);
  out[1] = cosPhi * Math.sin(lambda);
  out[2] = Math.sin(phi);
  return out;
}

export function lonOf(v: Vec3): number {
  return Math.atan2(v[1], v[0]) / DEG;
}

export function latOf(v: Vec3): number {
  return Math.atan2(v[2], Math.hypot(v[0], v[1])) / DEG;
}

export function angleBetween(a: Vec3, b: Vec3): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = Math.hypot(
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  );
  return Math.atan2(cross, dot);
}

export function slerp(a: Vec3, b: Vec3, fraction: number, out: Vec3): Vec3 {
  const omega = angleBetween(a, b);
  let wa: number;
  let wb: number;
  if (omega < TINY_ANGLE) {
    wa = 1 - fraction;
    wb = fraction;
  } else {
    const sin = Math.sin(omega);
    wa = Math.sin((1 - fraction) * omega) / sin;
    wb = Math.sin(fraction * omega) / sin;
  }
  const x = wa * a[0] + wb * b[0];
  const y = wa * a[1] + wb * b[1];
  const z = wa * a[2] + wb * b[2];
  const length = Math.hypot(x, y, z) || 1;
  out[0] = x / length;
  out[1] = y / length;
  out[2] = z / length;
  return out;
}

export function distanceMetres(
  lonA: number,
  latA: number,
  lonB: number,
  latB: number,
): number {
  const phiA = latA * DEG;
  const phiB = latB * DEG;
  const dPhi = phiB - phiA;
  const dLambda = (lonB - lonA) * DEG;
  const h =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phiA) * Math.cos(phiB) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDegrees(
  lonA: number,
  latA: number,
  lonB: number,
  latB: number,
): number {
  const phiA = latA * DEG;
  const phiB = latB * DEG;
  const dLambda = (lonB - lonA) * DEG;
  const y = Math.sin(dLambda) * Math.cos(phiB);
  const x =
    Math.cos(phiA) * Math.sin(phiB) -
    Math.sin(phiA) * Math.cos(phiB) * Math.cos(dLambda);
  return normaliseDegrees(Math.atan2(y, x) / DEG);
}

export function destination(
  lon: number,
  lat: number,
  bearing: number,
  metres: number,
  out: { lon: number; lat: number },
): { lon: number; lat: number } {
  const delta = metres / EARTH_RADIUS_M;
  const theta = bearing * DEG;
  const phi = lat * DEG;
  const sinPhi2 =
    Math.sin(phi) * Math.cos(delta) +
    Math.cos(phi) * Math.sin(delta) * Math.cos(theta);
  const phi2 = Math.asin(Math.max(-1, Math.min(1, sinPhi2)));
  const lambda2 =
    lon * DEG +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi),
      Math.cos(delta) - Math.sin(phi) * sinPhi2,
    );
  out.lon = normaliseLon(lambda2 / DEG);
  out.lat = phi2 / DEG;
  return out;
}
