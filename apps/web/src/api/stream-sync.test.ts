import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vitest";

vi.hoisted(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
});

const { queryKeys } = await import("./queries");
const { streamHandlers, STREAM_PATH } = await import("./stream-sync");

function setup() {
  const client = new QueryClient();
  const aircraft = queryKeys.layer("aircraft", {
    bbox: "1,2,3,4",
    cell: null,
    minSeverity: 0,
  });
  const quakes = queryKeys.layer("earthquakes", null);
  for (const key of [aircraft, quakes, queryKeys.modules]) {
    client.setQueryData(key, { ok: true });
  }
  const stale = (key: readonly unknown[]) =>
    client.getQueryState(key)?.isInvalidated ?? false;
  const handlers = streamHandlers(client, vi.fn());
  return { client, aircraft, quakes, stale, handlers };
}

describe("stream handlers", () => {
  test("a layer notice invalidates that module's layer queries and the module list", () => {
    const { aircraft, quakes, stale, handlers } = setup();
    handlers.onLayer("aircraft");
    expect(stale(aircraft)).toBe(true);
    expect(stale(quakes)).toBe(false);
    expect(stale(queryKeys.modules)).toBe(true);
  });

  test("a resync invalidates every layer and the module list", () => {
    const { aircraft, quakes, stale, handlers } = setup();
    handlers.onResync();
    expect(stale(aircraft)).toBe(true);
    expect(stale(quakes)).toBe(true);
    expect(stale(queryKeys.modules)).toBe(true);
  });

  test("the status callback is passed straight through", () => {
    const onStatus = vi.fn();
    const handlers = streamHandlers(new QueryClient(), onStatus);
    handlers.onStatus("live");
    expect(onStatus).toHaveBeenCalledWith("live");
  });

  test("the stream path matches the API route", () => {
    expect(STREAM_PATH).toBe("/v1/stream");
  });
});
