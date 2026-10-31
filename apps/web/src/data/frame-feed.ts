import { type DecodedFrame, decodeFrame, FrameError } from "@/api/frames";
import { reconnectDelay } from "@/api/stream";
import type { DataCore } from "./core";
import { FrameGapError } from "./mirror";

/** Behind by more than this many versions, a snapshot is cheaper than the deltas. */
export const MAX_DELTA_GAP = 16;

export type FeedStatus = "loading" | "ready" | "error";

export type FrameFeedOptions = {
  apiUrl: string;
  core: DataCore;
  onStatus: (moduleId: string, status: FeedStatus, message?: string) => void;
  /** Called for every frame with its size on the wire and the time to apply it. */
  onFrame: (info: {
    moduleId: string;
    kind: "snapshot" | "delta";
    bytes: number;
    applyMs: number;
  }) => void;
  fetcher?: typeof fetch;
  now?: () => number;
  setTimer?: (callback: () => void, milliseconds: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  random?: () => number;
};

type Track = {
  target: number;
  busy: boolean;
  failures: number;
  needSnapshot: boolean;
  timer: unknown;
  rerun: boolean;
};

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, url: string) {
    super(`${status} for ${url}`);
    this.name = "HttpError";
    this.status = status;
  }
}

/**
 * Keeps the data core in step with the server: a snapshot to start, then one
 * delta per version, falling back to a fresh snapshot when a delta is missing,
 * out of retention, or from another slot epoch.
 */
export class FrameFeed {
  private readonly options: FrameFeedOptions;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly setTimer: NonNullable<FrameFeedOptions["setTimer"]>;
  private readonly clearTimer: NonNullable<FrameFeedOptions["clearTimer"]>;
  private readonly random: () => number;
  private readonly tracks = new Map<string, Track>();
  private readonly reported = new Map<string, string>();
  private controller = new AbortController();
  private stopped = false;

  constructor(options: FrameFeedOptions) {
    this.options = options;
    this.fetcher = options.fetcher ?? ((...args) => fetch(...args));
    this.now = options.now ?? (() => performance.now());
    this.setTimer = options.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
    this.clearTimer =
      options.clearTimer ??
      ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.random = options.random ?? Math.random;
  }

  /** Follow these modules, fetching a snapshot for each new one. */
  follow(moduleIds: readonly string[]): void {
    const wanted = new Set(moduleIds);
    for (const [id, track] of [...this.tracks]) {
      if (wanted.has(id)) continue;
      if (track.timer !== null) this.clearTimer(track.timer);
      this.tracks.delete(id);
      this.reported.delete(id);
    }
    for (const id of moduleIds) {
      if (this.tracks.has(id)) continue;
      this.tracks.set(id, {
        target: 0,
        busy: false,
        failures: 0,
        needSnapshot: true,
        timer: null,
        rerun: false,
      });
      void this.pump(id);
    }
  }

  /** The server announced that `moduleId` reached `version`. */
  notice(moduleId: string, version: number): void {
    const track = this.tracks.get(moduleId);
    if (!track) return;
    if (version > track.target) track.target = version;
    void this.pump(moduleId);
  }

  /** The stream reconnected without resuming: trust nothing, refetch everything. */
  resync(): void {
    for (const [id, track] of this.tracks) {
      track.needSnapshot = true;
      track.rerun = true;
      void this.pump(id);
    }
  }

  stop(): void {
    this.stopped = true;
    this.controller.abort();
    for (const track of this.tracks.values()) {
      if (track.timer !== null) this.clearTimer(track.timer);
      track.timer = null;
    }
    this.tracks.clear();
  }

  private report(moduleId: string, status: FeedStatus, message?: string): void {
    const key = `${status}:${message ?? ""}`;
    if (this.reported.get(moduleId) === key) return;
    this.reported.set(moduleId, key);
    this.options.onStatus(moduleId, status, message);
  }

  private async pump(moduleId: string): Promise<void> {
    const track = this.tracks.get(moduleId);
    if (!track || track.busy || this.stopped) return;
    track.busy = true;
    if (track.timer !== null) {
      this.clearTimer(track.timer);
      track.timer = null;
    }
    const { core } = this.options;
    try {
      for (;;) {
        if (this.stopped || this.tracks.get(moduleId) !== track) return;
        const have = core.versionOf(moduleId);
        const behind = track.target - have;
        const loaded = have > 0 && core.epochOf(moduleId) >= 0;
        if (loaded && behind <= 0 && !track.needSnapshot && !track.rerun) break;
        track.rerun = false;
        if (!loaded || track.needSnapshot || behind > MAX_DELTA_GAP) {
          this.report(moduleId, "loading");
          await this.load(moduleId, `/v1/movers/${moduleId}/snapshot`, track);
          track.needSnapshot = false;
        } else {
          const next = have + 1;
          const epoch = core.epochOf(moduleId);
          try {
            await this.load(
              moduleId,
              `/v1/movers/${moduleId}/frames/${next}?epoch=${epoch}`,
              track,
            );
          } catch (error) {
            const missing = error instanceof HttpError && error.status === 404;
            if (missing || error instanceof FrameGapError) {
              track.needSnapshot = true;
              continue;
            }
            throw error;
          }
        }
        track.failures = 0;
      }
      this.report(moduleId, "ready");
    } catch (error) {
      if (this.stopped || (error as Error).name === "AbortError") return;
      if (error instanceof FrameGapError) track.needSnapshot = true;
      track.failures += 1;
      this.report(
        moduleId,
        "error",
        error instanceof Error ? error.message : String(error),
      );
      track.timer = this.setTimer(
        () => {
          track.timer = null;
          void this.pump(moduleId);
        },
        reconnectDelay(track.failures, this.random),
      );
    } finally {
      track.busy = false;
    }
    // A notice that arrived while the last request was in flight.
    if (
      !this.stopped &&
      track.timer === null &&
      this.tracks.get(moduleId) === track &&
      track.target > core.versionOf(moduleId)
    ) {
      void this.pump(moduleId);
    }
  }

  private async load(
    moduleId: string,
    path: string,
    track: Track,
  ): Promise<void> {
    const url = `${this.options.apiUrl}${path}`;
    const response = await this.fetcher(url, {
      signal: this.controller.signal,
    });
    if (!response.ok) throw new HttpError(response.status, url);
    const body = await response.arrayBuffer();
    const wire = Number(response.headers.get("content-length"));
    const started = this.now();
    let frame: DecodedFrame;
    try {
      frame = decodeFrame(body);
      this.options.core.applyFrame(moduleId, frame);
    } catch (error) {
      if (error instanceof FrameError) {
        track.needSnapshot = true;
      }
      throw error;
    }
    if (frame.version > track.target) track.target = frame.version;
    this.options.onFrame({
      moduleId,
      kind: frame.kind,
      bytes: Number.isFinite(wire) && wire > 0 ? wire : body.byteLength,
      applyMs: this.now() - started,
    });
  }
}
