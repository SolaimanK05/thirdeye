export const DAY_MS = 24 * 60 * 60 * 1000;

export type TrailFix = { t: number; lon: number; lat: number };
export type LonLat = readonly [lon: number, lat: number];

type FixLike = { t: string; position: { lon: number; lat: number } };

/** Fixes from the API as a time-sorted trail; rows with a bad time or position are dropped. */
export function toTrail(fixes: readonly FixLike[]): TrailFix[] {
  const trail: TrailFix[] = [];
  for (const fix of fixes) {
    const t = Date.parse(fix.t);
    const { lon, lat } = fix.position;
    if (Number.isFinite(t) && Number.isFinite(lon) && Number.isFinite(lat)) {
      trail.push({ t, lon, lat });
    }
  }
  return trail.sort((a, b) => a.t - b.t);
}

/** Cut a trail wherever it crosses the antimeridian, so no line is drawn across the map. */
export function splitAtAntimeridian(
  points: readonly { lon: number; lat: number }[],
): LonLat[][] {
  const segments: LonLat[][] = [];
  let current: LonLat[] = [];
  let previous: number | null = null;
  for (const { lon, lat } of points) {
    if (previous !== null && Math.abs(lon - previous) > 180) {
      if (current.length > 1) segments.push(current);
      current = [];
    }
    current.push([lon, lat]);
    previous = lon;
  }
  if (current.length > 1) segments.push(current);
  return segments;
}

/** Longitude of `to` unwrapped to sit within 180 degrees of `from`. */
function nearestLon(from: number, to: number): number {
  let lon = to;
  while (lon - from > 180) lon -= 360;
  while (lon - from < -180) lon += 360;
  return lon;
}

function wrapLon(lon: number): number {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 && lon > 0 ? 180 : wrapped;
}

/** Where the mover was at time `t`: null before its first fix, its last fix after it. */
export function positionAt(
  trail: readonly TrailFix[],
  t: number,
): { lon: number; lat: number } | null {
  const first = trail[0];
  const last = trail.at(-1);
  if (!first || !last || t < first.t) return null;
  if (t >= last.t) return { lon: last.lon, lat: last.lat };
  let low = 0;
  let high = trail.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (trail[mid].t <= t) low = mid;
    else high = mid;
  }
  const a = trail[low];
  const b = trail[high];
  const span = b.t - a.t;
  const share = span > 0 ? (t - a.t) / span : 0;
  const lonB = nearestLon(a.lon, b.lon);
  return {
    lon: wrapLon(a.lon + (lonB - a.lon) * share),
    lat: a.lat + (b.lat - a.lat) * share,
  };
}

/** The part of the trail up to time `t`, ending exactly at the position at `t`. */
export function trailUpTo(
  trail: readonly TrailFix[],
  t: number,
): { lon: number; lat: number }[] {
  const end = positionAt(trail, t);
  if (!end) return [];
  const points: { lon: number; lat: number }[] = trail.filter(
    (fix) => fix.t <= t,
  );
  const last = points.at(-1);
  if (!last || last.lon !== end.lon || last.lat !== end.lat) points.push(end);
  return points;
}
