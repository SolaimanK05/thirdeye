import { DataCore } from "@/data/core";
import { FrameFeed } from "@/data/frame-feed";
import type { DataStats, FromWorker, ToWorker } from "@/data/protocol";

const TICK_MS = 50;
const STATS_MS = 1000;

let offsetMs = 0;
let core: DataCore | null = null;
let feed: FrameFeed | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let reporter: ReturnType<typeof setInterval> | null = null;

let bytes = 0;
let frames = 0;
let snapshots = 0;
let samples: number[] = [];

function send(message: FromWorker, transfer: Transferable[] = []): void {
  postMessage(message, { transfer });
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

function report(): void {
  if (!core) return;
  const ordered = samples.slice().sort((a, b) => a - b);
  samples = [];
  let rows = 0;
  for (const id of core.moduleIds) rows += core.mirrorOf(id)?.count ?? 0;
  const stats: DataStats = {
    bytes,
    frames,
    snapshots,
    applyMs: { p50: percentile(ordered, 50), p95: percentile(ordered, 95) },
    rows,
  };
  send({
    type: "stats",
    stats,
    sentAt: performance.timeOrigin + performance.now(),
  });
}

function start(message: Extract<ToWorker, { type: "init" }>): void {
  offsetMs = message.clockOffsetMs;
  const created = new DataCore({
    emit: send,
    clock: () => Date.now() + offsetMs,
    now: () => performance.now(),
    stamp: () => performance.timeOrigin + performance.now(),
  });
  created.setFeed(message.feed);
  created.setMovers(message.movers);
  core = created;
  feed = new FrameFeed({
    apiUrl: message.apiUrl,
    core: created,
    onStatus: (moduleId, state, text) =>
      send({ type: "status", moduleId, state, message: text }),
    onFrame: (info) => {
      bytes += info.bytes;
      frames += 1;
      if (info.kind === "snapshot") snapshots += 1;
      samples.push(info.applyMs);
    },
  });
  feed.follow(message.movers.map((mover) => mover.id));
  ticker = setInterval(() => created.step(), TICK_MS);
  reporter = setInterval(report, STATS_MS);
}

function stop(): void {
  feed?.stop();
  if (ticker !== null) clearInterval(ticker);
  if (reporter !== null) clearInterval(reporter);
  ticker = reporter = null;
  feed = null;
  core = null;
}

addEventListener("message", (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.type === "init") {
    stop();
    start(message);
    return;
  }
  if (message.type === "stop") {
    stop();
    return;
  }
  if (!core || !feed) return;
  switch (message.type) {
    case "movers":
      core.setMovers(message.movers);
      feed.follow(message.movers.map((mover) => mover.id));
      break;
    case "notice":
      feed.notice(message.moduleId, message.version);
      break;
    case "resync":
      feed.resync();
      break;
    case "clock":
      offsetMs = message.offsetMs;
      break;
    case "feed":
      core.setFeed(message.feed);
      break;
    case "refine":
      core.setRefine(message.moduleId, message.values);
      break;
    case "keep":
      core.setKeep(
        message.moduleId,
        message.keep,
        message.starred,
        message.onlyStarred,
      );
      break;
    case "visible":
      core.setVisible(message.moduleId, message.visible);
      break;
    case "announce":
      core.announce(message.moduleId);
      break;
  }
});
