import {
  segmentFraction,
  segmentLength,
  segmentLonLat,
} from "@/components/console/gpu/segment-math";
import {
  type Marker,
  POSITION_STRIDE,
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
import { perfMetrics } from "@/perf/metrics";
import type { EntityChange } from "@/state/entities";
import type { MotionMode } from "@/state/motion";
import { blendHeading, limitTurn } from "./heading";
import { fixFromRow, MotionHistory } from "./history";
import { newPose, type Pose, poseAt } from "./interpolate";
import { normaliseDegrees, signedDelta } from "./sphere";

export const STRIDE = POSITION_STRIDE;

const POSITION_EPSILON = 1e-7;
const HEADING_EPSILON = 0.05;
const MAX_STEP_SECONDS = 5;
const METRES_PER_DEGREE = 111_194.9266;
export const OFFSCREEN_EVERY = 12;
export const MAX_SKIP = 12;
export const GROW_BELOW_PX = 0.15;
export const SHRINK_ABOVE_PX = 0.5;
export const TARGET_SHIFT_PX = 0.3;
export const MIN_SEGMENT_SECONDS = 1;
export const CHAIN_LIMIT_SECONDS = 1;
export const SEGMENT_BUDGET_MS = 4;
export const RECHECK_SECONDS = 30;

export type MotionTarget = {
  markers: (moduleId: string) => readonly Marker[] | undefined;
  isVisible: (moduleId: string) => boolean;
  onScreen?: (moduleId: string) => Uint8Array | undefined;
  setPositions: (moduleId: string, data: Float64Array) => void;
  setSegments?: (moduleId: string, update: SegmentUpdate) => void;
  segmentMotion?: () => boolean;
  invalidate: () => void;
};

export type MotionEngineOptions = {
  target: MotionTarget;
  clock: () => number;
  history?: MotionHistory;
  onMode?: (moduleId: string, mode: MotionMode | null) => void;
};

type Buffers = {
  out: Float64Array;
  prev: Float64Array;
  modes: Uint8Array;
  filled: boolean;
};

type SegmentBuffers = {
  markers: readonly Marker[];
  data: Float64Array;
  expiry: Float64Array;
  blockMin: Float64Array;
  modes: Uint8Array;
  rows: Uint32Array;
  index: Map<string, number> | null;
  cursor: number;
};

type Cadence = {
  skip: number;
  wait: number;
  lastMs: number | null;
};

type Difference = { changed: boolean; shiftMetres: number };

function compare(a: Float64Array, b: Float64Array): Difference {
  let changed = false;
  let shiftMetres = 0;
  for (let i = 0; i < a.length; i += STRIDE) {
    const dLon = a[i] - b[i];
    const dLat = a[i + 1] - b[i + 1];
    if (Number.isNaN(dLon) || Number.isNaN(dLat)) {
      if (Number.isNaN(a[i]) !== Number.isNaN(b[i])) changed = true;
      continue;
    }
    if (
      Math.abs(dLon) > POSITION_EPSILON ||
      Math.abs(dLat) > POSITION_EPSILON
    ) {
      changed = true;
      const east = Math.abs(dLon) * Math.cos((a[i + 1] * Math.PI) / 180);
      const metres = Math.max(east, Math.abs(dLat)) * METRES_PER_DEGREE;
      if (metres > shiftMetres) shiftMetres = metres;
    }
    if (a[i + 3] !== b[i + 3]) changed = true;
    const x = a[i + 2];
    const y = b[i + 2];
    if (Number.isNaN(x) !== Number.isNaN(y)) changed = true;
    else if (!Number.isNaN(x) && Math.abs(x - y) > HEADING_EPSILON) {
      changed = true;
    }
  }
  return { changed, shiftMetres };
}

export function nextSkip(
  skip: number,
  shiftMetres: number,
  metresPerPixel: number,
): number {
  const pixels = shiftMetres / metresPerPixel;
  if (pixels < GROW_BELOW_PX) return Math.min(MAX_SKIP, skip * 2);
  if (pixels > SHRINK_ABOVE_PX) {
    return Math.max(1, Math.floor((skip * TARGET_SHIFT_PX) / pixels));
  }
  return skip;
}

function createSegmentBuffers(markers: readonly Marker[]): SegmentBuffers {
  const count = markers.length;
  const blocks = Math.ceil(count / DIRTY_BLOCK);
  return {
    markers,
    data: new Float64Array(count * SEGMENT_STRIDE).fill(Number.NaN),
    expiry: new Float64Array(count).fill(Number.NEGATIVE_INFINITY),
    blockMin: new Float64Array(blocks).fill(Number.NEGATIVE_INFINITY),
    modes: new Uint8Array(count),
    rows: new Uint32Array(count),
    index: null,
    cursor: 0,
  };
}

function indexOfMarker(seg: SegmentBuffers, id: string): number {
  if (seg.index === null) {
    seg.index = new Map();
    seg.markers.forEach((marker, i) => {
      seg.index?.set(marker.id, i);
    });
  }
  return seg.index.get(id) ?? -1;
}

function nextFixTime(
  fixes: readonly { t: number }[],
  afterMs: number,
): number | null {
  for (const fix of fixes) if (fix.t > afterMs) return fix.t;
  return null;
}

export class MotionEngine {
  readonly history: MotionHistory;
  private readonly target: MotionTarget;
  private readonly clock: () => number;
  private readonly onMode: MotionEngineOptions["onMode"];
  private delays: ReadonlyMap<string, number> = new Map();
  private readonly buffers = new Map<string, Buffers>();
  private readonly modes = new Map<string, MotionMode | null>();
  private readonly shown = new Map<string, number>();
  private readonly pose: Pose = newPose();
  private readonly poseEnd: Pose = newPose();
  private readonly segments = new Map<string, SegmentBuffers>();
  private readonly dirty = new Map<string, Set<string>>();
  private readonly found = { lon: 0, lat: 0 };
  private readonly cadence = new Map<string, Cadence>();
  private metresPerPixel = 0;
  private fullRate: string | null = null;
  private waiting = false;
  private round = 0;

  constructor({ target, clock, history, onMode }: MotionEngineOptions) {
    this.target = target;
    this.clock = clock;
    this.history = history ?? new MotionHistory();
    this.onMode = onMode;
  }

  get movers(): ReadonlyMap<string, number> {
    return this.delays;
  }

  get pending(): boolean {
    return this.waiting;
  }

  setScale(metresPerPixel: number): void {
    this.metresPerPixel = metresPerPixel;
    for (const entry of this.cadence.values()) {
      entry.skip = 1;
      entry.wait = 0;
    }
  }

  setFullRate(moduleId: string | null): void {
    this.fullRate = moduleId;
    const entry = moduleId === null ? undefined : this.cadence.get(moduleId);
    if (entry) {
      entry.skip = 1;
      entry.wait = 0;
    }
  }

  setMovers(delays: ReadonlyMap<string, number>): void {
    this.delays = delays;
    for (const moduleId of [...this.buffers.keys()]) {
      if (!delays.has(moduleId)) this.release(moduleId);
    }
  }

  ingest(change: EntityChange): boolean {
    if (!this.delays.has(change.moduleId)) return false;
    const due = this.target.setSegments ? this.dirtyOf(change.moduleId) : null;
    for (const row of change.upserts) {
      const fix = fixFromRow(row);
      if (fix) {
        this.history.record(row.id, fix);
        due?.add(row.id);
      }
    }
    for (const id of change.removes) {
      this.history.forget(id);
      this.shown.delete(id);
    }
    if (change.reset) {
      const keep = new Set(change.upserts.map((row) => row.id));
      this.history.retain(keep);
      for (const id of [...this.shown.keys()]) {
        if (!keep.has(id)) this.shown.delete(id);
      }
    }
    return true;
  }

  positionOf(
    moduleId: string,
    id: string,
  ): { lon: number; lat: number } | null {
    const delay = this.delays.get(moduleId);
    const fixes = this.history.get(id);
    if (delay === undefined || !fixes) return null;
    const seg = this.segments.get(moduleId);
    if (seg && this.segmentMode()) {
      const at = indexOfMarker(seg, id);
      if (at >= 0 && !Number.isNaN(seg.data[at * SEGMENT_STRIDE])) {
        return this.segmentPosition(seg, at, this.clock() / 1000);
      }
    }
    const pose = poseAt(fixes, this.clock() - delay * 1000, newPose());
    return pose ? { lon: pose.lon, lat: pose.lat } : null;
  }

  get segmented(): boolean {
    return this.segmentMode();
  }

  apply(moduleId: string): boolean {
    if (this.segmentMode()) return this.computeSegments(moduleId, true);
    return this.compute(moduleId, this.clock(), 0, true);
  }

  step(): boolean {
    const started = performance.now();
    const now = this.clock();
    this.round = (this.round + 1) % OFFSCREEN_EVERY;
    let moved = false;
    let waiting = false;
    if (this.segmentMode()) {
      for (const moduleId of this.delays.keys()) {
        if (this.computeSegments(moduleId, false)) moved = true;
        if (this.segments.has(moduleId)) waiting = true;
      }
      this.waiting = waiting;
      if (moved) this.target.invalidate();
      perfMetrics.sample("step", performance.now() - started);
      return moved;
    }
    for (const moduleId of this.delays.keys()) {
      const entry = this.cadenceOf(moduleId);
      if (entry.wait > 0) {
        entry.wait -= 1;
        waiting = true;
        continue;
      }
      const elapsed =
        entry.lastMs === null
          ? 0
          : Math.min(
              MAX_STEP_SECONDS,
              Math.max(0, (now - entry.lastMs) / 1000),
            );
      entry.lastMs = now;
      if (this.compute(moduleId, now, elapsed)) moved = true;
      if (entry.wait > 0) waiting = true;
    }
    this.waiting = waiting;
    if (moved) this.target.invalidate();
    perfMetrics.sample("step", performance.now() - started);
    return moved;
  }

  reset(): void {
    for (const entry of this.cadence.values()) entry.lastMs = null;
  }

  private cadenceOf(moduleId: string): Cadence {
    let entry = this.cadence.get(moduleId);
    if (!entry) {
      entry = { skip: 1, wait: 0, lastMs: null };
      this.cadence.set(moduleId, entry);
    }
    return entry;
  }

  private segmentMode(): boolean {
    return (
      this.target.setSegments !== undefined &&
      this.target.segmentMotion?.() === true
    );
  }

  private dirtyOf(moduleId: string): Set<string> {
    let set = this.dirty.get(moduleId);
    if (!set) {
      set = new Set();
      this.dirty.set(moduleId, set);
    }
    return set;
  }

  private release(moduleId: string): void {
    this.buffers.delete(moduleId);
    this.segments.delete(moduleId);
    this.dirty.delete(moduleId);
    this.cadence.delete(moduleId);
    this.setMode(moduleId, null);
  }

  private compute(
    moduleId: string,
    now: number,
    seconds: number,
    force = false,
  ): boolean {
    const delay = this.delays.get(moduleId);
    const markers = this.target.markers(moduleId);
    this.segments.delete(moduleId);
    this.dirty.get(moduleId)?.clear();
    if (delay === undefined || !markers || !this.target.isVisible(moduleId)) {
      this.setMode(moduleId, null);
      return false;
    }
    const size = markers.length * STRIDE;
    let buffers = this.buffers.get(moduleId);
    if (!buffers || buffers.out.length !== size) {
      buffers = {
        out: new Float64Array(size),
        prev: new Float64Array(size),
        modes: new Uint8Array(markers.length),
        filled: false,
      };
      this.buffers.set(moduleId, buffers);
    }
    const { out } = buffers;
    const renderMs = now - delay * 1000;
    const mask = force ? undefined : this.target.onScreen?.(moduleId);
    let steady = 0;
    let running = 0;

    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i];
      const at = i * STRIDE;
      if (mask && mask[i] === 0 && (i + this.round) % OFFSCREEN_EVERY !== 0) {
        if (buffers.modes[i] === 1) steady += 1;
        else if (buffers.modes[i] === 2) running += 1;
        continue;
      }
      const fixes = this.history.get(marker.id);
      const pose = fixes ? poseAt(fixes, renderMs, this.pose) : null;
      if (!pose) {
        buffers.modes[i] = 0;
        out[at] = Number.NaN;
        out[at + 1] = Number.NaN;
        out[at + 2] = Number.NaN;
        out[at + 3] = 0;
        continue;
      }
      if (pose.mode === "extrapolated") {
        running += 1;
        buffers.modes[i] = 2;
      } else {
        steady += 1;
        buffers.modes[i] = 1;
      }
      const target = blendHeading(pose.track, pose.course, pose.speedKn);
      let rotation = Number.NaN;
      if (target !== null) {
        const known = this.shown.get(marker.id);
        rotation =
          known === undefined ? target : limitTurn(known, target, seconds);
        this.shown.set(marker.id, rotation);
      }
      out[at] = pose.lon;
      out[at + 1] = pose.lat;
      out[at + 2] = rotation;
      out[at + 3] = pose.stale ? 1 : 0;
    }

    this.setMode(
      moduleId,
      steady + running === 0
        ? null
        : steady >= running
          ? "interpolated"
          : "extrapolated",
    );

    const first = !buffers.filled;
    const difference = force || first ? null : compare(out, buffers.prev);
    const changed = difference === null || difference.changed;
    const entry = this.cadenceOf(moduleId);
    if (force) {
      entry.skip = 1;
      entry.wait = 0;
    } else if (
      difference !== null &&
      this.metresPerPixel > 0 &&
      moduleId !== this.fullRate
    ) {
      entry.skip = nextSkip(
        entry.skip,
        difference.shiftMetres,
        this.metresPerPixel,
      );
      entry.wait = changed ? entry.skip - 1 : 0;
    }
    if (changed) {
      this.target.setPositions(moduleId, out);
      buffers.prev.set(out);
      buffers.filled = true;
    }
    return changed;
  }

  private segmentPosition(
    seg: SegmentBuffers,
    index: number,
    seconds: number,
  ): { lon: number; lat: number } {
    const at = index * SEGMENT_STRIDE;
    const { data } = seg;
    segmentLonLat(
      data[at + SEGMENT_LON0],
      data[at + SEGMENT_LAT0],
      data[at + SEGMENT_LON1],
      data[at + SEGMENT_LAT1],
      data[at + SEGMENT_T0],
      data[at + SEGMENT_T1],
      seconds,
      this.found,
    );
    return { lon: this.found.lon, lat: this.found.lat };
  }

  private reconcile(
    moduleId: string,
    markers: readonly Marker[],
  ): SegmentBuffers {
    const known = this.segments.get(moduleId);
    if (known && known.markers === markers) return known;
    const next = createSegmentBuffers(markers);
    if (known) {
      let lookup: Map<string, number> | null = null;
      for (let i = 0; i < markers.length; i++) {
        let before = known.markers[i]?.id === markers[i].id ? i : -1;
        if (before < 0) {
          lookup ??= new Map(known.markers.map((marker, k) => [marker.id, k]));
          before = lookup.get(markers[i].id) ?? -1;
        }
        if (before < 0) continue;
        next.data.set(
          known.data.subarray(
            before * SEGMENT_STRIDE,
            (before + 1) * SEGMENT_STRIDE,
          ),
          i * SEGMENT_STRIDE,
        );
        next.expiry[i] = known.expiry[before];
        next.modes[i] = known.modes[before];
      }
      for (let b = 0; b < next.blockMin.length; b++) {
        next.blockMin[b] = this.blockMinimum(next, b);
      }
    }
    this.segments.set(moduleId, next);
    return next;
  }

  private blockMinimum(seg: SegmentBuffers, block: number): number {
    const from = block * DIRTY_BLOCK;
    const to = Math.min(from + DIRTY_BLOCK, seg.expiry.length);
    let least = Number.POSITIVE_INFINITY;
    for (let i = from; i < to; i++) {
      if (seg.expiry[i] < least) least = seg.expiry[i];
    }
    return least;
  }

  private markDue(seg: SegmentBuffers, index: number): void {
    seg.expiry[index] = Number.NEGATIVE_INFINITY;
    seg.blockMin[Math.floor(index / DIRTY_BLOCK)] = Number.NEGATIVE_INFINITY;
  }

  private resolveDirty(moduleId: string, seg: SegmentBuffers): void {
    const ids = this.dirty.get(moduleId);
    if (!ids || ids.size === 0) return;
    for (const id of ids) {
      const at = indexOfMarker(seg, id);
      if (at >= 0) this.markDue(seg, at);
    }
    ids.clear();
  }

  private computeSegments(moduleId: string, force: boolean): boolean {
    const delay = this.delays.get(moduleId);
    const markers = this.target.markers(moduleId);
    if (
      delay === undefined ||
      !markers ||
      !this.target.setSegments ||
      !this.target.isVisible(moduleId)
    ) {
      this.setMode(moduleId, null);
      this.segments.delete(moduleId);
      return false;
    }
    const seg = this.reconcile(moduleId, markers);
    this.resolveDirty(moduleId, seg);
    const nowMs = this.clock();
    const nowSeconds = nowMs / 1000;
    const blocks = seg.blockMin.length;
    const started = performance.now();
    let count = 0;
    for (let k = 0; k < blocks; k++) {
      const block = (seg.cursor + k) % blocks;
      if (seg.blockMin[block] > nowSeconds) continue;
      const from = block * DIRTY_BLOCK;
      const to = Math.min(from + DIRTY_BLOCK, markers.length);
      for (let i = from; i < to; i++) {
        if (seg.expiry[i] > nowSeconds) continue;
        this.buildSegment(seg, i, markers[i].id, nowSeconds, delay);
        seg.rows[count++] = i;
      }
      seg.blockMin[block] = this.blockMinimum(seg, block);
      if (!force && performance.now() - started >= SEGMENT_BUDGET_MS) {
        seg.cursor = (block + 1) % blocks;
        break;
      }
    }
    if (count === 0 && !force) return false;
    if (count > 0) this.reportModes(moduleId, seg);
    const update: SegmentUpdate = force
      ? { data: seg.data, rows: null, count: markers.length }
      : { data: seg.data, rows: seg.rows, count };
    this.target.setSegments(moduleId, update);
    return true;
  }

  private reportModes(moduleId: string, seg: SegmentBuffers): void {
    let steady = 0;
    let running = 0;
    for (let i = 0; i < seg.modes.length; i++) {
      if (seg.modes[i] === 1) steady += 1;
      else if (seg.modes[i] === 2) running += 1;
    }
    this.setMode(
      moduleId,
      steady + running === 0
        ? null
        : steady >= running
          ? "interpolated"
          : "extrapolated",
    );
  }

  private buildSegment(
    seg: SegmentBuffers,
    index: number,
    id: string,
    nowSeconds: number,
    delay: number,
  ): void {
    const at = index * SEGMENT_STRIDE;
    const { data } = seg;
    const fixes = this.history.get(id);
    const previousEnd = seg.expiry[index];
    const chained =
      Number.isFinite(previousEnd) &&
      previousEnd <= nowSeconds &&
      nowSeconds - previousEnd <= CHAIN_LIMIT_SECONDS;
    const startSeconds = chained ? previousEnd : nowSeconds;
    const renderMs = startSeconds * 1000 - delay * 1000;
    const begin = fixes ? poseAt(fixes, renderMs, this.pose) : null;
    if (!fixes || !begin) {
      data.fill(Number.NaN, at, at + SEGMENT_STRIDE);
      seg.modes[index] = 0;
      seg.expiry[index] = nowSeconds + RECHECK_SECONDS;
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
    seg.modes[index] = begin.mode === "extrapolated" ? 2 : 1;
    seg.expiry[index] = startSeconds + horizon;
  }

  private setMode(moduleId: string, mode: MotionMode | null): void {
    if ((this.modes.get(moduleId) ?? null) === mode) return;
    if (mode === null) this.modes.delete(moduleId);
    else this.modes.set(moduleId, mode);
    this.onMode?.(moduleId, mode);
  }
}
