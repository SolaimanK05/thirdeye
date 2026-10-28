import type { Marker, MarkerSizing } from "@/components/console/markers";
import { POSITION_STRIDE } from "./propagator";

export const SATELLITE_MAX_SIZE = 8;
export const SATELLITE_MIN_SIZE = 3;
export const FULL_SIZE_AT = 60;
export const MIN_SIZE_AT = 6000;
export const SATELLITE_MAX_ZOOM_PERCENT = 300;
export const UNNAMED = "Unnamed satellite";

export function satelliteSizing(inView: number): MarkerSizing {
  const span = Math.log(MIN_SIZE_AT / FULL_SIZE_AT);
  const progress = Math.log(Math.max(inView, 1) / FULL_SIZE_AT) / span;
  const share = Math.min(1, Math.max(0, progress));
  return {
    glyph: "dot",
    size: Math.round(
      SATELLITE_MAX_SIZE - share * (SATELLITE_MAX_SIZE - SATELLITE_MIN_SIZE),
    ),
  };
}

export type Placement = {
  markers: Marker[];
  order: Int32Array | null;
};

export function satelliteMarkers(
  ids: readonly string[],
  names: ReadonlyMap<string, string>,
  positions: Float64Array,
  starred: ReadonlySet<string>,
  only: ReadonlySet<string> | null,
): Placement {
  const markers: Marker[] = [];
  const order: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const isStarred = starred.has(id);
    if (only !== null && !only.has(id)) continue;
    const at = i * POSITION_STRIDE;
    markers.push({
      id,
      lon: positions[at],
      lat: positions[at + 1],
      glyph: "dot",
      size: SATELLITE_MAX_SIZE,
      tone: isStarred ? "accent" : "default",
      label: names.get(id) ?? UNNAMED,
      entity: true,
      adaptive: true,
      persistentLabel: isStarred,
    });
    order.push(i);
  }
  return {
    markers,
    order: markers.length === ids.length ? null : Int32Array.from(order),
  };
}

export function compact(
  positions: Float64Array,
  order: Int32Array,
  into: Float64Array,
): Float64Array {
  const size = order.length * POSITION_STRIDE;
  const target = into.length >= size ? into : new Float64Array(size);
  for (let i = 0; i < order.length; i++) {
    const from = order[i] * POSITION_STRIDE;
    const to = i * POSITION_STRIDE;
    target[to] = positions[from];
    target[to + 1] = positions[from + 1];
    target[to + 2] = positions[from + 2];
    target[to + 3] = positions[from + 3];
  }
  return target;
}
