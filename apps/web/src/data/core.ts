import type { DecodedFrame } from "@/api/frames";
import {
  segmentFraction,
  segmentHeading,
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
} from "@/components/console/markers";
import { aircraftRefine } from "@/modules/aircraft/refine";
import { defaultValues, type RefineValues } from "@/modules/refine";
import { vesselRefine } from "@/modules/vessels/refine";
import { SegmentSet } from "@/motion/segment-builder";
import type { MotionMode } from "@/state/motion";
import { Mirror } from "./mirror";
import {
  type FromWorker,
  type MotionFeed,
  type MoverSpec,
  POSITION_PACK_STRIDE,
} from "./protocol";
import { slotFilter } from "./refine-columns";
import { SlotHistory } from "./slot-history";

/** Rebuild at most this much segment work per step (the worker is off the main thread). */
export const WORKER_SEGMENT_BUDGET_MS = 8;
export const POSITIONS_EVERY_MS = 500;

const DEGREES_PER_RADIAN = 180 / Math.PI;

const DEFAULT_CONTROLS: Readonly<
  Record<string, typeof aircraftRefine.controls>
> = {
  aircraft: aircraftRefine.controls,
  vessels: vesselRefine.controls,
};

export type Emit = (message: FromWorker, transfer?: Transferable[]) => void;

export type DataCoreOptions = {
  emit: Emit;
  /** Server time in milliseconds. */
  clock: () => number;
  /** Monotonic milliseconds, for budgets. */
  now: () => number;
  /** Wall clock stamped on outgoing messages, for transfer timing. */
  stamp?: () => number;
};

type ModuleState = {
  id: string;
  delaySeconds: number;
  mirror: Mirror;
  history: SlotHistory;
  set: SegmentSet<number>;
  values: RefineValues;
  keepMark: Uint8Array;
  starredMark: Uint8Array;
  keep: Uint32Array;
  starred: Uint32Array;
  onlyStarred: boolean;
  visible: boolean;
  rows: Uint32Array;
  seq: number;
  kept: number;
  announced: boolean;
  needFull: boolean;
  mode: MotionMode | null;
  lastPositionsMs: number;
};

function marks(slots: Uint32Array, extent: number): Uint8Array {
  const mark = new Uint8Array(extent);
  for (const slot of slots) if (slot < extent) mark[slot] = 1;
  return mark;
}

function sameRows(a: Uint32Array, b: Uint32Array, count: number): boolean {
  if (a.length !== count) return false;
  for (let i = 0; i < count; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Everything the data worker knows, with no worker APIs in it: frames go in,
 * typed-array messages come out. The worker entry and the tests both drive it.
 */
type Settings = {
  values?: RefineValues;
  keep?: { keep: Uint32Array; starred: Uint32Array; onlyStarred: boolean };
  visible?: boolean;
};

export class DataCore {
  private readonly modules = new Map<string, ModuleState>();
  // Settings that arrived before their module was announced.
  private readonly early = new Map<string, Settings>();
  private readonly emit: Emit;
  private readonly clock: () => number;
  private readonly now: () => number;
  private readonly stamp: () => number;
  private feed: MotionFeed = "segments";

  constructor(options: DataCoreOptions) {
    this.emit = options.emit;
    this.clock = options.clock;
    this.now = options.now;
    this.stamp = options.stamp ?? options.clock;
  }

  get moduleIds(): string[] {
    return [...this.modules.keys()];
  }

  mirrorOf(moduleId: string): Mirror | undefined {
    return this.modules.get(moduleId)?.mirror;
  }

  /** The slots currently in the layer of a module, in row order. */
  rowsOf(moduleId: string): Uint32Array | undefined {
    return this.modules.get(moduleId)?.rows;
  }

  setMovers(movers: readonly MoverSpec[]): void {
    const wanted = new Set(movers.map((mover) => mover.id));
    for (const id of [...this.modules.keys()]) {
      if (!wanted.has(id)) this.modules.delete(id);
    }
    for (const { id, delaySeconds } of movers) {
      const known = this.modules.get(id);
      if (known) {
        known.delaySeconds = delaySeconds;
        continue;
      }
      const history = new SlotHistory();
      const early = this.early.get(id);
      this.early.delete(id);
      this.modules.set(id, {
        id,
        delaySeconds,
        mirror: new Mirror(),
        history,
        set: new SegmentSet(history),
        values: early?.values ?? defaultValues(DEFAULT_CONTROLS[id] ?? []),
        keepMark: new Uint8Array(0),
        starredMark: new Uint8Array(0),
        keep: early?.keep?.keep ?? new Uint32Array(0),
        starred: early?.keep?.starred ?? new Uint32Array(0),
        onlyStarred: early?.keep?.onlyStarred ?? false,
        visible: early?.visible ?? true,
        rows: new Uint32Array(0),
        seq: 0,
        kept: -1,
        announced: false,
        needFull: true,
        mode: null,
        lastPositionsMs: Number.NEGATIVE_INFINITY,
      });
    }
  }

  setFeed(feed: MotionFeed): void {
    if (feed === this.feed) return;
    this.feed = feed;
    for (const state of this.modules.values()) state.needFull = true;
  }

  setRefine(moduleId: string, values: RefineValues): void {
    const state = this.modules.get(moduleId);
    if (!state) {
      this.settle(moduleId).values = values;
      return;
    }
    state.values = values;
    this.rebuild(state);
  }

  setKeep(
    moduleId: string,
    keep: Uint32Array,
    starred: Uint32Array,
    onlyStarred: boolean,
  ): void {
    const state = this.modules.get(moduleId);
    if (!state) {
      this.settle(moduleId).keep = { keep, starred, onlyStarred };
      return;
    }
    state.keep = keep;
    state.starred = starred;
    state.onlyStarred = onlyStarred;
    state.keepMark = new Uint8Array(0);
    state.starredMark = new Uint8Array(0);
    this.rebuild(state);
  }

  setVisible(moduleId: string, visible: boolean): void {
    const state = this.modules.get(moduleId);
    if (!state) {
      this.settle(moduleId).visible = visible;
      return;
    }
    if (state.visible === visible) return;
    state.visible = visible;
    if (visible) {
      state.set.invalidate();
      state.announced = false;
      state.needFull = true;
      this.rebuild(state);
    } else if (state.mode !== null) {
      state.mode = null;
      this.emit({ type: "mode", moduleId, mode: null });
    }
  }

  /**
   * Send the module's layer and every segment again, as for a page that has
   * just started: the page asks when it dropped a layer it still needs.
   */
  announce(moduleId: string): void {
    const state = this.modules.get(moduleId);
    if (!state?.visible) return;
    state.set.invalidate();
    state.announced = false;
    state.needFull = true;
    this.rebuild(state, true);
  }

  private settle(moduleId: string): Settings {
    let settings = this.early.get(moduleId);
    if (!settings) {
      settings = {};
      this.early.set(moduleId, settings);
    }
    return settings;
  }

  /** Version the worker holds for a module, or 0 when it has none yet. */
  versionOf(moduleId: string): number {
    return this.modules.get(moduleId)?.mirror.version ?? 0;
  }

  epochOf(moduleId: string): number {
    return this.modules.get(moduleId)?.mirror.epoch ?? -1;
  }

  /** Drop what a module knows, so the next frame must be a snapshot. */
  forget(moduleId: string): void {
    const state = this.modules.get(moduleId);
    if (!state) return;
    state.mirror.clear();
    state.history.clear();
    state.set.clear();
    state.rows = new Uint32Array(0);
    state.announced = false;
  }

  /**
   * Apply one decoded frame. Throws `FrameGapError` when a delta does not
   * follow what the module holds; the caller then fetches a snapshot.
   */
  applyFrame(moduleId: string, frame: DecodedFrame): void {
    const state = this.modules.get(moduleId);
    if (!state) return;
    const { mirror, history } = state;
    const previousEpoch = mirror.epoch;
    const applied = mirror.apply(frame);

    if (applied.reset) {
      if (previousEpoch !== mirror.epoch) {
        history.clear();
        state.set.clear();
        state.announced = false;
      } else {
        for (let slot = 0; slot < mirror.extent; slot++) {
          if (mirror.alive[slot] === 0) history.forget(slot);
        }
      }
    }
    for (const slot of applied.removed) history.forget(slot);
    for (const slot of applied.changed) {
      history.record(mirror, slot);
      if (state.visible) state.set.dirty.add(slot);
    }
    this.forward(state, frame);
    if (!state.visible) return;
    this.rebuild(state, applied.reset);
  }

  /** One motion tick; returns true while there is more to do soon. */
  step(): boolean {
    const nowMs = this.clock();
    let busy = false;
    for (const state of this.modules.values()) {
      if (!state.visible || !state.announced) continue;
      busy = true;
      this.advance(state, nowMs);
    }
    return busy;
  }

  private forward(state: ModuleState, frame: DecodedFrame): void {
    const { dictionary } = frame;
    const snapshot = frame.kind === "snapshot";
    if (dictionary.slots.length === 0 && !snapshot) return;
    this.emit(
      {
        type: "dictionary",
        moduleId: state.id,
        epoch: frame.slotEpoch,
        reset: snapshot,
        slots: dictionary.slots.slice(),
        idOffsets: dictionary.idOffsets.slice(),
        idBytes: dictionary.idBytes.slice(),
        nameOffsets: dictionary.nameOffsets.slice(),
        nameBytes: dictionary.nameBytes.slice(),
      },
      [],
    );
  }

  /** Recompute which slots are in the layer and announce it when that changed. */
  private rebuild(state: ModuleState, force = false): void {
    const { mirror } = state;
    if (!state.visible || mirror.epoch < 0) return;
    const extent = mirror.extent;
    if (state.keepMark.length < extent) {
      state.keepMark = marks(state.keep, extent);
      state.starredMark = marks(state.starred, extent);
    }
    const filter = slotFilter(state.id, mirror, state.values, mirror.fetchedMs);
    const picked = new Uint32Array(mirror.count);
    let kept = 0;
    let shown = 0;
    const { alive } = mirror;
    const { keepMark, starredMark } = state;
    for (let slot = 0; slot < extent; slot++) {
      if (alive[slot] === 0) continue;
      if (keepMark[slot] === 0 && filter !== null && !filter(slot)) continue;
      kept += 1;
      if (state.onlyStarred && starredMark[slot] === 0) continue;
      picked[shown++] = slot;
    }
    const changed =
      force ||
      !state.announced ||
      !sameRows(state.rows, picked, shown) ||
      kept !== state.kept;
    if (!changed) return;
    const rows = picked.slice(0, shown);
    const rotation = new Float32Array(shown);
    const lon = new Float64Array(shown);
    const lat = new Float64Array(shown);
    for (let i = 0; i < shown; i++) {
      const slot = rows[i];
      const heading = mirror.heading[slot];
      const cog = mirror.cog[slot];
      rotation[i] = !Number.isNaN(heading)
        ? heading
        : Number.isNaN(cog)
          ? 0
          : cog;
      lon[i] = mirror.lon[slot];
      lat[i] = mirror.lat[slot];
    }
    const membership = !sameRows(state.rows, rows, shown);
    state.rows = rows;
    state.kept = kept;
    state.announced = true;
    if (membership || force || state.seq === 0) {
      state.seq += 1;
      state.needFull = true;
    }
    this.emit(
      {
        type: "layer",
        moduleId: state.id,
        seq: state.seq,
        epoch: mirror.epoch,
        version: mirror.version,
        slots: rows.slice(),
        rotation,
        lon,
        lat,
        kept,
        total: mirror.count,
        fetchedMs: mirror.fetchedMs,
        sentAt: this.stamp(),
      },
      [rotation.buffer, lon.buffer, lat.buffer],
    );
  }

  private advance(state: ModuleState, nowMs: number): void {
    const { set, rows } = state;
    set.reconcile(rows, rows.length, (i) => rows[i]);
    const full = state.needFull;
    const result = set.compute({
      nowSeconds: nowMs / 1000,
      delay: state.delaySeconds,
      force: full,
      budgetMs: WORKER_SEGMENT_BUDGET_MS,
      clock: this.now,
    });
    if (result.count > 0) {
      const mode = set.mode();
      if (mode !== state.mode) {
        state.mode = mode;
        this.emit({ type: "mode", moduleId: state.id, mode });
      }
    }
    if (this.feed === "positions") {
      if (full || nowMs - state.lastPositionsMs >= POSITIONS_EVERY_MS) {
        state.lastPositionsMs = nowMs;
        state.needFull = false;
        this.sendPositions(state, nowMs / 1000);
      }
      return;
    }
    const update = result.update;
    if (update === null) return;
    state.needFull = false;
    if (update.rows === null) {
      const data = update.data.slice();
      this.emit(
        {
          type: "segments",
          moduleId: state.id,
          seq: state.seq,
          rows: null,
          data,
          sentAt: this.stamp(),
        },
        [data.buffer],
      );
      return;
    }
    const count = update.count;
    const picked = update.rows.slice(0, count);
    const packed = new Float64Array(count * SEGMENT_STRIDE);
    for (let k = 0; k < count; k++) {
      packed.set(
        update.data.subarray(
          picked[k] * SEGMENT_STRIDE,
          (picked[k] + 1) * SEGMENT_STRIDE,
        ),
        k * SEGMENT_STRIDE,
      );
    }
    this.emit(
      {
        type: "segments",
        moduleId: state.id,
        seq: state.seq,
        rows: picked,
        data: packed,
        sentAt: this.stamp(),
      },
      [picked.buffer, packed.buffer],
    );
  }

  /** Positions at `seconds` for every row, for the 2D canvas renderer. */
  private sendPositions(state: ModuleState, seconds: number): void {
    const { set } = state;
    const count = set.size;
    const data = new Float64Array(count * POSITION_PACK_STRIDE).fill(
      Number.NaN,
    );
    const source = set.segments;
    const found = { lon: 0, lat: 0 };
    for (let i = 0; i < count; i++) {
      const at = i * SEGMENT_STRIDE;
      if (Number.isNaN(source[at + SEGMENT_LON0])) continue;
      const start = source[at + SEGMENT_T0];
      const end = source[at + SEGMENT_T1];
      segmentLonLat(
        source[at + SEGMENT_LON0],
        source[at + SEGMENT_LAT0],
        source[at + SEGMENT_LON1],
        source[at + SEGMENT_LAT1],
        start,
        end,
        seconds,
        found,
      );
      const out = i * POSITION_PACK_STRIDE;
      data[out] = found.lon;
      data[out + 1] = found.lat;
      const h0 = source[at + SEGMENT_H0];
      const h1 = source[at + SEGMENT_H1];
      if (!Number.isNaN(h0) && !Number.isNaN(h1)) {
        data[out + 2] =
          segmentHeading(
            h0 / DEGREES_PER_RADIAN,
            h1 / DEGREES_PER_RADIAN,
            segmentFraction(start, end, seconds),
          ) * DEGREES_PER_RADIAN;
      }
      data[out + 3] = source[at + SEGMENT_FADED] === 1 ? 1 : 0;
    }
    this.emit(
      {
        type: "positions",
        moduleId: state.id,
        seq: state.seq,
        data,
        sentAt: this.stamp(),
      },
      [data.buffer],
    );
  }
}
