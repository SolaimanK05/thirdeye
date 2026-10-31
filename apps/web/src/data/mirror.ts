import {
  type DecodedFrame,
  FLAG_ON_GROUND,
  NULL_I16,
  NULL_U16,
} from "@/api/frames";

export class FrameGapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrameGapError";
  }
}

export type Applied = {
  /** Slots that were inserted or updated, in frame order. */
  changed: Uint32Array;
  /** Slots that were removed. */
  removed: Uint32Array;
  /** True when the whole slot space was replaced (a snapshot). */
  reset: boolean;
};

const COORD = 1e7;
const SPEED = 10;
const ANGLE = 100;

/**
 * The latest known state of every mover in one module, as columns indexed by
 * slot. Slots are stable within a slot epoch, so a delta frame is a few array
 * writes and no objects are created.
 */
export class Mirror {
  epoch = -1;
  version = 0;
  fetchedMs = 0;
  alive = new Uint8Array(0);
  lon = new Float64Array(0);
  lat = new Float64Array(0);
  /** Observation time in milliseconds since the epoch. */
  t = new Float64Array(0);
  sog = new Float64Array(0);
  cog = new Float64Array(0);
  heading = new Float64Array(0);
  alt = new Float64Array(0);
  flags = new Uint8Array(0);
  cls = new Uint8Array(0);
  confidence = new Uint8Array(0);
  /** One past the highest slot ever written in this epoch. */
  extent = 0;
  count = 0;

  get capacity(): number {
    return this.alive.length;
  }

  onGround(slot: number): boolean {
    return (this.flags[slot] & FLAG_ON_GROUND) !== 0;
  }

  clear(): void {
    this.epoch = -1;
    this.version = 0;
    this.fetchedMs = 0;
    this.alive.fill(0);
    this.extent = 0;
    this.count = 0;
  }

  /** True when `frame` can be applied on top of the current state. */
  accepts(frame: DecodedFrame): boolean {
    if (frame.kind === "snapshot") return true;
    return frame.slotEpoch === this.epoch && frame.baseVersion === this.version;
  }

  apply(frame: DecodedFrame): Applied {
    const snapshot = frame.kind === "snapshot";
    if (!snapshot && !this.accepts(frame)) {
      throw new FrameGapError(
        `delta ${frame.baseVersion}->${frame.version} (epoch ${frame.slotEpoch}) does not follow ${this.version} (epoch ${this.epoch})`,
      );
    }
    if (snapshot) {
      this.alive.fill(0);
      this.extent = 0;
      this.count = 0;
      this.epoch = frame.slotEpoch;
    }
    let top = this.extent;
    for (let i = 0; i < frame.rows; i++) {
      if (frame.slot[i] >= top) top = frame.slot[i] + 1;
    }
    this.reserve(top);

    const removed = new Uint32Array(frame.removes.length);
    let dropped = 0;
    for (const slot of frame.removes) {
      if (slot >= this.extent || this.alive[slot] === 0) continue;
      this.alive[slot] = 0;
      this.count -= 1;
      removed[dropped++] = slot;
    }

    for (let i = 0; i < frame.rows; i++) {
      const slot = frame.slot[i];
      if (this.alive[slot] === 0) {
        this.alive[slot] = 1;
        this.count += 1;
      }
      this.lon[slot] = frame.lon[i] / COORD;
      this.lat[slot] = frame.lat[i] / COORD;
      this.t[slot] = frame.t[i] * 1000;
      const sog = frame.sog[i];
      this.sog[slot] = sog === NULL_U16 ? Number.NaN : sog / SPEED;
      const cog = frame.cog[i];
      this.cog[slot] = cog === NULL_U16 ? Number.NaN : cog / ANGLE;
      const heading = frame.heading[i];
      this.heading[slot] = heading === NULL_U16 ? Number.NaN : heading / ANGLE;
      const alt = frame.alt[i];
      this.alt[slot] = alt === NULL_I16 ? Number.NaN : alt;
      this.flags[slot] = frame.flags[i];
      this.cls[slot] = frame.class[i];
      this.confidence[slot] = frame.confidence[i];
    }
    this.extent = top;
    this.version = frame.version;
    this.fetchedMs = frame.fetchedMs;
    return {
      changed: frame.slot.slice(0, frame.rows),
      removed: removed.subarray(0, dropped),
      reset: snapshot,
    };
  }

  private reserve(extent: number): void {
    if (extent <= this.capacity) return;
    const next = Math.max(extent, Math.ceil(this.capacity * 1.5), 1024);
    const grow = <T extends Float64Array | Uint8Array>(
      old: T,
      make: (n: number) => T,
    ): T => {
      const bigger = make(next);
      bigger.set(old);
      return bigger;
    };
    this.alive = grow(this.alive, (n) => new Uint8Array(n));
    this.lon = grow(this.lon, (n) => new Float64Array(n));
    this.lat = grow(this.lat, (n) => new Float64Array(n));
    this.t = grow(this.t, (n) => new Float64Array(n));
    this.sog = grow(this.sog, (n) => new Float64Array(n));
    this.cog = grow(this.cog, (n) => new Float64Array(n));
    this.heading = grow(this.heading, (n) => new Float64Array(n));
    this.alt = grow(this.alt, (n) => new Float64Array(n));
    this.flags = grow(this.flags, (n) => new Uint8Array(n));
    this.cls = grow(this.cls, (n) => new Uint8Array(n));
    this.confidence = grow(this.confidence, (n) => new Uint8Array(n));
  }
}
