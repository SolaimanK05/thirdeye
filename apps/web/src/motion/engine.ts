import { type Marker, POSITION_STRIDE } from "@/components/console/markers";
import type { EntityChange } from "@/state/entities";
import type { MotionMode } from "@/state/motion";
import { blendHeading, limitTurn } from "./heading";
import { fixFromRow, MotionHistory } from "./history";
import { newPose, type Pose, poseAt } from "./interpolate";

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

export type MotionTarget = {
  markers: (moduleId: string) => readonly Marker[] | undefined;
  isVisible: (moduleId: string) => boolean;
  onScreen?: (moduleId: string) => Uint8Array | undefined;
  setPositions: (moduleId: string, data: Float64Array) => void;
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
    for (const row of change.upserts) {
      const fix = fixFromRow(row);
      if (fix) this.history.record(row.id, fix);
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
    const pose = poseAt(fixes, this.clock() - delay * 1000, newPose());
    return pose ? { lon: pose.lon, lat: pose.lat } : null;
  }

  apply(moduleId: string): boolean {
    return this.compute(moduleId, this.clock(), 0, true);
  }

  step(): boolean {
    const now = this.clock();
    this.round = (this.round + 1) % OFFSCREEN_EVERY;
    let moved = false;
    let waiting = false;
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

  private release(moduleId: string): void {
    this.buffers.delete(moduleId);
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

  private setMode(moduleId: string, mode: MotionMode | null): void {
    if ((this.modes.get(moduleId) ?? null) === mode) return;
    if (mode === null) this.modes.delete(moduleId);
    else this.modes.set(moduleId, mode);
    this.onMode?.(moduleId, mode);
  }
}
