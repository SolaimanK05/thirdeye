import {
  eciToGeodetic,
  gstime,
  json2satrec,
  propagate,
  type SatRec,
  SatRecError,
} from "satellite.js";
import { type Omm, parseOmm } from "./omm";

export const POSITION_STRIDE = 4;

const DEGREES_PER_RADIAN = 180 / Math.PI;
const PROPAGATE_OPTIONS = { communityDecayCheckEnabled: true } as const;

export type RawElement = {
  id: string;
  name: string | null;
  omm: unknown;
};

export type OrbitSample = {
  id: string;
  atMs: number;
  lon: number;
  lat: number;
  altKm: number;
  speedKmS: number;
};

export type LoadResult = { loaded: number; rejected: number };
export type FillResult = { written: number; dropped: number };

type Placed = { lon: number; lat: number; altKm: number; speedKmS: number };

function build(omm: Omm): SatRec | null {
  const satrec = json2satrec(omm);
  return satrec.error === SatRecError.None ? satrec : null;
}

export class Propagator {
  private ids: string[] = [];
  private satrecs: SatRec[] = [];
  private index = new Map<string, number>();
  private readonly date = new Date(0);

  get count(): number {
    return this.ids.length;
  }

  get idList(): readonly string[] {
    return this.ids;
  }

  clear(): void {
    this.ids = [];
    this.satrecs = [];
    this.index = new Map();
  }

  load(elements: readonly RawElement[]): LoadResult {
    const ids: string[] = [];
    const satrecs: SatRec[] = [];
    let rejected = 0;
    for (const element of elements) {
      const omm = parseOmm(element.omm, element.name);
      const satrec = omm === null ? null : build(omm);
      if (satrec === null) {
        rejected += 1;
        continue;
      }
      ids.push(element.id);
      satrecs.push(satrec);
    }
    this.ids = ids;
    this.satrecs = satrecs;
    this.reindex();
    return { loaded: ids.length, rejected };
  }

  fill(atMs: number, out: Float64Array): FillResult {
    this.date.setTime(atMs);
    const gmst = gstime(this.date);
    let written = 0;
    let dropped = 0;
    const keep: boolean[] = [];
    for (let i = 0; i < this.satrecs.length; i++) {
      const placed = this.place(this.satrecs[i], gmst);
      keep.push(placed !== null);
      if (placed === null) {
        dropped += 1;
        continue;
      }
      const at = written * POSITION_STRIDE;
      out[at] = placed.lon;
      out[at + 1] = placed.lat;
      out[at + 2] = Number.NaN;
      out[at + 3] = 0;
      written += 1;
    }
    if (dropped > 0) this.retain(keep);
    return { written, dropped };
  }

  sample(id: string, atMs: number): OrbitSample | null {
    const at = this.index.get(id);
    if (at === undefined) return null;
    this.date.setTime(atMs);
    const placed = this.place(this.satrecs[at], gstime(this.date));
    return placed === null ? null : { id, atMs, ...placed };
  }

  private place(satrec: SatRec, gmst: number): Placed | null {
    const state = propagate(satrec, this.date, PROPAGATE_OPTIONS);
    if (state === null) return null;
    const { longitude, latitude, height } = eciToGeodetic(state.position, gmst);
    const { x, y, z } = state.velocity;
    const lon = longitude * DEGREES_PER_RADIAN;
    const lat = latitude * DEGREES_PER_RADIAN;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return { lon, lat, altKm: height, speedKmS: Math.hypot(x, y, z) };
  }

  private retain(keep: readonly boolean[]): void {
    this.ids = this.ids.filter((_, i) => keep[i]);
    this.satrecs = this.satrecs.filter((_, i) => keep[i]);
    this.reindex();
  }

  private reindex(): void {
    this.index = new Map(this.ids.map((id, i) => [id, i]));
  }
}
