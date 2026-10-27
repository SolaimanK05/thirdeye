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
export const OFFSCREEN_EVERY = 12;

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

function differs(a: Float64Array, b: Float64Array): boolean {
  for (let i = 0; i < a.length; i += STRIDE) {
    if (
      Math.abs(a[i] - b[i]) > POSITION_EPSILON ||
      Math.abs(a[i + 1] - b[i + 1]) > POSITION_EPSILON ||
      a[i + 3] !== b[i + 3]
    ) {
      return true;
    }
    const x = a[i + 2];
    const y = b[i + 2];
    if (Number.isNaN(x) !== Number.isNaN(y)) return true;
    if (!Number.isNaN(x) && Math.abs(x - y) > HEADING_EPSILON) return true;
  }
  return false;
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
  private lastStepMs: number | null = null;
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
    const elapsed =
      this.lastStepMs === null
        ? 0
        : Math.min(
            MAX_STEP_SECONDS,
            Math.max(0, (now - this.lastStepMs) / 1000),
          );
    this.lastStepMs = now;
    this.round = (this.round + 1) % OFFSCREEN_EVERY;
    let moved = false;
    for (const moduleId of this.delays.keys()) {
      if (this.compute(moduleId, now, elapsed)) moved = true;
    }
    if (moved) this.target.invalidate();
    return moved;
  }

  reset(): void {
    this.lastStepMs = null;
  }

  private release(moduleId: string): void {
    this.buffers.delete(moduleId);
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

    const changed = force || !buffers.filled || differs(out, buffers.prev);
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
