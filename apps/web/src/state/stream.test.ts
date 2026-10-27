import { beforeEach, describe, expect, test } from "vitest";
import {
  serverNowMs,
  streamIsLive,
  useServerClock,
  useStreamStatus,
} from "./stream";

beforeEach(() => {
  useStreamStatus.setState({ status: "connecting" });
});

describe("stream status", () => {
  test("starts out connecting and is not live", () => {
    expect(useStreamStatus.getState().status).toBe("connecting");
    expect(streamIsLive(useStreamStatus.getState())).toBe(false);
  });

  test("only the live state counts as live", () => {
    const { setStatus } = useStreamStatus.getState();
    setStatus("live");
    expect(streamIsLive(useStreamStatus.getState())).toBe(true);
    setStatus("reconnecting");
    expect(streamIsLive(useStreamStatus.getState())).toBe(false);
  });

  test("setting the same status again does not notify subscribers", () => {
    let calls = 0;
    const unsubscribe = useStreamStatus.subscribe(() => {
      calls += 1;
    });
    const { setStatus } = useStreamStatus.getState();
    setStatus("live");
    setStatus("live");
    unsubscribe();
    expect(calls).toBe(1);
  });
});

describe("server clock", () => {
  beforeEach(() => {
    useServerClock.getState().reset();
  });

  test("starts unsynced with no offset", () => {
    expect(useServerClock.getState()).toMatchObject({
      offsetMs: 0,
      synced: false,
    });
    expect(serverNowMs(1000)).toBe(1000);
  });

  test("an offset moves the client clock onto the server's", () => {
    useServerClock.getState().sync(10_000, 4_000);
    expect(useServerClock.getState().synced).toBe(true);
    expect(serverNowMs(5_000)).toBe(11_000);
  });

  test("the latest hello wins, and a reset forgets it", () => {
    useServerClock.getState().sync(10_000, 4_000);
    useServerClock.getState().sync(20_000, 20_500);
    expect(serverNowMs(21_000)).toBe(20_500);
    useServerClock.getState().reset();
    expect(serverNowMs(21_000)).toBe(21_000);
  });
});
