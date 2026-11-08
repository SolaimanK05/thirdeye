/**
 * A latitude and longitude rectangle as the camera reports it. `west` greater
 * than `east` means the box crosses the antimeridian.
 */
export type Box = { west: number; south: number; east: number; north: number };

export function boxWidth(box: Box): number {
  return box.east >= box.west ? box.east - box.west : box.east + 360 - box.west;
}

function wrapLon(lon: number): number {
  if (lon > 180) return lon - 360;
  if (lon < -180) return lon + 360;
  return lon;
}

/** True for a null box, which stands for the whole globe. */
export function boxContains(
  box: Box | null,
  lon: number,
  lat: number,
): boolean {
  if (box === null) return true;
  if (!(lat >= box.south && lat <= box.north)) return false;
  return box.west <= box.east
    ? lon >= box.west && lon <= box.east
    : lon >= box.west || lon <= box.east;
}

/**
 * The box grown by a share of its size on every side, so markers just off the
 * edge are already there while the camera moves. A box that ends up as wide as
 * the globe becomes null (no clipping).
 */
export function padBox(box: Box | null, share: number): Box | null {
  if (box === null) return null;
  const width = boxWidth(box);
  const height = box.north - box.south;
  if (width * (1 + 2 * share) >= 360) return null;
  return {
    west: wrapLon(box.west - width * share),
    east: wrapLon(box.east + width * share),
    south: Math.max(-90, box.south - height * share),
    north: Math.min(90, box.north + height * share),
  };
}

export function sameBox(a: Box | null, b: Box | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.west === b.west &&
    a.south === b.south &&
    a.east === b.east &&
    a.north === b.north
  );
}
