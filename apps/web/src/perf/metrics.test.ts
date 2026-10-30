import { describe, expect, test } from "vitest";
import { PerfMetrics, percentile, SERIES_CAP, WINDOW_MS } from "./metrics";

function clock(start = 0) {
  let value = start;
  return {
    now: () => value,
    set: (next: number) => {
      value = next;
    },
    advance: (ms: number) => {
      value += ms;
    },
  };
}

function runFrames(
  metrics: PerfMetrics,
  time: ReturnType<typeof clock>,
  count: number,
  interval: number,
) {
  for (let i = 0; i < count; i++) {
    metrics.frame(time.now());
    time.advance(interval);
  }
}

describe("percentile", () => {
  test("nearest rank on 1, 2 and 100 samples", () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([7], 50)).toBe(7);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([3, 9], 50)).toBe(3);
    expect(percentile([3, 9], 95)).toBe(9);
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(hundred, 50)).toBe(50);
    expect(percentile(hundred, 95)).toBe(95);
    expect(percentile(hundred, 100)).toBe(100);
  });
});

describe("PerfMetrics", () => {
  test("an empty store reports zeros", () => {
    const time = clock();
    const snapshot = new PerfMetrics({ now: time.now }).snapshot();
    expect(snapshot.fps).toBe(0);
    expect(snapshot.frameMs).toEqual({ p50: 0, p95: 0 });
    expect(snapshot.drawMs).toEqual({ p50: 0, p95: 0 });
    expect(snapshot.stepMs).toEqual({ p50: 0, p95: 0 });
    expect(snapshot.markers).toEqual({ drawn: 0, inView: 0 });
  });

  test("fps over a full window", () => {
    const time = clock();
    const metrics = new PerfMetrics({ now: time.now });
    runFrames(metrics, time, 600, 10);
    time.advance(-10);
    const snapshot = metrics.snapshot();
    expect(snapshot.fps).toBeCloseTo(100, 0);
    expect(snapshot.frameMs).toEqual({ p50: 10, p95: 10 });
  });

  test("fps over a partial window", () => {
    const time = clock(1000);
    const metrics = new PerfMetrics({ now: time.now });
    runFrames(metrics, time, 31, 20);
    time.advance(-20);
    expect(metrics.snapshot().fps).toBeCloseTo(50, 0);
  });

  test("fps falls when frames stop arriving", () => {
    const time = clock();
    const metrics = new PerfMetrics({ now: time.now });
    runFrames(metrics, time, 200, 10);
    const running = metrics.snapshot().fps;
    time.advance(3000);
    expect(metrics.snapshot().fps).toBeLessThan(running / 1.5);
    time.advance(WINDOW_MS);
    expect(metrics.snapshot().fps).toBe(0);
  });

  test("frame percentiles follow the slow frames", () => {
    const time = clock();
    const metrics = new PerfMetrics({ now: time.now });
    for (let i = 0; i < 100; i++) {
      metrics.frame(time.now());
      time.advance(i % 10 === 9 ? 100 : 16);
    }
    const { frameMs } = metrics.snapshot();
    expect(frameMs.p50).toBe(16);
    expect(frameMs.p95).toBe(100);
  });

  test("draw and step samples keep their own series", () => {
    const time = clock();
    const metrics = new PerfMetrics({ now: time.now });
    for (let i = 1; i <= 100; i++) {
      metrics.sample("draw", i);
      metrics.sample("step", i * 2);
      time.advance(10);
    }
    const snapshot = metrics.snapshot();
    expect(snapshot.drawMs).toEqual({ p50: 50, p95: 95 });
    expect(snapshot.stepMs).toEqual({ p50: 100, p95: 190 });
  });

  test("draws per second uses the span actually covered", () => {
    const time = clock();
    const metrics = new PerfMetrics({ now: time.now });
    for (let i = 0; i < 10; i++) {
      time.advance(100);
      metrics.sample("draw", 1);
    }
    expect(metrics.snapshot().drawsPerSecond).toBeCloseTo(10, 5);
  });

  test("samples older than the window expire", () => {
    const time = clock();
    const metrics = new PerfMetrics({ now: time.now });
    metrics.sample("draw", 500);
    time.advance(WINDOW_MS - 1);
    metrics.sample("draw", 1);
    expect(metrics.snapshot().drawMs.p95).toBe(500);
    time.advance(2);
    expect(metrics.snapshot().drawMs).toEqual({ p50: 1, p95: 1 });
    time.advance(WINDOW_MS);
    expect(metrics.snapshot().drawMs).toEqual({ p50: 0, p95: 0 });
  });

  test("a custom window length is honoured", () => {
    const time = clock();
    const metrics = new PerfMetrics({ now: time.now, windowMs: 1000 });
    metrics.sample("step", 9);
    time.advance(1001);
    expect(metrics.snapshot().stepMs.p50).toBe(0);
  });

  test("a series never holds more than the cap", () => {
    const time = clock();
    const metrics = new PerfMetrics({ now: time.now, windowMs: 1e12 });
    for (let i = 0; i < SERIES_CAP + 500; i++) {
      metrics.sample("draw", i);
      time.advance(0.001);
    }
    const snapshot = metrics.snapshot();
    expect(snapshot.drawsPerSecond * (time.now() / 1000)).toBeCloseTo(
      SERIES_CAP,
      0,
    );
    expect(snapshot.drawMs.p50).toBe(500 + SERIES_CAP / 2 - 1);
  });

  test("long tasks are null without browser support", () => {
    const time = clock();
    const metrics = new PerfMetrics({ now: time.now });
    metrics.longTask(0, 80);
    const snapshot = metrics.snapshot();
    expect(snapshot.longTasks).toBeNull();
    expect(snapshot.busyShare).toBeNull();
  });

  test("long tasks are counted and expire", () => {
    const time = clock();
    const metrics = new PerfMetrics({ now: time.now, longTasks: true });
    expect(metrics.snapshot().longTasks).toEqual({
      count: 0,
      worstMs: 0,
      totalMs: 0,
    });
    metrics.longTask(0, 80);
    time.advance(1000);
    metrics.longTask(1000, 120);
    const snapshot = metrics.snapshot();
    expect(snapshot.longTasks).toEqual({
      count: 2,
      worstMs: 120,
      totalMs: 200,
    });
    expect(snapshot.busyShare).toBeCloseTo(200 / WINDOW_MS, 6);
    time.advance(WINDOW_MS - 500);
    expect(metrics.snapshot().longTasks?.count).toBe(1);
  });

  test("the busy share never exceeds one", () => {
    const time = clock();
    const metrics = new PerfMetrics({ now: time.now, longTasks: true });
    metrics.longTask(0, WINDOW_MS * 3);
    expect(metrics.snapshot().busyShare).toBe(1);
  });

  test("marker counts are the latest report", () => {
    const time = clock();
    const metrics = new PerfMetrics({ now: time.now });
    metrics.markers(10, 20);
    metrics.markers(11, 22);
    expect(metrics.snapshot().markers).toEqual({ drawn: 11, inView: 22 });
  });

  test("a disabled store records nothing", () => {
    const time = clock();
    const metrics = new PerfMetrics({ now: time.now, enabled: false });
    metrics.frame(0);
    metrics.frame(16);
    metrics.sample("draw", 5);
    metrics.sample("step", 5);
    metrics.longTask(0, 90);
    metrics.markers(1, 2);
    const snapshot = metrics.snapshot();
    expect(snapshot.fps).toBe(0);
    expect(snapshot.drawMs.p50).toBe(0);
    expect(snapshot.markers).toEqual({ drawn: 0, inView: 0 });
  });

  test("enable starts from a clean slate and disable clears", () => {
    const time = clock();
    const metrics = new PerfMetrics({ now: time.now });
    metrics.sample("draw", 5);
    metrics.enable(true);
    expect(metrics.snapshot().drawMs.p50).toBe(0);
    expect(metrics.snapshot().longTasks).not.toBeNull();
    metrics.sample("draw", 5);
    metrics.disable();
    expect(metrics.enabled).toBe(false);
    expect(metrics.snapshot().drawMs.p50).toBe(0);
    expect(metrics.snapshot().longTasks).toBeNull();
  });
});
