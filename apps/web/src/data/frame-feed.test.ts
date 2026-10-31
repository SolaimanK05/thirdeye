import { describe, expect, it } from "vitest";
import { DataCore } from "./core";
import { type FeedStatus, FrameFeed, MAX_DELTA_GAP } from "./frame-feed";
import { bytesOf, type TestFrame } from "./test-frames";

const API = "http://api.test";

function setup(routes: Record<string, () => Response | Promise<Response>>) {
  const requested: string[] = [];
  const statuses: [string, FeedStatus, string | undefined][] = [];
  const frames: { kind: string; bytes: number }[] = [];
  const timers: { callback: () => void; ms: number }[] = [];
  const core = new DataCore({
    emit: () => {},
    clock: () => 1_800_000_030_000,
    now: () => 0,
  });
  core.setMovers([{ id: "aircraft", delaySeconds: 5 }]);
  const feed = new FrameFeed({
    apiUrl: API,
    core,
    fetcher: (async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url.replace(API, ""));
      const route = routes[url.replace(API, "")];
      return route ? route() : new Response("missing", { status: 404 });
    }) as typeof fetch,
    onStatus: (id, status, message) => statuses.push([id, status, message]),
    onFrame: (info) => frames.push({ kind: info.kind, bytes: info.bytes }),
    setTimer: (callback, ms) => {
      timers.push({ callback, ms });
      return timers.length;
    },
    clearTimer: () => {},
    random: () => 0,
  });
  return { core, feed, requested, statuses, frames, timers };
}

const ok = (spec: TestFrame) => () => new Response(bytesOf(spec));
const row = (slot: number, lon = 0) => ({ slot, lon, lat: 1 });
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("FrameFeed", () => {
  it("loads a snapshot, then one delta per announced version", async () => {
    const { core, feed, requested, statuses } = setup({
      "/v1/movers/aircraft/snapshot": ok({ version: 1, rows: [row(0)] }),
      "/v1/movers/aircraft/frames/2?epoch=1": ok({
        kind: "delta",
        version: 2,
        rows: [row(0, 5)],
      }),
    });
    feed.follow(["aircraft"]);
    await settle();
    expect(core.versionOf("aircraft")).toBe(1);
    feed.notice("aircraft", 2);
    await settle();
    expect(core.versionOf("aircraft")).toBe(2);
    expect(core.mirrorOf("aircraft")?.lon[0]).toBeCloseTo(5, 6);
    expect(requested).toEqual([
      "/v1/movers/aircraft/snapshot",
      "/v1/movers/aircraft/frames/2?epoch=1",
    ]);
    expect(statuses.map((s) => s[1])).toEqual(["loading", "ready"]);
  });

  it("walks through several missed versions in order", async () => {
    const { core, feed, requested } = setup({
      "/v1/movers/aircraft/snapshot": ok({ version: 1, rows: [row(0)] }),
      "/v1/movers/aircraft/frames/2?epoch=1": ok({
        kind: "delta",
        version: 2,
        rows: [],
      }),
      "/v1/movers/aircraft/frames/3?epoch=1": ok({
        kind: "delta",
        version: 3,
        rows: [],
      }),
      "/v1/movers/aircraft/frames/4?epoch=1": ok({
        kind: "delta",
        version: 4,
        rows: [],
      }),
    });
    feed.follow(["aircraft"]);
    await settle();
    feed.notice("aircraft", 4);
    await settle();
    expect(core.versionOf("aircraft")).toBe(4);
    expect(requested.slice(1)).toEqual([
      "/v1/movers/aircraft/frames/2?epoch=1",
      "/v1/movers/aircraft/frames/3?epoch=1",
      "/v1/movers/aircraft/frames/4?epoch=1",
    ]);
  });

  it("takes a snapshot instead of a long run of deltas", async () => {
    const jump = 1 + MAX_DELTA_GAP + 5;
    const { core, feed, requested } = setup({
      "/v1/movers/aircraft/snapshot": () =>
        new Response(
          bytesOf({
            version: requested.length === 1 ? 1 : jump,
            rows: [row(0)],
          }),
        ),
    });
    feed.follow(["aircraft"]);
    await settle();
    feed.notice("aircraft", jump);
    await settle();
    expect(requested).toEqual([
      "/v1/movers/aircraft/snapshot",
      "/v1/movers/aircraft/snapshot",
    ]);
    expect(core.versionOf("aircraft")).toBe(jump);
  });

  it("falls back to a snapshot when a delta is outside retention", async () => {
    let snapshots = 0;
    const { core, feed, requested } = setup({
      "/v1/movers/aircraft/snapshot": () =>
        new Response(
          bytesOf({ version: snapshots++ === 0 ? 1 : 3, rows: [row(0)] }),
        ),
    });
    feed.follow(["aircraft"]);
    await settle();
    feed.notice("aircraft", 3);
    await settle();
    expect(requested).toEqual([
      "/v1/movers/aircraft/snapshot",
      "/v1/movers/aircraft/frames/2?epoch=1",
      "/v1/movers/aircraft/snapshot",
    ]);
    expect(core.versionOf("aircraft")).toBe(3);
  });

  it("refetches when a delta does not follow what it holds", async () => {
    let snapshots = 0;
    const { core, feed, requested } = setup({
      "/v1/movers/aircraft/snapshot": () =>
        new Response(
          bytesOf({
            version: snapshots++ === 0 ? 1 : 2,
            epoch: snapshots === 1 ? 1 : 2,
            rows: [row(0)],
          }),
        ),
      "/v1/movers/aircraft/frames/2?epoch=1": ok({
        kind: "delta",
        version: 2,
        base: 99,
        rows: [],
      }),
    });
    feed.follow(["aircraft"]);
    await settle();
    feed.notice("aircraft", 2);
    await settle();
    await settle();
    expect(core.epochOf("aircraft")).toBe(2);
    expect(requested.filter((r) => r.endsWith("snapshot"))).toHaveLength(2);
  });

  it("retries with backoff after a server error", async () => {
    let failing = true;
    const { core, feed, statuses, timers } = setup({
      "/v1/movers/aircraft/snapshot": () =>
        failing
          ? new Response("boom", { status: 500 })
          : new Response(bytesOf({ version: 1, rows: [row(0)] })),
    });
    feed.follow(["aircraft"]);
    await settle();
    expect(statuses.at(-1)?.[1]).toBe("error");
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBeGreaterThanOrEqual(500);
    failing = false;
    timers[0].callback();
    await settle();
    expect(core.versionOf("aircraft")).toBe(1);
    expect(statuses.at(-1)?.[1]).toBe("ready");
  });

  it("refetches every snapshot on resync", async () => {
    const { feed, requested } = setup({
      "/v1/movers/aircraft/snapshot": ok({ version: 1, rows: [row(0)] }),
    });
    feed.follow(["aircraft"]);
    await settle();
    feed.resync();
    await settle();
    expect(requested.filter((r) => r.endsWith("snapshot"))).toHaveLength(2);
  });

  it("ignores notices for modules it does not follow and after stop", async () => {
    const { feed, requested } = setup({
      "/v1/movers/aircraft/snapshot": ok({ version: 1, rows: [row(0)] }),
    });
    feed.follow(["aircraft"]);
    await settle();
    feed.notice("vessels", 9);
    feed.stop();
    feed.notice("aircraft", 9);
    await settle();
    expect(requested).toEqual(["/v1/movers/aircraft/snapshot"]);
  });

  it("reports how big each frame was", async () => {
    const { feed, frames } = setup({
      "/v1/movers/aircraft/snapshot": () =>
        new Response(bytesOf({ version: 1, rows: [row(0)] }), {
          headers: { "content-length": "123" },
        }),
    });
    feed.follow(["aircraft"]);
    await settle();
    expect(frames).toEqual([{ kind: "snapshot", bytes: 123 }]);
  });
});
