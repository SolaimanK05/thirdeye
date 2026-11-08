import { describe, expect, it } from "vitest";
import {
  CANVAS_DEFAULT_LIMIT,
  DRAW_LIMIT_MAX,
  defaultLimit,
  limitRows,
  parseLimit,
  resolveLimit,
  sanitiseLimits,
  selectTop,
} from "./draw-limit";

const keysOf = (values: number[]) => (index: number) => values[index];
const nobody = () => false;

function picked(mask: Uint8Array | null, count: number): number[] {
  if (mask === null) return Array.from({ length: count }, (_, index) => index);
  return [...mask].flatMap((on, index) => (on === 1 ? [index] : []));
}

describe("parseLimit", () => {
  it("reads plain numbers, commas and spaces", () => {
    expect(parseLimit("2000")).toBe(2000);
    expect(parseLimit(" 12,500 ")).toBe(12_500);
    expect(parseLimit("1 000")).toBe(1000);
  });

  it("reads ALL in any case as no limit", () => {
    expect(parseLimit("all")).toBeNull();
    expect(parseLimit("ALL")).toBeNull();
  });

  it("refuses anything that is not a positive whole number", () => {
    for (const text of ["", "0", "-5", "1.5", "abc", "10k", "∞"]) {
      expect(parseLimit(text)).toBeUndefined();
    }
  });

  it("caps absurd numbers", () => {
    expect(parseLimit("99999999999")).toBe(DRAW_LIMIT_MAX);
  });
});

describe("saved limits", () => {
  it("keeps only valid entries", () => {
    expect(
      sanitiseLimits({ a: 5000, b: null, c: 0, d: 1.5, e: "x", f: 2e9 }),
    ).toEqual({ a: 5000, b: null });
    expect(sanitiseLimits(null)).toEqual({});
    expect(sanitiseLimits([1, 2])).toEqual({});
  });

  it("falls back to the renderer's default only when nothing was chosen", () => {
    expect(defaultLimit("webgl2")).toBeNull();
    expect(defaultLimit("canvas")).toBe(CANVAS_DEFAULT_LIMIT);
    expect(resolveLimit({}, "aircraft", "canvas")).toBe(CANVAS_DEFAULT_LIMIT);
    expect(resolveLimit({ aircraft: null }, "aircraft", "canvas")).toBeNull();
    expect(resolveLimit({ aircraft: 5000 }, "aircraft", "webgl2")).toBe(5000);
  });
});

describe("selectTop", () => {
  it("draws everything when it fits", () => {
    expect(selectTop(3, keysOf([1, 2, 3]), nobody, 3)).toBeNull();
    expect(selectTop(3, keysOf([1, 2, 3]), nobody, 10)).toBeNull();
  });

  it("keeps the highest keys", () => {
    const mask = selectTop(5, keysOf([5, 1, 9, 3, 7]), nobody, 2);
    expect(picked(mask, 5)).toEqual([2, 4]);
  });

  it("gives ties to the earlier index and never exceeds the limit", () => {
    const mask = selectTop(6, keysOf([4, 4, 4, 4, 4, 4]), nobody, 3);
    expect(picked(mask, 6)).toEqual([0, 1, 2]);
    const mixed = selectTop(6, keysOf([9, 4, 4, 4, 8, 4]), nobody, 3);
    expect(picked(mixed, 6)).toEqual([0, 1, 4]);
  });

  it("ranks missing keys last", () => {
    const mask = selectTop(
      4,
      keysOf([Number.NaN, 1, Number.NaN, 2]),
      nobody,
      2,
    );
    expect(picked(mask, 4)).toEqual([1, 3]);
  });

  it("always keeps forced candidates, even the least important", () => {
    const mask = selectTop(5, keysOf([9, 8, 7, 1, 0]), (i) => i === 4, 2);
    expect(picked(mask, 5)).toEqual([0, 4]);
  });

  it("lets forced candidates exceed the limit rather than drop one", () => {
    const mask = selectTop(5, keysOf([9, 8, 7, 1, 0]), (i) => i >= 2, 2);
    expect(picked(mask, 5)).toEqual([2, 3, 4]);
  });

  it("gives the same answer every time", () => {
    const keys = Array.from({ length: 500 }, (_, i) => (i * 7919) % 101);
    const first = selectTop(500, keysOf(keys), nobody, 123);
    const second = selectTop(500, keysOf(keys), nobody, 123);
    expect([...(first ?? [])]).toEqual([...(second ?? [])]);
    expect(picked(first, 500)).toHaveLength(123);
  });

  it("matches a full sort on random data", () => {
    let seed = 12345;
    const next = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed;
    };
    for (const spread of [3, 50, 100_000]) {
      const keys = Array.from({ length: 400 }, () => next() % spread);
      const limit = 97;
      const expected = keys
        .map((key, index) => ({ key, index }))
        .sort((a, b) => b.key - a.key || a.index - b.index)
        .slice(0, limit)
        .map((entry) => entry.index)
        .sort((a, b) => a - b);
      expect(picked(selectTop(400, keysOf(keys), nobody, limit), 400)).toEqual(
        expected,
      );
    }
  });
});

describe("limitRows", () => {
  const rows = [
    { id: "a", rank: 1 },
    { id: "b", rank: 5 },
    { id: "c", rank: 3 },
    { id: "d", rank: 4 },
  ];
  const rank = (row: { rank: number }) => row.rank;

  it("passes everything through when there is no limit", () => {
    expect(limitRows(rows, null, rank)).toEqual({ rows, drawn: 4 });
  });

  it("keeps the most important rows in their original order", () => {
    const limited = limitRows(rows, 2, rank);
    expect(limited.rows.map((row) => row.id)).toEqual(["b", "d"]);
    expect(limited.drawn).toBe(2);
  });

  it("keeps starred and selected rows whatever their rank", () => {
    const limited = limitRows(rows, 2, rank, new Set(["a"]));
    expect(limited.rows.map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("falls back to row order when a module has no ranking", () => {
    const limited = limitRows(rows, 2, undefined);
    expect(limited.rows.map((row) => row.id)).toEqual(["a", "b"]);
  });
});
