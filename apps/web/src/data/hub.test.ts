import { describe, expect, it } from "vitest";
import { DataHub, type WorkerPort } from "./hub";
import type { FromWorker, ToWorker } from "./protocol";

function port() {
  const sent: ToWorker[] = [];
  const listeners = new Set<(event: MessageEvent<FromWorker>) => void>();
  let terminated = false;
  const fake: WorkerPort = {
    postMessage: (message) => {
      sent.push(message);
    },
    terminate: () => {
      terminated = true;
    },
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
  };
  return {
    fake,
    sent,
    listeners,
    get terminated() {
      return terminated;
    },
    deliver: (message: FromWorker) => {
      for (const listener of listeners) {
        listener({ data: message } as MessageEvent<FromWorker>);
      }
    },
  };
}

const dictionary = (reset: boolean, slot: number, id: string) => {
  const enc = new TextEncoder().encode(id);
  return {
    type: "dictionary",
    moduleId: "aircraft",
    epoch: 3,
    reset,
    slots: Uint32Array.of(slot),
    idOffsets: Uint32Array.of(0, enc.length),
    idBytes: enc,
    nameOffsets: Uint32Array.of(0, enc.length),
    nameBytes: enc,
  } satisfies FromWorker;
};

describe("DataHub", () => {
  it("sends commands to the worker as plain messages", () => {
    const p = port();
    const hub = new DataHub(p.fake);
    hub.start({
      apiUrl: "http://x",
      movers: [],
      clockOffsetMs: 5,
      feed: "segments",
    });
    hub.setMovers([{ id: "aircraft", delaySeconds: 5 }]);
    hub.notice("aircraft", 9);
    hub.resync();
    hub.setClock(12);
    hub.setFeed("positions");
    hub.setRefine("aircraft", { altitude: [0, 1] });
    hub.setKeep("aircraft", Uint32Array.of(1), Uint32Array.of(2), true);
    hub.setVisible("aircraft", false);
    expect(p.sent.map((m) => m.type)).toEqual([
      "init",
      "movers",
      "notice",
      "resync",
      "clock",
      "feed",
      "refine",
      "keep",
      "visible",
    ]);
  });

  it("puts dictionary text in place before telling listeners about it", () => {
    const p = port();
    const hub = new DataHub(p.fake);
    const seen: (string | undefined)[] = [];
    hub.subscribe((message) => {
      if (message.type === "dictionary") {
        seen.push(hub.dictionaryOf("aircraft").idOf(0));
      }
    });
    p.deliver(dictionary(true, 0, "first"));
    p.deliver(dictionary(false, 1, "second"));
    expect(seen).toEqual(["first", "first"]);
    expect(hub.dictionaryOf("aircraft").idOf(1)).toBe("second");
    p.deliver(dictionary(true, 4, "fresh"));
    expect(hub.dictionaryOf("aircraft").idOf(0)).toBeUndefined();
    expect(hub.dictionaryOf("aircraft").idOf(4)).toBe("fresh");
  });

  it("times patches from the stamp they carry", () => {
    const p = port();
    let now = 1000;
    const hub = new DataHub(p.fake, () => now);
    now = 1007;
    p.deliver({
      type: "positions",
      moduleId: "aircraft",
      seq: 1,
      data: new Float64Array(0),
      sentAt: 1000,
    });
    p.deliver({
      type: "stats",
      stats: {
        bytes: 0,
        frames: 0,
        snapshots: 0,
        applyMs: { p50: 1, p95: 2 },
        rows: 3,
      },
      sentAt: 1000,
    });
    expect(hub.stats.transferMs.p50).toBe(7);
    expect(hub.stats.rows).toBe(3);
  });

  it("rates a report by when the worker made it, not when a busy page read it", () => {
    const p = port();
    const hub = new DataHub(p.fake, () => 9000);
    const report = (bytes: number, sentAt: number) =>
      p.deliver({
        type: "stats",
        stats: {
          bytes,
          frames: 0,
          snapshots: 0,
          applyMs: { p50: 0, p95: 0 },
          rows: 0,
        },
        sentAt,
      });
    // Both reports reach the page together after a stall.
    report(0, 1000);
    report(100_000, 3000);
    expect(hub.stats.bytesPerSecond).toBe(50_000);
  });

  it("times how long listeners take to handle a message", () => {
    const p = port();
    let busy = 0;
    const hub = new DataHub(
      p.fake,
      () => 0,
      () => busy,
    );
    hub.subscribe(() => {
      busy += 12;
    });
    p.deliver({
      type: "positions",
      moduleId: "aircraft",
      seq: 1,
      data: new Float64Array(0),
      sentAt: 0,
    });
    p.deliver({
      type: "stats",
      stats: {
        bytes: 0,
        frames: 0,
        snapshots: 0,
        applyMs: { p50: 0, p95: 0 },
        rows: 0,
      },
      sentAt: 1,
    });
    expect(hub.stats.pageMs.p95).toBe(12);
  });

  it("stops talking to the worker once destroyed", () => {
    const p = port();
    const hub = new DataHub(p.fake);
    hub.destroy();
    hub.notice("aircraft", 1);
    expect(p.sent.map((m) => m.type)).toEqual(["stop"]);
    expect(p.terminated).toBe(true);
    expect(p.listeners.size).toBe(0);
  });
});
