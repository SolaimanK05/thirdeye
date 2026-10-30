import {
  BENCH_SEED,
  type BenchMover,
  benchMovers,
  benchPositions,
  benchSegmentRows,
} from "@/perf/bench";
import { perfMetrics } from "@/perf/metrics";
import { serverNowMs } from "@/state/stream";
import { segmentLength } from "./gpu/segment-math";
import {
  type Marker,
  type OverlayPort,
  POSITION_STRIDE,
  SEGMENT_STRIDE,
} from "./markers";
import { DIRTY_BLOCK } from "./renderer";

export const BENCH_ID = "bench";
const BENCH_RATE_HZ = 12;

const MIN_INTERVAL_MS = 1000 / BENCH_RATE_HZ;
const CHAIN_LIMIT_SECONDS = 1;
const SEGMENT_BUDGET_MS = 4;
const PHASES = 16;
const PHASE_STRIDE = 5;
const GLYPH_SIZE = { plane: 10, ship: 10, dot: 3 } as const;

export type FrameScheduler = {
  request: (callback: () => void) => number;
  cancel: (handle: number) => void;
};

const browserFrames: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

function markerFor(mover: BenchMover): Marker {
  return {
    id: mover.id,
    lon: mover.lon,
    lat: mover.lat,
    glyph: mover.glyph,
    size: GLYPH_SIZE[mover.glyph],
    tone: "default",
    label: "",
    adaptive: true,
    entity: false,
  };
}

export class BenchDriver {
  private readonly overlay: OverlayPort;
  private readonly count: number;
  private readonly clock: () => number;
  private readonly frames: FrameScheduler;
  private movers: readonly BenchMover[] = [];
  private data = new Float64Array(0);
  private segments = new Float64Array(0);
  private rows = new Uint32Array(0);
  private blockExpiry = new Float64Array(0);
  private cursor = 0;
  private readonly serverNow: () => number;
  private origin = 0;
  private startedAt = 0;
  private lastTick = Number.NEGATIVE_INFINITY;
  private handle: number | null = null;
  private running = false;

  constructor(
    overlay: OverlayPort,
    count: number,
    clock: () => number = performance.now.bind(performance),
    frames: FrameScheduler = browserFrames,
    serverNow: () => number = serverNowMs,
  ) {
    this.overlay = overlay;
    this.serverNow = serverNow;
    this.count = count;
    this.clock = clock;
    this.frames = frames;
  }

  start(): void {
    if (this.running || this.count <= 0) return;
    this.running = true;
    this.movers = benchMovers(this.count, BENCH_SEED);
    this.data = new Float64Array(this.movers.length * POSITION_STRIDE);
    this.startedAt = this.clock();
    this.origin = this.serverNow() / 1000;
    this.blockExpiry = new Float64Array(
      Math.ceil(this.movers.length / DIRTY_BLOCK),
    ).fill(Number.NEGATIVE_INFINITY);
    this.overlay.setLayer(
      BENCH_ID,
      this.movers.map(markerFor),
      false,
      undefined,
      {
        pickable: false,
        reported: false,
      },
    );
    this.tick();
    this.schedule();
  }

  destroy(): void {
    if (!this.running) return;
    this.running = false;
    if (this.handle !== null) this.frames.cancel(this.handle);
    this.handle = null;
    this.overlay.removeLayer(BENCH_ID);
    this.movers = [];
    this.data = new Float64Array(0);
    this.segments = new Float64Array(0);
    this.rows = new Uint32Array(0);
    this.blockExpiry = new Float64Array(0);
    this.cursor = 0;
  }

  private schedule(): void {
    this.handle = this.frames.request(() => {
      this.handle = null;
      if (!this.running) return;
      if (this.clock() - this.lastTick >= MIN_INTERVAL_MS && !hidden()) {
        this.tick();
      }
      this.schedule();
    });
  }

  private tick(): void {
    const started = this.clock();
    this.lastTick = started;
    if (this.segmented()) {
      this.tickSegments();
    } else {
      benchPositions(this.movers, (started - this.startedAt) / 1000, this.data);
      this.overlay.setPositions(BENCH_ID, this.data);
      this.overlay.invalidate();
    }
    perfMetrics.sample("step", this.clock() - started);
  }

  private segmented(): boolean {
    return (
      this.overlay.setSegments !== undefined &&
      this.overlay.segmentMotion?.() === true
    );
  }

  private tickSegments(): void {
    const count = this.movers.length;
    if (this.segments.length !== count * SEGMENT_STRIDE) {
      this.segments = new Float64Array(count * SEGMENT_STRIDE);
      this.rows = new Uint32Array(count);
      this.blockExpiry.fill(Number.NEGATIVE_INFINITY);
      this.cursor = 0;
    }
    const now = this.serverNow() / 1000;
    const everything = this.blockExpiry.every(
      (expiry) => expiry === Number.NEGATIVE_INFINITY,
    );
    const blocks = this.blockExpiry.length;
    const first = this.cursor;
    const started = this.clock();
    let written = 0;
    for (let step = 0; step < blocks; step++) {
      if (
        !everything &&
        written > 0 &&
        this.clock() - started >= SEGMENT_BUDGET_MS
      ) {
        break;
      }
      const block = (first + step) % blocks;
      const expiry = this.blockExpiry[block];
      if (expiry > now) continue;
      const from = block * DIRTY_BLOCK;
      const to = Math.min(from + DIRTY_BLOCK, count);
      const fresh = expiry === Number.NEGATIVE_INFINITY;
      const chained = !fresh && now - expiry <= CHAIN_LIMIT_SECONDS;
      const start = chained ? expiry : now;
      const length = segmentLength(from);
      const horizon = fresh
        ? (length * (((block * PHASE_STRIDE) % PHASES) + 1)) / PHASES
        : length;
      benchSegmentRows(
        this.movers,
        from,
        to,
        start - this.origin,
        horizon,
        start,
        chained,
        this.segments,
      );
      this.blockExpiry[block] = start + horizon;
      for (let i = from; i < to; i++) this.rows[written++] = i;
      this.cursor = (block + 1) % blocks;
    }
    if (written === 0) return;
    this.overlay.setSegments?.(BENCH_ID, {
      data: this.segments,
      rows: everything ? null : this.rows,
      count: everything ? count : written,
    });
  }
}

function hidden(): boolean {
  return typeof document !== "undefined" && document.hidden;
}
