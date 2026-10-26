import { beforeEach, describe, expect, test } from "vitest";
import { streamIsLive, useStreamStatus } from "./stream";

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
