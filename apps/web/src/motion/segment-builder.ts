import {
  segmentFraction,
  segmentLength,
  segmentLonLat,
} from "@/components/console/gpu/segment-math";
import {
  SEGMENT_FADED,
  SEGMENT_H0,
  SEGMENT_H1,
  SEGMENT_LAT0,
  SEGMENT_LAT1,
  SEGMENT_LON0,
  SEGMENT_LON1,
  SEGMENT_STRIDE,
  SEGMENT_T0,
  SEGMENT_T1,
  type SegmentUpdate,
} from "@/components/console/markers";
import { DIRTY_BLOCK } from "@/components/console/renderer";
import type { MotionMode } from "@/state/motion";
import { blendHeading, limitTurn } from "./heading";
import type { Fix } from "./history";
import { newPose, type Pose, poseAt } from "./interpolate";
import { normaliseDegrees, signedDelta } from "./sphere";

export const MIN_SEGMENT_SECONDS = 1;
export const CHAIN_LIMIT_SECONDS = 1;
export const RECHECK_SECONDS = 30;

export type FixSource<K> = { get: (key: K) => readonly Fix[] | undefined };

export type SegmentResult = {
  /** Rows rebuilt by this call; zero means nothing changed. */
  count: number;
  /** What to hand to the renderer, or null when there is nothing to send. */
  update: SegmentUpdate | null;
};

function nextFixTime(
  fixes: readonly { t: number }[],
  afterMs: number,
): number | null {
  for (const fix of fixes) if (fix.t > afterMs) return fix.t;
  return null;
}

/**
 * Builds the straight-line motion segments of one layer, a few blocks per call.
 *
 * Rows are identified by a key (an entity id on the main thread, a slot number
 * in the data worker); the layer is whatever list of keys the caller passes to
 * `reconcile`. Everything else is the same maths in both places.
 */
export class SegmentSet<K> {
  private readonly fixes: FixSource<K>;
  private readonly pose: Pose = newPose();
  private readonly poseEnd: Pose = newPose();
  private readonly found = { lon: 0, lat: 0 };
  private owner: object | null = null;
  private count = 0;
  private keyAt: (index: number) => K = () => {
    throw new Error("segment set has no rows");
  };
  private index: Map<K, number> | null = null;
  private data = new Float64Array(0);
  private expiry = new Float64Array(0);
  private blockMin = new Float64Array(0);
  private modes = new Uint8Array(0);
  private rows = new Uint32Array(0);
  private cursor = 0;
  readonly dirty = new Set<K>();

  constructor(fixes: FixSource<K>) {
    this.fixes = fixes;
  }

  get size(): number {
    return this.count;
  }

  get active(): boolean {
    return this.owner !== null;
  }

  get segments(): Float64Array {
    return this.data;
  }

  /** Point the set at a layer. Rows that were already built keep their segment. */
  reconcile(owner: object, count: number, keyAt: (index: number) => K): void {
    if (this.owner === owner) return;
    const hadRows = this.owner !== null;
    const before = {
      count: this.count,
      keyAt: this.keyAt,
      data: this.data,
      expiry: this.expiry,
      modes: this.modes,
      index: this.index,
    };
    const blocks = Math.ceil(count / DIRTY_BLOCK);
    this.owner = owner;
    this.count = count;
    this.keyAt = keyAt;
    this.index = null;
    this.data = new Float64Array(count * SEGMENT_STRIDE).fill(Number.NaN);
    this.expiry = new Float64Array(count).fill(Number.NEGATIVE_INFINITY);
    this.blockMin = new Float64Array(blocks).fill(Number.NEGATIVE_INFINITY);
    this.modes = new Uint8Array(count);
    this.rows = new Uint32Array(count);
    this.cursor = 0;
    if (!hadRows) return;

    let lookup = before.index;
    for (let i = 0; i < count; i++) {
      const key = keyAt(i);
      let old = i < before.count && before.keyAt(i) === key ? i : -1;
      if (old < 0) {
        if (lookup === null) {
          lookup = new Map();
          for (let k = 0; k < before.count; k++) lookup.set(before.keyAt(k), k);
        }
        old = lookup.get(key) ?? -1;
      }
      if (old < 0) continue;
      this.data.set(
        before.data.subarray(old * SEGMENT_STRIDE, (old + 1) * SEGMENT_STRIDE),
        i * SEGMENT_STRIDE,
      );
      this.expiry[i] = before.expiry[old];
      this.modes[i] = before.modes[old];
    }
    for (let b = 0; b < blocks; b++) this.blockMin[b] = this.blockMinimum(b);
  }

  clear(): void {
    this.owner = null;
    this.count = 0;
    this.index = null;
    this.dirty.clear();
  }

  /** Make every row due again, for example after the layer was hidden. */
  invalidate(): void {
    this.expiry.fill(Number.NEGATIVE_INFINITY);
    this.blockMin.fill(Number.NEGATIVE_INFINITY);
  }

  positionOf(key: K, seconds: number): { lon: number; lat: number } | null {
    const at = this.rowOf(key);
    if (at < 0 || Number.isNaN(this.data[at * SEGMENT_STRIDE])) return null;
    const base = at * SEGMENT_STRIDE;
    const { data } = this;
    segmentLonLat(
      data[base + SEGMENT_LON0],
      data[base + SEGMENT_LAT0],
      data[base + SEGMENT_LON1],
      data[base + SEGMENT_LAT1],
      data[base + SEGMENT_T0],
      data[base + SEGMENT_T1],
      seconds,
      this.found,
    );
    return { lon: this.found.lon, lat: this.found.lat };
  }

  mode(): MotionMode | null {
    let steady = 0;
    let running = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.modes[i] === 1) steady += 1;
      else if (this.modes[i] === 2) running += 1;
    }
    if (steady + running === 0) return null;
    return steady >= running ? "interpolated" : "extrapolated";
  }

  /**
   * Rebuild the rows whose segment ran out, block by block, until the budget
   * is spent (a forced pass rebuilds everything that is due).
   */
  compute(options: {
    nowSeconds: number;
    delay: number;
    force: boolean;
    budgetMs: number;
    clock: () => number;
  }): SegmentResult {
    const { nowSeconds, delay, force, budgetMs, clock } = options;
    this.resolveDirty();
    const blocks = this.blockMin.length;
    const started = clock();
    let built = 0;
    for (let k = 0; k < blocks; k++) {
      const block = (this.cursor + k) % blocks;
      if (this.blockMin[block] > nowSeconds) continue;
      const from = block * DIRTY_BLOCK;
      const to = Math.min(from + DIRTY_BLOCK, this.count);
      for (let i = from; i < to; i++) {
        if (this.expiry[i] > nowSeconds) continue;
        this.build(i, this.keyAt(i), nowSeconds, delay);
        this.rows[built++] = i;
      }
      this.blockMin[block] = this.blockMinimum(block);
      if (!force && clock() - started >= budgetMs) {
        this.cursor = (block + 1) % blocks;
        break;
      }
    }
    if (built === 0 && !force) return { count: 0, update: null };
    const update: SegmentUpdate = force
      ? { data: this.data, rows: null, count: this.count }
      : { data: this.data, rows: this.rows, count: built };
    return { count: built, update };
  }

  private rowOf(key: K): number {
    if (this.index === null) {
      const index = new Map<K, number>();
      for (let i = 0; i < this.count; i++) index.set(this.keyAt(i), i);
      this.index = index;
    }
    return this.index.get(key) ?? -1;
  }

  private blockMinimum(block: number): number {
    const from = block * DIRTY_BLOCK;
    const to = Math.min(from + DIRTY_BLOCK, this.count);
    let least = Number.POSITIVE_INFINITY;
    for (let i = from; i < to; i++) {
      if (this.expiry[i] < least) least = this.expiry[i];
    }
    return least;
  }

  private resolveDirty(): void {
    if (this.dirty.size === 0) return;
    for (const key of this.dirty) {
      const at = this.rowOf(key);
      if (at < 0) continue;
      this.expiry[at] = Number.NEGATIVE_INFINITY;
      this.blockMin[Math.floor(at / DIRTY_BLOCK)] = Number.NEGATIVE_INFINITY;
    }
    this.dirty.clear();
  }

  private build(
    index: number,
    key: K,
    nowSeconds: number,
    delay: number,
  ): void {
    const at = index * SEGMENT_STRIDE;
    const { data } = this;
    const fixes = this.fixes.get(key);
    const previousEnd = this.expiry[index];
    const chained =
      Number.isFinite(previousEnd) &&
      previousEnd <= nowSeconds &&
      nowSeconds - previousEnd <= CHAIN_LIMIT_SECONDS;
    const startSeconds = chained ? previousEnd : nowSeconds;
    const renderMs = startSeconds * 1000 - delay * 1000;
    const begin = fixes ? poseAt(fixes, renderMs, this.pose) : null;
    if (!fixes || !begin) {
      data.fill(Number.NaN, at, at + SEGMENT_STRIDE);
      this.modes[index] = 0;
      this.expiry[index] = nowSeconds + RECHECK_SECONDS;
      return;
    }
    const next = nextFixTime(fixes, renderMs);
    const length = segmentLength(index);
    const horizon =
      next === null
        ? length
        : Math.min(
            length,
            Math.max(MIN_SEGMENT_SECONDS, (next - renderMs) / 1000),
          );
    const end = poseAt(fixes, renderMs + horizon * 1000, this.poseEnd);
    if (!end) return;

    const startTarget = blendHeading(begin.track, begin.course, begin.speedKn);
    const endTarget = blendHeading(end.track, end.course, end.speedKn);
    let from = startTarget ?? Number.NaN;
    const oldStart = data[at + SEGMENT_T0];
    const oldEnd = data[at + SEGMENT_T1];
    const oldFrom = data[at + SEGMENT_H0];
    const oldTo = data[at + SEGMENT_H1];
    if (
      !Number.isNaN(oldFrom) &&
      !Number.isNaN(oldTo) &&
      oldEnd > oldStart &&
      startSeconds >= oldStart
    ) {
      from = normaliseDegrees(
        oldFrom +
          signedDelta(oldFrom, oldTo) *
            segmentFraction(oldStart, oldEnd, startSeconds),
      );
    }
    let to = Number.NaN;
    if (endTarget !== null) {
      if (Number.isNaN(from)) from = endTarget;
      to = limitTurn(from, endTarget, horizon);
    } else if (!Number.isNaN(from)) {
      to = from;
    }

    data[at + SEGMENT_LON0] = begin.lon;
    data[at + SEGMENT_LAT0] = begin.lat;
    data[at + SEGMENT_LON1] = end.lon;
    data[at + SEGMENT_LAT1] = end.lat;
    data[at + SEGMENT_T0] = startSeconds;
    data[at + SEGMENT_T1] = startSeconds + horizon;
    data[at + SEGMENT_H0] = from;
    data[at + SEGMENT_H1] = to;
    data[at + SEGMENT_FADED] = end.stale ? 1 : 0;
    this.modes[index] = begin.mode === "extrapolated" ? 2 : 1;
    this.expiry[index] = startSeconds + horizon;
  }
}
