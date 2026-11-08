import { type Fix, HISTORY_SIZE } from "@/motion/history";
import type { Mirror } from "./mirror";

const SIZE = HISTORY_SIZE;

function same(a: number, b: number): boolean {
  return a === b || (Number.isNaN(a) && Number.isNaN(b));
}

function orNull(value: number): number | null {
  return Number.isNaN(value) ? null : value;
}

/**
 * The last few fixes of every slot, for the motion maths.
 *
 * The fixes live in typed arrays (a small block per slot, oldest first), so
 * recording 50,000 of them makes no objects. `get` builds the `Fix` list a
 * slot's motion needs, once, and keeps it until the slot changes. The rules
 * match `pushFix`: sorted by time, one fix per instant, only the newest few.
 */
export class SlotHistory {
  private capacity = 0;
  private count = new Uint8Array(0);
  private t = new Float64Array(0);
  private lon = new Float64Array(0);
  private lat = new Float64Array(0);
  private sog = new Float64Array(0);
  private cog = new Float64Array(0);
  private track = new Float64Array(0);
  private cache: (readonly Fix[] | undefined)[] = [];

  get(slot: number): readonly Fix[] | undefined {
    if (slot >= this.capacity) return undefined;
    const n = this.count[slot];
    if (n === 0) return undefined;
    const cached = this.cache[slot];
    if (cached) return cached;
    const base = slot * SIZE;
    const fixes: Fix[] = [];
    for (let k = 0; k < n; k++) {
      const at = base + k;
      fixes.push({
        t: this.t[at],
        lon: this.lon[at],
        lat: this.lat[at],
        sog: orNull(this.sog[at]),
        cog: orNull(this.cog[at]),
        track: orNull(this.track[at]),
      });
    }
    this.cache[slot] = fixes;
    return fixes;
  }

  /** Record the mirror's current reading of `slot` as a new fix. */
  record(mirror: Mirror, slot: number): void {
    this.reserve(slot + 1);
    const heading = mirror.heading[slot];
    const cog = mirror.cog[slot];
    const t = mirror.t[slot];
    const track = !Number.isNaN(heading) ? heading : cog;
    const base = slot * SIZE;
    let n = this.count[slot];

    let at = -1;
    for (let k = 0; k < n; k++) {
      if (this.t[base + k] >= t) {
        at = k;
        break;
      }
    }
    if (at !== -1 && this.t[base + at] === t) {
      const i = base + at;
      if (
        same(this.lon[i], mirror.lon[slot]) &&
        same(this.lat[i], mirror.lat[slot]) &&
        same(this.sog[i], mirror.sog[slot]) &&
        same(this.cog[i], cog) &&
        same(this.track[i], track)
      ) {
        return;
      }
      this.write(i, mirror, slot, t, track);
      this.cache[slot] = undefined;
      return;
    }

    let place = at === -1 ? n : at;
    if (n === SIZE) {
      // Full: a fix older than everything held would be the one dropped.
      if (place === 0) return;
      this.shift(base, 1, n, -1);
      place -= 1;
      n -= 1;
    }
    this.shift(base, place, n, 1);
    this.write(base + place, mirror, slot, t, track);
    this.count[slot] = n + 1;
    this.cache[slot] = undefined;
  }

  forget(slot: number): void {
    if (slot >= this.capacity) return;
    this.count[slot] = 0;
    this.cache[slot] = undefined;
  }

  clear(): void {
    this.count.fill(0);
    this.cache = [];
  }

  private write(
    index: number,
    mirror: Mirror,
    slot: number,
    t: number,
    track: number,
  ): void {
    this.t[index] = t;
    this.lon[index] = mirror.lon[slot];
    this.lat[index] = mirror.lat[slot];
    this.sog[index] = mirror.sog[slot];
    this.cog[index] = mirror.cog[slot];
    this.track[index] = track;
  }

  /** Move entries [from, to) of a slot's block by `by` places (1 or -1). */
  private shift(base: number, from: number, to: number, by: 1 | -1): void {
    const fields = [this.t, this.lon, this.lat, this.sog, this.cog, this.track];
    if (by === 1) {
      for (let k = to - 1; k >= from; k--) {
        for (const field of fields) field[base + k + 1] = field[base + k];
      }
    } else {
      for (let k = from; k < to; k++) {
        for (const field of fields) field[base + k - 1] = field[base + k];
      }
    }
  }

  private reserve(slots: number): void {
    if (slots <= this.capacity) return;
    const next = Math.max(slots, Math.ceil(this.capacity * 1.5), 1024);
    const grow = (
      old: Float64Array<ArrayBuffer>,
    ): Float64Array<ArrayBuffer> => {
      const bigger = new Float64Array(next * SIZE);
      bigger.set(old);
      return bigger;
    };
    const count = new Uint8Array(next);
    count.set(this.count);
    this.count = count;
    this.t = grow(this.t);
    this.lon = grow(this.lon);
    this.lat = grow(this.lat);
    this.sog = grow(this.sog);
    this.cog = grow(this.cog);
    this.track = grow(this.track);
    this.capacity = next;
  }
}
