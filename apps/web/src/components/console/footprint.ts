const RADIANS = Math.PI / 180;
const DEGREES = 180 / Math.PI;
export const EARTH_RADIUS_KM = 6371;
export const RING_POINTS = 72;

/**
 * The circle of points `radiusKm` along the ground from a centre, as
 * longitude and latitude in degrees (`out` holds `count` pairs). The circle is
 * on a sphere, which is exact enough for a ring drawn on screen.
 */
export function ringPoints(
  lon: number,
  lat: number,
  radiusKm: number,
  count: number,
  out: Float64Array,
): Float64Array {
  const lon0 = lon * RADIANS;
  const lat0 = lat * RADIANS;
  const angle = Math.min(Math.PI, radiusKm / EARTH_RADIUS_KM);
  const sinLat0 = Math.sin(lat0);
  const cosLat0 = Math.cos(lat0);
  const sinAngle = Math.sin(angle);
  const cosAngle = Math.cos(angle);
  for (let i = 0; i < count; i++) {
    const bearing = (i / count) * 2 * Math.PI;
    const sinLat = sinLat0 * cosAngle + cosLat0 * sinAngle * Math.cos(bearing);
    const pointLat = Math.asin(Math.max(-1, Math.min(1, sinLat)));
    const pointLon =
      lon0 +
      Math.atan2(
        Math.sin(bearing) * sinAngle * cosLat0,
        cosAngle - sinLat0 * sinLat,
      );
    out[i * 2] = ((((pointLon * DEGREES + 180) % 360) + 360) % 360) - 180;
    out[i * 2 + 1] = pointLat * DEGREES;
  }
  return out;
}

/** Great-circle distance between two points, in kilometres. */
export function distanceKm(
  lonA: number,
  latA: number,
  lonB: number,
  latB: number,
): number {
  const dLat = (latB - latA) * RADIANS;
  const dLon = (lonB - lonA) * RADIANS;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(latA * RADIANS) *
      Math.cos(latB * RADIANS) *
      Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}
