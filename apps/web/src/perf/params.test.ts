import { describe, expect, test } from "vitest";
import { BENCH_MAX, DEFAULT_FLAGS, readFlags } from "./params";

describe("readFlags", () => {
  test("an empty query turns everything off", () => {
    expect(readFlags("")).toEqual(DEFAULT_FLAGS);
    expect(readFlags("?")).toEqual(DEFAULT_FLAGS);
  });

  test("perf is on only for perf=1", () => {
    expect(readFlags("?perf=1").perf).toBe(true);
    expect(readFlags("?perf=0").perf).toBe(false);
    expect(readFlags("?perf=true").perf).toBe(false);
    expect(readFlags("?perf").perf).toBe(false);
  });

  test("bench takes a plain base-10 integer", () => {
    expect(readFlags("?bench=10000").bench).toBe(10_000);
    expect(readFlags("bench=200000").bench).toBe(200_000);
    expect(readFlags("?bench=0").bench).toBe(0);
    expect(readFlags("?bench=007").bench).toBe(7);
  });

  test("anything that is not all digits gives 0", () => {
    expect(readFlags("?bench=-5").bench).toBe(0);
    expect(readFlags("?bench=1e3").bench).toBe(0);
    expect(readFlags("?bench=12abc").bench).toBe(0);
    expect(readFlags("?bench=1.5").bench).toBe(0);
    expect(readFlags("?bench=").bench).toBe(0);
    expect(readFlags("?bench=%2B5").bench).toBe(0);
  });

  test("bench is clamped to the maximum", () => {
    expect(readFlags("?bench=1000001").bench).toBe(BENCH_MAX);
    expect(readFlags(`?bench=${"9".repeat(400)}`).bench).toBe(BENCH_MAX);
  });

  test("the first of a repeated key wins", () => {
    expect(readFlags("?bench=5&bench=9").bench).toBe(5);
    expect(readFlags("?perf=1&perf=0").perf).toBe(true);
    expect(readFlags("?perf=0&perf=1").perf).toBe(false);
  });

  test("renderer=canvas forces the 2D renderer and anything else is auto", () => {
    expect(readFlags("?renderer=canvas").renderer).toBe("canvas");
    expect(readFlags("?renderer=gpu").renderer).toBe("auto");
    expect(readFlags("?renderer=CANVAS").renderer).toBe("auto");
    expect(readFlags("").renderer).toBe("auto");
  });

  test("flags combine", () => {
    expect(
      readFlags("?perf=1&bench=50000&renderer=canvas&worker=0&synthetic=1"),
    ).toEqual({
      perf: true,
      bench: 50_000,
      renderer: "canvas",
      worker: false,
      synthetic: true,
    });
  });

  test("the worker path is on unless worker=0", () => {
    expect(readFlags("").worker).toBe(true);
    expect(readFlags("?worker=1").worker).toBe(true);
    expect(readFlags("?worker=0").worker).toBe(false);
    expect(readFlags("?worker=false").worker).toBe(true);
  });

  test("synthetic movers are drawn only for synthetic=1", () => {
    expect(readFlags("").synthetic).toBe(false);
    expect(readFlags("?synthetic=1").synthetic).toBe(true);
    expect(readFlags("?synthetic=true").synthetic).toBe(false);
  });
});
