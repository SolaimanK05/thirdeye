import { EARTH_RADIUS_KM } from "@/components/console/footprint";
import type {
  FootprintRing,
  Marker,
  MarkerSizing,
} from "@/components/console/markers";
import { type DrawLimit, selectTop } from "../draw-limit";
import { type Box, boxContains } from "../geo-box";
import { POSITION_ALTITUDE_KM, POSITION_STRIDE } from "./propagator";

export const SATELLITE_MAX_SIZE = 8;
export const SATELLITE_MIN_SIZE = 3;
export const FULL_SIZE_AT = 60;
export const MIN_SIZE_AT = 6000;
export const SATELLITE_MAX_ZOOM_PERCENT = 300;
export const UNNAMED = "Unnamed satellite";
export const HOVER_SCALE = 2;
export const HOVER_LINEAR_KM = 1000;
export const HOVER_REACH_KM = 2000;

export function hoverHeightM(altKm: number): number {
  if (!Number.isFinite(altKm) || altKm <= 0) return 0;
  const shown =
    altKm <= HOVER_LINEAR_KM
      ? altKm
      : HOVER_LINEAR_KM +
        HOVER_REACH_KM *
          (1 - Math.exp(-(altKm - HOVER_LINEAR_KM) / HOVER_REACH_KM));
  return shown * 1000 * HOVER_SCALE;
}

export function hoverHeights(
  positions: Float64Array,
  order: Int32Array | null,
  count: number,
  into: Float32Array,
): Float32Array {
  const target = into.length >= count ? into : new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const row = order === null ? i : order[i];
    target[i] = hoverHeightM(
      positions[row * POSITION_STRIDE + POSITION_ALTITUDE_KM],
    );
  }
  return target;
}

export function overlayPositions(
  positions: Float64Array,
  order: Int32Array | null,
  count: number,
  into: Float64Array,
): Float64Array {
  const size = count * POSITION_STRIDE;
  const target = into.length >= size ? into : new Float64Array(size);
  for (let i = 0; i < count; i++) {
    const from = (order === null ? i : order[i]) * POSITION_STRIDE;
    const to = i * POSITION_STRIDE;
    target[to] = positions[from];
    target[to + 1] = positions[from + 1];
    target[to + 2] = Number.NaN;
    target[to + 3] = positions[from + 3];
  }
  return target;
}

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
  /** How many satellites were wanted before the draw limit left some out. */
  candidates: number;
  /** A footprint for each marker that has one, when the cut asked for them. */
  rings: FootprintRing[];
};

export const MAX_FOOTPRINTS = 60;

/**
 * How far from the sub-point a ground observer can still see the satellite
 * above the horizon: R * acos(R / (R + altitude)).
 */
export function footprintRadiusKm(altitudeKm: number): number {
  if (!Number.isFinite(altitudeKm) || altitudeKm <= 0) return Number.NaN;
  return (
    EARTH_RADIUS_KM *
    Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + altitudeKm))
  );
}

export function noradLabel(id: string, altitudeKm: number): string {
  return Number.isFinite(altitudeKm)
    ? `NORAD ${id}, ${Math.round(altitudeKm).toLocaleString("en-US")} km`
    : `NORAD ${id}`;
}

export type SatelliteCut = {
  limit: DrawLimit;
  /** Starred and selected satellites, which the limit never drops. */
  forced: ReadonlySet<string>;
  /** SHOW HERE: draw only the satellites whose sub-point is in this box. */
  clip?: Box | null;
  /** Label each satellite with its NORAD number and altitude, and give it a footprint ring. */
  detail?: boolean;
  /** Satellites the filters leave out; starred and selected ones are never left out. */
  exclude?: ReadonlySet<string>;
  /** The NORAD number of each satellite id, where the id is not the number. */
  norads?: ReadonlyMap<string, string>;
};

/** Older catalogue numbers rank first: the long-lived, well-known satellites. */
export function satelliteImportance(id: string): number {
  const number = Number(id);
  return Number.isFinite(number) ? -number : Number.NaN;
}

export function satelliteMarkers(
  ids: readonly string[],
  names: ReadonlyMap<string, string>,
  positions: Float64Array,
  starred: ReadonlySet<string>,
  only: ReadonlySet<string> | null,
  cut: SatelliteCut = { limit: null, forced: new Set() },
): Placement {
  const wanted: number[] = [];
  const clip = cut.clip ?? null;
  const exclude = cut.exclude ?? null;
  for (let i = 0; i < ids.length; i++) {
    if (only !== null && !only.has(ids[i])) continue;
    if (exclude?.has(ids[i]) && !cut.forced.has(ids[i])) continue;
    if (
      clip !== null &&
      !cut.forced.has(ids[i]) &&
      !boxContains(
        clip,
        positions[i * POSITION_STRIDE],
        positions[i * POSITION_STRIDE + 1],
      )
    ) {
      continue;
    }
    wanted.push(i);
  }
  let chosen = wanted;
  if (cut.limit !== null) {
    const mask = selectTop(
      wanted.length,
      (index) => satelliteImportance(ids[wanted[index]]),
      (index) => cut.forced.has(ids[wanted[index]]),
      cut.limit,
    );
    if (mask !== null) chosen = wanted.filter((_, index) => mask[index] === 1);
  }
  const markers: Marker[] = [];
  const order: number[] = [];
  const rings: FootprintRing[] = [];
  const detail = cut.detail === true;
  for (const i of chosen) {
    const id = ids[i];
    const isStarred = starred.has(id);
    const at = i * POSITION_STRIDE;
    const altitude = positions[at + POSITION_ALTITUDE_KM];
    if (detail && rings.length < MAX_FOOTPRINTS) {
      const radiusKm = footprintRadiusKm(altitude);
      if (Number.isFinite(radiusKm)) {
        rings.push({ index: markers.length, radiusKm });
      }
    }
    markers.push({
      id,
      lon: positions[at],
      lat: positions[at + 1],
      glyph: "dot",
      size: SATELLITE_MAX_SIZE,
      tone: isStarred ? "accent" : "default",
      label: detail
        ? noradLabel(cut.norads?.get(id) ?? id, altitude)
        : (names.get(id) ?? UNNAMED),
      entity: true,
      adaptive: true,
      persistentLabel: isStarred || detail,
    });
    order.push(i);
  }
  return {
    markers,
    order: markers.length === ids.length ? null : Int32Array.from(order),
    candidates: wanted.length,
    rings,
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
