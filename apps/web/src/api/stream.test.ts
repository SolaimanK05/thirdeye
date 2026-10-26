import { describe, expect, test, vi } from "vitest";
import {
  type EventSourceLike,
  parseHello,
  parseLayerNotice,
  reconnectDelay,
  type StreamEventLike,
  type StreamStatus,
  startStream,
} from "./stream";

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;

class FakeSource implements EventSourceLike {
  readyState = CONNECTING;
  closed = false;
  private readonly listeners = new Map<
    string,
    ((event: StreamEventLike) => void)[]
  >();

  constructor(readonly url: string) {}

  addEventListener(
    type: string,
    listener: (event: StreamEventLike) => void,
  ): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
    this.readyState = CLOSED;
  }

  emit(type: string, data = ""): void {
    if (type === "hello") this.readyState = OPEN;
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }

  fail(permanent: boolean): void {
    this.readyState = permanent ? CLOSED : CONNECTING;
    this.emit("error");
  }
}

function hello(resumed: boolean): string {
  return JSON.stringify({
    server_time: "2026-10-26T10:00:00Z",
    instance: "thirdeye-local",
    resumed,
  });
}

function notice(moduleId: string): string {
  return JSON.stringify({ module_id: moduleId, fetched_at: null, version: 2 });
}

function setup(random = () => 0.5) {
  const sources: FakeSource[] = [];
  const statuses: StreamStatus[] = [];
  const layers: string[] = [];
  const resyncs = vi.fn();
  const timers: { callback: () => void; milliseconds: number; id: number }[] =
    [];
  const cleared: number[] = [];
  const stop = startStream({
    url: "http://api/v1/stream?entities=",
    onStatus: (status) => statuses.push(status),
    onLayer: (moduleId) => layers.push(moduleId),
    onResync: resyncs,
    connect: (url) => {
      const source = new FakeSource(url);
      sources.push(source);
      return source;
    },
    setTimer: (callback, milliseconds) => {
      const id = timers.length + 1;
      timers.push({ callback, milliseconds, id });
      return id;
    },
    clearTimer: (handle) => cleared.push(handle as number),
    random,
  });
  return { sources, statuses, layers, resyncs, timers, cleared, stop };
}

describe("parsing", () => {
  test("a hello needs a boolean resumed", () => {
    expect(parseHello(hello(true))).toEqual({ resumed: true });
    expect(parseHello(hello(false))).toEqual({ resumed: false });
    expect(parseHello('{"resumed":"yes"}')).toBeNull();
    expect(parseHello("not json")).toBeNull();
    expect(parseHello("[]")).toBeNull();
    expect(parseHello("null")).toBeNull();
  });

  test("a layer notice needs a module id", () => {
    expect(parseLayerNotice(notice("aircraft"))).toBe("aircraft");
    expect(parseLayerNotice('{"module_id":3}')).toBeNull();
    expect(parseLayerNotice("{")).toBeNull();
  });
});

describe("reconnect delay", () => {
  test("doubles from a second and stops at thirty", () => {
    const top = (failures: number) => reconnectDelay(failures, () => 1);
    expect(top(1)).toBe(1000);
    expect(top(2)).toBe(2000);
    expect(top(3)).toBe(4000);
    expect(top(6)).toBe(30_000);
    expect(top(50)).toBe(30_000);
  });

  test("jitter keeps it between half and the full ceiling", () => {
    expect(reconnectDelay(3, () => 0)).toBe(2000);
    expect(reconnectDelay(3, () => 0.5)).toBe(3000);
    expect(reconnectDelay(3, () => 1)).toBe(4000);
  });

  test("a failure count of zero or less behaves like the first", () => {
    expect(reconnectDelay(0, () => 1)).toBe(1000);
    expect(reconnectDelay(-4, () => 1)).toBe(1000);
  });
});

describe("the connection", () => {
  test("opens one source and starts out connecting", () => {
    const { sources, statuses } = setup();
    expect(sources).toHaveLength(1);
    expect(sources[0]?.url).toBe("http://api/v1/stream?entities=");
    expect(statuses).toEqual(["connecting"]);
  });

  test("is live once the hello arrives, not before", () => {
    const { sources, statuses } = setup();
    sources[0]?.emit("open");
    expect(statuses).toEqual(["connecting"]);
    sources[0]?.emit("hello", hello(false));
    expect(statuses).toEqual(["connecting", "live"]);
  });

  test("ignores a hello it cannot read", () => {
    const { sources, statuses } = setup();
    sources[0]?.emit("hello", "garbage");
    expect(statuses).toEqual(["connecting"]);
  });

  test("passes layer notices on by module", () => {
    const { sources, layers } = setup();
    sources[0]?.emit("hello", hello(false));
    sources[0]?.emit("layer", notice("aircraft"));
    sources[0]?.emit("layer", notice("earthquakes"));
    sources[0]?.emit("layer", "garbage");
    expect(layers).toEqual(["aircraft", "earthquakes"]);
  });

  test("the first hello never asks for a resync", () => {
    const { sources, resyncs } = setup();
    sources[0]?.emit("hello", hello(false));
    expect(resyncs).not.toHaveBeenCalled();
  });
});

describe("when the browser is retrying", () => {
  test("a dropped connection shows reconnecting and leaves the source alone", () => {
    const { sources, statuses, timers } = setup();
    sources[0]?.emit("hello", hello(false));
    sources[0]?.fail(false);
    expect(statuses).toEqual(["connecting", "live", "reconnecting"]);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.closed).toBe(false);
    expect(timers).toHaveLength(0);
  });

  test("a resumed hello after the drop goes live without a resync", () => {
    const { sources, statuses, resyncs } = setup();
    sources[0]?.emit("hello", hello(false));
    sources[0]?.fail(false);
    sources[0]?.emit("hello", hello(true));
    expect(statuses.at(-1)).toBe("live");
    expect(resyncs).not.toHaveBeenCalled();
  });

  test("a hello that was not resumed after the drop asks for a resync", () => {
    const { sources, resyncs } = setup();
    sources[0]?.emit("hello", hello(false));
    sources[0]?.fail(false);
    sources[0]?.emit("hello", hello(false));
    expect(resyncs).toHaveBeenCalledTimes(1);
  });
});

describe("when the browser gives up", () => {
  test("closes the source and schedules a fresh one", () => {
    const { sources, statuses, timers } = setup(() => 1);
    sources[0]?.fail(true);
    expect(statuses).toEqual(["connecting", "reconnecting"]);
    expect(sources[0]?.closed).toBe(true);
    expect(timers).toHaveLength(1);
    expect(timers[0]?.milliseconds).toBe(1000);
  });

  test("the new source takes over and the old one is ignored", () => {
    const { sources, statuses, layers, timers } = setup();
    sources[0]?.fail(true);
    timers[0]?.callback();
    expect(sources).toHaveLength(2);
    sources[0]?.emit("layer", notice("ghost"));
    sources[0]?.emit("hello", hello(false));
    expect(layers).toEqual([]);
    expect(statuses.at(-1)).toBe("reconnecting");
    sources[1]?.emit("hello", hello(false));
    expect(statuses.at(-1)).toBe("live");
  });

  test("backs off while it keeps failing and resets once live", () => {
    const { sources, timers } = setup(() => 1);
    sources[0]?.fail(true);
    timers[0]?.callback();
    sources[1]?.fail(true);
    timers[1]?.callback();
    sources[2]?.fail(true);
    expect(timers.map((timer) => timer.milliseconds)).toEqual([
      1000, 2000, 4000,
    ]);
    timers[2]?.callback();
    sources[3]?.emit("hello", hello(false));
    sources[3]?.fail(true);
    expect(timers.at(-1)?.milliseconds).toBe(1000);
  });

  test("a new source after losing the old one asks for a resync only if not resumed", () => {
    const { sources, timers, resyncs } = setup();
    sources[0]?.emit("hello", hello(false));
    sources[0]?.fail(true);
    timers[0]?.callback();
    sources[1]?.emit("hello", hello(false));
    expect(resyncs).toHaveBeenCalledTimes(1);
  });
});

describe("stopping", () => {
  test("closes the source and stays quiet afterwards", () => {
    const { sources, statuses, layers, stop } = setup();
    sources[0]?.emit("hello", hello(false));
    stop();
    expect(sources[0]?.closed).toBe(true);
    const seen = statuses.length;
    sources[0]?.emit("layer", notice("aircraft"));
    sources[0]?.fail(true);
    expect(statuses).toHaveLength(seen);
    expect(layers).toEqual([]);
  });

  test("cancels a pending reconnect", () => {
    const { sources, timers, cleared, stop } = setup();
    sources[0]?.fail(true);
    stop();
    expect(cleared).toEqual([timers[0]?.id]);
  });

  test("a reconnect that was already scheduled does not open a source after stop", () => {
    const { sources, timers, stop } = setup();
    sources[0]?.fail(true);
    stop();
    timers[0]?.callback();
    expect(sources).toHaveLength(1);
  });
});
