import type { DataStats } from "./protocol";

export type HubStats = {
  bytesPerSecond: number;
  framesPerSecond: number;
  applyMs: { p50: number; p95: number };
  transferMs: { p50: number; p95: number };
  /** Time the page itself spent on each message the worker sent. */
  pageMs: { p50: number; p95: number };
  rows: number;
  snapshots: number;
};

export const EMPTY_STATS: HubStats = {
  bytesPerSecond: 0,
  framesPerSecond: 0,
  applyMs: { p50: 0, p95: 0 },
  transferMs: { p50: 0, p95: 0 },
  pageMs: { p50: 0, p95: 0 },
  rows: 0,
  snapshots: 0,
};

const TRANSFER_SAMPLES = 256;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/** Turns the worker's running totals into rates, and times the patches it sends. */
export class StatsTracker {
  private previous: { at: number; bytes: number; frames: number } | null = null;
  private current: HubStats = EMPTY_STATS;
  private transfers: number[] = [];
  private handled: number[] = [];

  /** Time one patch spent between the worker posting it and the page getting it. */
  transfer(milliseconds: number): void {
    this.transfers.push(Math.max(0, milliseconds));
    if (this.transfers.length > TRANSFER_SAMPLES) this.transfers.shift();
  }

  /** Time the page took to handle one message from the worker. */
  page(milliseconds: number): void {
    this.handled.push(Math.max(0, milliseconds));
    if (this.handled.length > TRANSFER_SAMPLES) this.handled.shift();
  }

  report(stats: DataStats, now: number): void {
    const before = this.previous;
    this.previous = { at: now, bytes: stats.bytes, frames: stats.frames };
    const seconds = before ? (now - before.at) / 1000 : 0;
    const bytes = before ? stats.bytes - before.bytes : 0;
    const frames = before ? stats.frames - before.frames : 0;
    const ordered = this.transfers.slice().sort((a, b) => a - b);
    const pages = this.handled.slice().sort((a, b) => a - b);
    this.current = {
      bytesPerSecond: seconds > 0 ? Math.round(bytes / seconds) : 0,
      framesPerSecond:
        seconds > 0 ? Math.round((frames / seconds) * 10) / 10 : 0,
      applyMs: stats.applyMs,
      transferMs: {
        p50: percentile(ordered, 50),
        p95: percentile(ordered, 95),
      },
      pageMs: { p50: percentile(pages, 50), p95: percentile(pages, 95) },
      rows: stats.rows,
      snapshots: stats.snapshots,
    };
  }

  get view(): HubStats {
    return this.current;
  }
}
