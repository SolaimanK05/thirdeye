import { WGS84_RADII } from "./gpu/encode";
import { evaluateSegmentEcef } from "./gpu/segment-math";
import type { ScreenPoint } from "./projection";

export const SCAN_EDGE_MARGIN = 30;
const CHECK_EVERY = 256;

export type ScanFrame = {
  width: number;
  height: number;
  eyeScaled: ArrayLike<number>;
  now?: number;
  project: (x: number, y: number, z: number, out: ScreenPoint) => boolean;
};

export type ScanLayer = {
  id: string;
  count: number;
  ecef: Float64Array;
  active: boolean;
  delta?: Float64Array | null;
  times?: Float64Array | null;
};

export type ScanResult = { inView: number; onScreen: Uint8Array };

type Progress = {
  layer: ScanLayer;
  ecef: Float64Array;
  delta: Float64Array | null;
  times: Float64Array | null;
  count: number;
  active: boolean;
  cursor: number;
  inView: number;
  onScreen: Uint8Array;
};

type ScanOptions = {
  budgetMs: number;
  now: () => number;
  checkEvery?: number;
};

export class VisibilityScan {
  private readonly budgetMs: number;
  private readonly now: () => number;
  private readonly checkEvery: number;
  private frame: ScanFrame | null = null;
  private pending: string[] = [];
  private progress: Progress | null = null;
  private done = new Map<string, ScanResult>();
  private published: ReadonlyMap<string, ScanResult> = new Map();
  private readonly point: ScreenPoint = { x: 0, y: 0 };
  private readonly moved = new Float64Array(3);
  private readonly kx: number;
  private readonly ky: number;
  private readonly kz: number;
  private weights: [number, number, number] = [0, 0, 0];

  constructor(options: ScanOptions) {
    this.budgetMs = options.budgetMs;
    this.now = options.now;
    this.checkEvery = Math.max(1, options.checkEvery ?? CHECK_EVERY);
    this.kx = 1 / WGS84_RADII[0];
    this.ky = 1 / WGS84_RADII[1];
    this.kz = 1 / WGS84_RADII[2];
  }

  get sweeping(): boolean {
    return this.frame !== null;
  }

  begin(frame: ScanFrame, layers: readonly ScanLayer[]): void {
    this.frame = frame;
    this.pending = layers.map((layer) => layer.id);
    this.progress = null;
    this.done = new Map();
    this.weights = [
      this.kx * frame.eyeScaled[0],
      this.ky * frame.eyeScaled[1],
      this.kz * frame.eyeScaled[2],
    ];
  }

  step(layers: readonly ScanLayer[]): boolean {
    const frame = this.frame;
    if (!frame) return false;
    const started = this.now();
    const byId = new Map(layers.map((layer) => [layer.id, layer]));
    for (;;) {
      if (!this.progress && !this.next(byId)) {
        this.published = this.done;
        this.done = new Map();
        this.frame = null;
        return true;
      }
      const progress = this.progress;
      if (!progress) continue;
      const current = byId.get(progress.layer.id);
      if (
        !current ||
        current.ecef !== progress.ecef ||
        (current.delta ?? null) !== progress.delta ||
        current.count !== progress.count ||
        current.active !== progress.active
      ) {
        this.progress = null;
        if (current) {
          this.pending.unshift(current.id);
        }
        continue;
      }
      if (!this.advance(frame, progress, started)) return false;
      this.done.set(progress.layer.id, {
        inView: progress.inView,
        onScreen: progress.onScreen,
      });
      this.progress = null;
    }
  }

  result(): ReadonlyMap<string, ScanResult> {
    return this.published;
  }

  private next(byId: ReadonlyMap<string, ScanLayer>): boolean {
    while (this.pending.length > 0) {
      const id = this.pending.shift();
      const layer = id === undefined ? undefined : byId.get(id);
      if (!layer) continue;
      this.progress = {
        layer,
        ecef: layer.ecef,
        delta: layer.delta ?? null,
        times: layer.times ?? null,
        count: layer.count,
        active: layer.active,
        cursor: 0,
        inView: 0,
        onScreen: new Uint8Array(layer.count),
      };
      return true;
    }
    return false;
  }

  private advance(
    frame: ScanFrame,
    progress: Progress,
    started: number,
  ): boolean {
    const { ecef, delta, times, count, onScreen } = progress;
    const now = frame.now ?? 0;
    const moved = this.moved;
    if (!progress.active) {
      progress.cursor = count;
      return true;
    }
    const [wx, wy, wz] = this.weights;
    const { width, height, project } = frame;
    const point = this.point;
    let cursor = progress.cursor;
    let inView = progress.inView;
    let sinceCheck = 0;
    while (cursor < count) {
      const at = cursor * 3;
      let x = ecef[at];
      let y = ecef[at + 1];
      let z = ecef[at + 2];
      if (delta && times) {
        evaluateSegmentEcef(
          ecef,
          delta,
          at,
          times[cursor * 2],
          times[cursor * 2 + 1],
          now,
          moved,
          0,
        );
        x = moved[0];
        y = moved[1];
        z = moved[2];
      }
      if (
        x * wx + y * wy + z * wz > 1 &&
        project(x, y, z, point) &&
        point.x >= -SCAN_EDGE_MARGIN &&
        point.y >= -SCAN_EDGE_MARGIN &&
        point.x <= width + SCAN_EDGE_MARGIN &&
        point.y <= height + SCAN_EDGE_MARGIN
      ) {
        onScreen[cursor] = 1;
        inView++;
      }
      cursor++;
      if (++sinceCheck >= this.checkEvery) {
        sinceCheck = 0;
        if (cursor < count && this.now() - started >= this.budgetMs) {
          progress.cursor = cursor;
          progress.inView = inView;
          return false;
        }
      }
    }
    progress.cursor = cursor;
    progress.inView = inView;
    return true;
  }
}
