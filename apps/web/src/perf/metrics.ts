export type Percentiles = { p50: number; p95: number };

export type PerfSnapshot = {
  fps: number;
  drawsPerSecond: number;
  frameMs: Percentiles;
  drawMs: Percentiles;
  stepMs: Percentiles;
  longTasks: { count: number; worstMs: number; totalMs: number } | null;
  busyShare: number | null;
  markers: { drawn: number; inView: number };
};

export type PerfMetricsOptions = {
  now: () => number;
  windowMs?: number;
  enabled?: boolean;
  longTasks?: boolean;
};

export const WINDOW_MS = 5000;
export const SERIES_CAP = 20_000;

class Series {
  private at: number[] = [];
  private value: number[] = [];
  private start = 0;

  get length(): number {
    return this.at.length - this.start;
  }

  get first(): { at: number; value: number } | undefined {
    return this.start < this.at.length
      ? { at: this.at[this.start], value: this.value[this.start] }
      : undefined;
  }

  push(at: number, value: number): void {
    this.at.push(at);
    this.value.push(value);
    if (this.length > SERIES_CAP) this.start += 1;
  }

  trim(oldest: number): void {
    while (this.start < this.at.length && this.at[this.start] < oldest) {
      this.start += 1;
    }
    if (this.start > 1024 && this.start * 2 > this.at.length) {
      this.at = this.at.slice(this.start);
      this.value = this.value.slice(this.start);
      this.start = 0;
    }
  }

  values(): number[] {
    return this.value.slice(this.start);
  }

  clear(): void {
    this.at = [];
    this.value = [];
    this.start = 0;
  }
}

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

function summary(values: number[]): Percentiles {
  values.sort((a, b) => a - b);
  return { p50: percentile(values, 50), p95: percentile(values, 95) };
}

export class PerfMetrics {
  private readonly now: () => number;
  private readonly windowMs: number;
  private active: boolean;
  private longTaskSupport: boolean;
  private readonly frames = new Series();
  private readonly draws = new Series();
  private readonly steps = new Series();
  private readonly tasks = new Series();
  private lastFrame: number | null = null;
  private since: number;
  private drawn = 0;
  private inView = 0;

  constructor({
    now,
    windowMs = WINDOW_MS,
    enabled = true,
    longTasks = false,
  }: PerfMetricsOptions) {
    this.now = now;
    this.windowMs = windowMs;
    this.active = enabled;
    this.longTaskSupport = longTasks;
    this.since = now();
  }

  get enabled(): boolean {
    return this.active;
  }

  enable(longTasks: boolean): void {
    this.active = true;
    this.longTaskSupport = longTasks;
    this.reset();
  }

  disable(): void {
    this.active = false;
    this.longTaskSupport = false;
    this.reset();
  }

  reset(): void {
    this.frames.clear();
    this.draws.clear();
    this.steps.clear();
    this.tasks.clear();
    this.lastFrame = null;
    this.since = this.now();
    this.drawn = 0;
    this.inView = 0;
  }

  frame(at: number): void {
    if (!this.active) return;
    if (this.lastFrame !== null) this.frames.push(at, at - this.lastFrame);
    this.lastFrame = at;
  }

  sample(name: "draw" | "step", ms: number): void {
    if (!this.active) return;
    (name === "draw" ? this.draws : this.steps).push(this.now(), ms);
  }

  longTask(at: number, ms: number): void {
    if (!this.active) return;
    this.tasks.push(at, ms);
  }

  markers(drawn: number, inView: number): void {
    if (!this.active) return;
    this.drawn = drawn;
    this.inView = inView;
  }

  snapshot(): PerfSnapshot {
    const now = this.now();
    const oldest = now - this.windowMs;
    for (const series of [this.frames, this.draws, this.steps, this.tasks]) {
      series.trim(oldest);
    }
    const taskValues = this.tasks.values();
    const totalMs = taskValues.reduce((sum, ms) => sum + ms, 0);
    return {
      fps: this.framesPerSecond(now),
      drawsPerSecond: this.drawsPerSecond(now),
      frameMs: summary(this.frames.values()),
      drawMs: summary(this.draws.values()),
      stepMs: summary(this.steps.values()),
      longTasks: this.longTaskSupport
        ? {
            count: taskValues.length,
            worstMs: taskValues.reduce((worst, ms) => Math.max(worst, ms), 0),
            totalMs,
          }
        : null,
      busyShare: this.longTaskSupport
        ? Math.min(1, totalMs / this.windowMs)
        : null,
      markers: { drawn: this.drawn, inView: this.inView },
    };
  }

  private framesPerSecond(now: number): number {
    const first = this.frames.first;
    if (first === undefined) return 0;
    const span = now - (first.at - first.value);
    return span > 0 ? (this.frames.length / span) * 1000 : 0;
  }

  private drawsPerSecond(now: number): number {
    const span = Math.min(this.windowMs, now - this.since);
    return span > 0 ? (this.draws.length / span) * 1000 : 0;
  }
}

export const perfMetrics = new PerfMetrics({
  now: () => performance.now(),
  enabled: false,
});
