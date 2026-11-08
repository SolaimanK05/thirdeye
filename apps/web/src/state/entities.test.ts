import { describe, expect, test, vi } from "vitest";
import type { EntityRow } from "@/api/client";
import { type EntityChange, EntityStore } from "./entities";

function row(id: string, lon = 1, t = "2026-10-26T10:00:00Z"): EntityRow {
  return {
    id,
    kind: "aircraft",
    name: id,
    lon,
    lat: 5,
    t,
    sog: null,
    cog: null,
    heading: null,
    alt: null,
    confidence: "observed",
    attrs: {},
  };
}

const T1 = "2026-10-26T10:00:00Z";
const T2 = "2026-10-26T10:01:30Z";
const T3 = "2026-10-26T10:03:00Z";

function ids(store: EntityStore, moduleId = "aircraft"): string[] {
  return (store.view(moduleId)?.rows ?? []).map((item) => item.id);
}

describe("snapshots", () => {
  test("an unknown module has no view", () => {
    const store = new EntityStore();
    expect(store.view("aircraft")).toBeUndefined();
    expect(store.has("aircraft")).toBe(false);
  });

  test("a snapshot replaces what was there", () => {
    const store = new EntityStore(() => 7);
    store.applySnapshot("aircraft", [row("a"), row("b")], T1, 1);
    store.applySnapshot("aircraft", [row("c")], T2, 2);
    expect(ids(store)).toEqual(["c"]);
    expect(store.view("aircraft")).toMatchObject({
      version: 2,
      source: "stream",
      updatedAt: 7,
      fetchedAtMs: Date.parse(T2),
    });
  });

  test("an older snapshot is ignored", () => {
    const store = new EntityStore();
    store.applySnapshot("aircraft", [row("new")], T2, 5);
    expect(store.applySnapshot("aircraft", [row("old")], T1, 6)).toBe(false);
    expect(ids(store)).toEqual(["new"]);
  });

  test("a snapshot with the same time replaces the rows and takes its version", () => {
    const store = new EntityStore();
    store.applySnapshot("aircraft", [row("a")], T1, 1);
    expect(store.applySnapshot("aircraft", [row("b")], T1, 1)).toBe(true);
    expect(ids(store)).toEqual(["b"]);
  });

  test("a snapshot after a server restart replaces higher versions", () => {
    const store = new EntityStore();
    store.applySnapshot("aircraft", [row("a")], T1, 40);
    store.applySnapshot("aircraft", [row("b")], T2, 1);
    expect(store.view("aircraft")?.version).toBe(1);
  });

  test("a module keeps its own rows", () => {
    const store = new EntityStore();
    store.applySnapshot("aircraft", [row("a")], T1, 1);
    store.applySnapshot("ports", [row("p")], T1, 1);
    expect(ids(store)).toEqual(["a"]);
    expect(ids(store, "ports")).toEqual(["p"]);
  });
});

describe("deltas", () => {
  test("upserts add and replace, removes delete", () => {
    const store = new EntityStore();
    store.applySnapshot("aircraft", [row("a", 1), row("b", 2)], T1, 1);
    store.applyDelta("aircraft", [row("a", 9), row("c", 3)], ["b"], T2, 2);
    const rows = store.view("aircraft")?.rows ?? [];
    expect(rows.map((item) => [item.id, item.lon])).toEqual([
      ["a", 9],
      ["c", 3],
    ]);
    expect(store.view("aircraft")?.version).toBe(2);
    expect(store.view("aircraft")?.fetchedAtMs).toBe(Date.parse(T2));
  });

  test("a delta without a snapshot is dropped", () => {
    const store = new EntityStore();
    expect(store.applyDelta("aircraft", [row("a")], [], T1, 1)).toBe(false);
    expect(store.has("aircraft")).toBe(false);
  });

  test("a duplicate or older version is dropped", () => {
    const store = new EntityStore();
    store.applySnapshot("aircraft", [row("a", 1)], T1, 4);
    expect(store.applyDelta("aircraft", [row("a", 2)], [], T2, 4)).toBe(false);
    expect(store.applyDelta("aircraft", [row("a", 3)], [], T2, 3)).toBe(false);
    expect(store.view("aircraft")?.rows[0]?.lon).toBe(1);
  });

  test("replayed deltas apply on top of a query seed", () => {
    const store = new EntityStore();
    store.seed("aircraft", [row("a", 1)], T1);
    expect(store.applyDelta("aircraft", [row("a", 2)], [], T2, 5)).toBe(true);
    expect(store.view("aircraft")?.rows[0]?.lon).toBe(2);
  });

  test("a delta never moves the fetch time backwards", () => {
    const store = new EntityStore();
    store.applySnapshot("aircraft", [row("a")], T2, 1);
    store.applyDelta("aircraft", [], [], T1, 2);
    expect(store.view("aircraft")?.fetchedAtMs).toBe(Date.parse(T2));
  });
});

describe("query seeds", () => {
  test("seed an empty store", () => {
    const store = new EntityStore();
    expect(store.seed("aircraft", [row("a")], T1)).toBe(true);
    expect(store.view("aircraft")).toMatchObject({
      source: "query",
      version: 0,
    });
  });

  test("a seed that is not newer than the stream is ignored", () => {
    const store = new EntityStore();
    store.applySnapshot("aircraft", [row("stream")], T2, 3);
    expect(store.seed("aircraft", [row("same")], T2)).toBe(false);
    expect(store.seed("aircraft", [row("older")], T1)).toBe(false);
    expect(ids(store)).toEqual(["stream"]);
  });

  test("a newer seed replaces the stream's rows and resets the version", () => {
    const store = new EntityStore();
    store.applySnapshot("aircraft", [row("stream")], T1, 9);
    expect(store.seed("aircraft", [row("poll")], T3)).toBe(true);
    expect(ids(store)).toEqual(["poll"]);
    expect(store.view("aircraft")?.version).toBe(0);
  });

  test("a seed with no time never replaces anything", () => {
    const store = new EntityStore();
    store.seed("aircraft", [row("first")], null);
    expect(store.seed("aircraft", [row("second")], null)).toBe(false);
    expect(ids(store)).toEqual(["first"]);
  });
});

describe("subscribing", () => {
  test("a listener hears each change to its module only", () => {
    const store = new EntityStore();
    const aircraft = vi.fn();
    const ports = vi.fn();
    store.subscribe("aircraft", aircraft);
    store.subscribe("ports", ports);
    store.applySnapshot("aircraft", [row("a")], T1, 1);
    store.applyDelta("aircraft", [row("a", 2)], [], T2, 2);
    expect(aircraft).toHaveBeenCalledTimes(2);
    expect(ports).not.toHaveBeenCalled();
  });

  test("the view only changes when the data does", () => {
    const store = new EntityStore();
    store.applySnapshot("aircraft", [row("a")], T1, 1);
    const first = store.view("aircraft");
    expect(store.view("aircraft")).toBe(first);
    store.applyDelta("aircraft", [row("a", 2)], [], T2, 2);
    expect(store.view("aircraft")).not.toBe(first);
  });

  test("an ignored change does not notify", () => {
    const store = new EntityStore();
    store.applySnapshot("aircraft", [row("a")], T2, 3);
    const listener = vi.fn();
    store.subscribe("aircraft", listener);
    store.applyDelta("aircraft", [row("a", 2)], [], T2, 3);
    store.applySnapshot("aircraft", [row("a", 3)], T1, 4);
    store.seed("aircraft", [row("a", 4)], T1);
    expect(listener).not.toHaveBeenCalled();
  });

  test("unsubscribing stops notifications", () => {
    const store = new EntityStore();
    const listener = vi.fn();
    const stop = store.subscribe("aircraft", listener);
    stop();
    store.applySnapshot("aircraft", [row("a")], T1, 1);
    expect(listener).not.toHaveBeenCalled();
  });

  test("observers see what changed", () => {
    const store = new EntityStore();
    const changes: EntityChange[] = [];
    store.observe((change) => changes.push(change));
    store.applySnapshot("aircraft", [row("a")], T1, 1);
    store.applyDelta("aircraft", [row("b")], ["a"], T2, 2);
    store.clear("aircraft");
    expect(
      changes.map((change) => [
        change.reset,
        change.upserts.map((item) => item.id),
        change.removes,
      ]),
    ).toEqual([
      [true, ["a"], []],
      [false, ["b"], ["a"]],
      [true, [], []],
    ]);
  });
});

describe("clearing", () => {
  test("clears one module or all", () => {
    const store = new EntityStore();
    store.applySnapshot("aircraft", [row("a")], T1, 1);
    store.applySnapshot("ports", [row("p")], T1, 1);
    store.clear("aircraft");
    expect(store.has("aircraft")).toBe(false);
    expect(store.has("ports")).toBe(true);
    store.clear();
    expect(store.has("ports")).toBe(false);
  });
});
