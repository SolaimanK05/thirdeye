import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { EntityRow } from "./client";

vi.hoisted(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
});

const { queryKeys } = await import("./queries");
const { streamHandlers, STREAM_PATH } = await import("./stream-sync");
const { moduleInfo } = await import("./test-data");
const { EntityStore } = await import("@/state/entities");
const { useSelection } = await import("@/state/selection");
const { useServerClock } = await import("@/state/stream");

function plane(id: string, lon: number): EntityRow {
  return {
    id,
    kind: "aircraft",
    name: id,
    lon,
    lat: 10,
    t: "2026-10-26T10:00:00Z",
    sog: 400,
    cog: 90,
    heading: 90,
    alt: 9000,
    confidence: "observed",
    attrs: {},
  };
}

function setup() {
  const client = new QueryClient();
  const aircraft = queryKeys.layer("aircraft", null);
  const quakes = queryKeys.layer("earthquakes", null);
  client.setQueryData(queryKeys.modules, [
    moduleInfo("earthquakes", "USGS"),
    moduleInfo("aircraft", "OpenSky", { kind: "entities" }),
  ]);
  for (const key of [aircraft, quakes]) client.setQueryData(key, { ok: true });
  const stale = (key: readonly unknown[]) =>
    client.getQueryState(key)?.isInvalidated ?? false;
  const store = new EntityStore(() => 1000);
  const handlers = streamHandlers(client, vi.fn(), store);
  return { client, aircraft, quakes, stale, store, handlers };
}

beforeEach(() => {
  useSelection.setState({ selected: null });
});

describe("layer notices", () => {
  test("an event module's notice invalidates its layer and the module list", () => {
    const { aircraft, quakes, stale, handlers } = setup();
    handlers.onLayer("earthquakes");
    expect(stale(quakes)).toBe(true);
    expect(stale(aircraft)).toBe(false);
    expect(stale(queryKeys.modules)).toBe(true);
  });

  test("an entity module's notice leaves its layer to the deltas", () => {
    const { aircraft, stale, handlers } = setup();
    handlers.onLayer("aircraft");
    expect(stale(aircraft)).toBe(false);
    expect(stale(queryKeys.modules)).toBe(true);
  });

  test("a notice for a module that is not known yet refetches its layer", () => {
    const client = new QueryClient();
    const key = queryKeys.layer("aircraft", null);
    client.setQueryData(key, { ok: true });
    const handlers = streamHandlers(client, vi.fn(), new EntityStore());
    handlers.onLayer("aircraft");
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  });
});

describe("resync", () => {
  test("invalidates event layers but not entity layers, which a snapshot follows", () => {
    const { aircraft, quakes, stale, handlers } = setup();
    handlers.onResync();
    expect(stale(quakes)).toBe(true);
    expect(stale(aircraft)).toBe(false);
    expect(stale(queryKeys.modules)).toBe(true);
  });
});

describe("snapshots and deltas", () => {
  test("a snapshot fills the store", () => {
    const { store, handlers } = setup();
    handlers.onSnapshot?.({
      moduleId: "aircraft",
      fetchedAt: "2026-10-26T10:00:00Z",
      version: 3,
      entities: [plane("a", 1), plane("b", 2)],
    });
    expect(store.view("aircraft")?.rows.map((row) => row.id)).toEqual([
      "a",
      "b",
    ]);
    expect(store.view("aircraft")?.version).toBe(3);
  });

  test("a delta changes the store", () => {
    const { store, handlers } = setup();
    handlers.onSnapshot?.({
      moduleId: "aircraft",
      fetchedAt: "2026-10-26T10:00:00Z",
      version: 3,
      entities: [plane("a", 1), plane("b", 2)],
    });
    handlers.onDelta?.({
      moduleId: "aircraft",
      fetchedAt: "2026-10-26T10:01:30Z",
      version: 4,
      upserts: [plane("a", 5), plane("c", 6)],
      removes: ["b"],
    });
    const rows = store.view("aircraft")?.rows ?? [];
    expect(rows.map((row) => [row.id, row.lon])).toEqual([
      ["a", 5],
      ["c", 6],
    ]);
  });

  test("a delta for the selected entity refreshes its detail", () => {
    const { client, store, handlers } = setup();
    store.applySnapshot("aircraft", [plane("a", 1)], null, 1);
    client.setQueryData(queryKeys.entity("a"), { id: "a" });
    useSelection.setState({
      selected: { kind: "entity", id: "a", moduleId: "aircraft" },
    });
    handlers.onDelta?.({
      moduleId: "aircraft",
      fetchedAt: null,
      version: 2,
      upserts: [plane("a", 2)],
      removes: [],
    });
    expect(client.getQueryState(queryKeys.entity("a"))?.isInvalidated).toBe(
      true,
    );
  });

  test("a delta for something else leaves the selected detail alone", () => {
    const { client, store, handlers } = setup();
    store.applySnapshot("aircraft", [plane("a", 1)], null, 1);
    client.setQueryData(queryKeys.entity("a"), { id: "a" });
    useSelection.setState({
      selected: { kind: "entity", id: "a", moduleId: "aircraft" },
    });
    handlers.onDelta?.({
      moduleId: "aircraft",
      fetchedAt: null,
      version: 2,
      upserts: [plane("z", 2)],
      removes: [],
    });
    expect(client.getQueryState(queryKeys.entity("a"))?.isInvalidated).toBe(
      false,
    );
  });

  test("a duplicate delta changes nothing", () => {
    const { client, store, handlers } = setup();
    store.applySnapshot("aircraft", [plane("a", 1)], null, 5);
    client.setQueryData(queryKeys.entity("a"), { id: "a" });
    useSelection.setState({
      selected: { kind: "entity", id: "a", moduleId: "aircraft" },
    });
    handlers.onDelta?.({
      moduleId: "aircraft",
      fetchedAt: null,
      version: 5,
      upserts: [plane("a", 9)],
      removes: [],
    });
    expect(store.view("aircraft")?.rows[0]?.lon).toBe(1);
    expect(client.getQueryState(queryKeys.entity("a"))?.isInvalidated).toBe(
      false,
    );
  });

  test("the status callback is passed straight through", () => {
    const onStatus = vi.fn();
    const handlers = streamHandlers(new QueryClient(), onStatus);
    handlers.onStatus("live");
    expect(onStatus).toHaveBeenCalledWith("live");
  });

  test("the server time sets the clock offset", () => {
    const { handlers } = setup();
    useServerClock.getState().reset();
    const before = Date.now();
    handlers.onServerTime?.(before + 5000);
    expect(useServerClock.getState().synced).toBe(true);
    expect(Math.abs(useServerClock.getState().offsetMs - 5000)).toBeLessThan(
      200,
    );
    useServerClock.getState().reset();
  });

  test("the stream path matches the API route", () => {
    expect(STREAM_PATH).toBe("/v1/stream");
  });
});
