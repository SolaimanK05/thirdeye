import { describe, expect, test } from "vitest";
import type { EntityRow } from "@/api/client";
import {
  type Fix,
  fixFromRow,
  HISTORY_SIZE,
  MotionHistory,
  pushFix,
} from "./history";

function fix(t: number, lon = t): Fix {
  return { t, lon, lat: 0, sog: null, cog: null, track: null };
}

const times = (fixes: readonly Fix[]) => fixes.map((f) => f.t);

describe("the ring buffer", () => {
  test("keeps fixes in time order whatever order they arrive in", () => {
    let fixes: readonly Fix[] = [];
    for (const t of [30, 10, 50, 20, 40]) fixes = pushFix(fixes, fix(t));
    expect(times(fixes)).toEqual([10, 20, 30, 40, 50]);
  });

  test("holds only the last five and drops the oldest", () => {
    let fixes: readonly Fix[] = [];
    for (let t = 1; t <= 8; t++) fixes = pushFix(fixes, fix(t));
    expect(HISTORY_SIZE).toBe(5);
    expect(times(fixes)).toEqual([4, 5, 6, 7, 8]);
  });

  test("a fix older than everything in a full buffer is ignored", () => {
    let fixes: readonly Fix[] = [];
    for (let t = 10; t <= 50; t += 10) fixes = pushFix(fixes, fix(t));
    const next = pushFix(fixes, fix(5));
    expect(next).toBe(fixes);
    expect(times(next)).toEqual([10, 20, 30, 40, 50]);
  });

  test("an old fix still fits when the buffer has room", () => {
    const fixes = pushFix([fix(20), fix(30)], fix(10));
    expect(times(fixes)).toEqual([10, 20, 30]);
  });

  test("a fix with the same time replaces the earlier one", () => {
    const first = pushFix([fix(10), fix(20)], { ...fix(20), lon: 99 });
    expect(times(first)).toEqual([10, 20]);
    expect(first[1].lon).toBe(99);
  });

  test("an identical repeat changes nothing", () => {
    const fixes = [fix(10), fix(20)];
    expect(pushFix(fixes, fix(20))).toBe(fixes);
  });

  test("does not change the array it was given", () => {
    const fixes = [fix(10), fix(30)];
    pushFix(fixes, fix(20));
    expect(times(fixes)).toEqual([10, 30]);
  });

  test("the size can be changed", () => {
    let fixes: readonly Fix[] = [];
    for (let t = 1; t <= 4; t++) fixes = pushFix(fixes, fix(t), 2);
    expect(times(fixes)).toEqual([3, 4]);
  });
});

function row(overrides: Partial<EntityRow> = {}): EntityRow {
  return {
    id: "a",
    kind: "aircraft",
    name: "A",
    lon: 10,
    lat: 20,
    t: "2026-10-26T10:00:00Z",
    sog: 400,
    cog: 80,
    heading: 85,
    alt: null,
    confidence: "observed",
    attrs: {},
    ...overrides,
  };
}

describe("fixes from rows", () => {
  test("carry the position, motion and time", () => {
    expect(fixFromRow(row())).toEqual({
      t: Date.parse("2026-10-26T10:00:00Z"),
      lon: 10,
      lat: 20,
      sog: 400,
      cog: 80,
      track: 85,
    });
  });

  test("the reported track falls back to the course", () => {
    expect(fixFromRow(row({ heading: null }))?.track).toBe(80);
    expect(fixFromRow(row({ heading: null, cog: null }))?.track).toBeNull();
  });

  test("a row without a readable time makes no fix", () => {
    expect(fixFromRow(row({ t: "later" }))).toBeNull();
  });
});

describe("the history", () => {
  test("records, reads and forgets per entity", () => {
    const history = new MotionHistory();
    history.record("a", fix(10));
    history.record("a", fix(5));
    history.record("b", fix(1));
    expect(times(history.get("a") ?? [])).toEqual([5, 10]);
    expect(history.size).toBe(2);
    history.forget("a");
    expect(history.get("a")).toBeUndefined();
    expect(history.size).toBe(1);
  });

  test("keeps only the entities it is told to retain", () => {
    const history = new MotionHistory();
    for (const id of ["a", "b", "c"]) history.record(id, fix(1));
    history.retain(new Set(["b"]));
    expect(history.get("a")).toBeUndefined();
    expect(history.get("b")).toBeDefined();
    expect(history.get("c")).toBeUndefined();
  });

  test("clears everything", () => {
    const history = new MotionHistory();
    history.record("a", fix(1));
    history.clear();
    expect(history.size).toBe(0);
  });
});
