import { describe, expect, test } from "vitest";
import { geodeticToEcef, WGS84_RADII } from "./gpu/encode";
import type { ScreenPoint } from "./projection";
import {
  SCAN_EDGE_MARGIN,
  type ScanFrame,
  type ScanLayer,
  VisibilityScan,
} from "./visibility-scan";

const WIDTH = 1000;
const HEIGHT = 600;

function ringLayer(id: string, count: number, active = true): ScanLayer {
  const ecef = new Float64Array(count * 3);
  for (let i = 0; i < count; i++) {
    geodeticToEcef(((i * 37) % 360) - 180, ((i * 17) % 170) - 85, ecef, i * 3);
  }
  return { id, count, ecef, active };
}

function frameLooking(): ScanFrame {
  const eye = [0, 0, 3e7];
  return {
    width: WIDTH,
    height: HEIGHT,
    eyeScaled: eye.map((value, axis) => value / WGS84_RADII[axis]),
    project(x, y, _z, out: ScreenPoint) {
      out.x = x / 8000 + WIDTH / 2;
      out.y = y / 8000 + HEIGHT / 2;
      return true;
    },
  };
}

function brute(layer: ScanLayer, frame: ScanFrame) {
  const onScreen = new Uint8Array(layer.count);
  let inView = 0;
  const out: ScreenPoint = { x: 0, y: 0 };
  for (let i = 0; i < layer.count; i++) {
    const x = layer.ecef[i * 3];
    const y = layer.ecef[i * 3 + 1];
    const z = layer.ecef[i * 3 + 2];
    const scaled =
      (x / WGS84_RADII[0]) * frame.eyeScaled[0] +
      (y / WGS84_RADII[1]) * frame.eyeScaled[1] +
      (z / WGS84_RADII[2]) * frame.eyeScaled[2];
    if (scaled <= 1) continue;
    if (!frame.project(x, y, z, out)) continue;
    if (
      out.x < -SCAN_EDGE_MARGIN ||
      out.y < -SCAN_EDGE_MARGIN ||
      out.x > WIDTH + SCAN_EDGE_MARGIN ||
      out.y > HEIGHT + SCAN_EDGE_MARGIN
    ) {
      continue;
    }
    onScreen[i] = 1;
    inView++;
  }
  return { inView, onScreen };
}

function clock(stepMs: number) {
  let time = 0;
  return {
    now: () => {
      time += stepMs;
      return time;
    },
  };
}

function sweep(scan: VisibilityScan, layers: readonly ScanLayer[]) {
  let steps = 0;
  while (!scan.step(layers)) {
    steps++;
    if (steps > 100000) throw new Error("the sweep never finished");
  }
  return steps + 1;
}

describe("VisibilityScan", () => {
  test("counts equal a brute-force count and mark the same markers", () => {
    const frame = frameLooking();
    const layers = [ringLayer("a", 3000), ringLayer("b", 1200)];
    const scan = new VisibilityScan({ budgetMs: 1.5, ...clock(0.001) });
    scan.begin(frame, layers);
    sweep(scan, layers);
    for (const layer of layers) {
      const expected = brute(layer, frame);
      const found = scan.result().get(layer.id);
      expect(found?.inView).toBe(expected.inView);
      expect(Array.from(found?.onScreen ?? [])).toEqual(
        Array.from(expected.onScreen),
      );
    }
    expect(scan.result().get("a")?.inView).toBeGreaterThan(100);
  });

  test("stays inside its budget and still reaches the end", () => {
    const frame = frameLooking();
    const layers = [ringLayer("a", 1000)];
    const scan = new VisibilityScan({
      budgetMs: 3,
      checkEvery: 1,
      ...clock(1),
    });
    scan.begin(frame, layers);
    const steps = sweep(scan, layers);
    expect(steps).toBeGreaterThan(100);
    expect(steps).toBeLessThan(1000);
  });

  test("each call handles about the budget worth of markers", () => {
    const frame = frameLooking();
    const layer = ringLayer("a", 10000);
    let calls = 0;
    const scan = new VisibilityScan({
      budgetMs: 2,
      checkEvery: 1,
      now: () => {
        calls++;
        return calls;
      },
    });
    scan.begin(frame, [layer]);
    scan.step([layer]);
    expect(calls).toBeLessThanOrEqual(5);
    expect(scan.sweeping).toBe(true);
  });

  test("publishes only when a sweep completes", () => {
    const frame = frameLooking();
    const layers = [ringLayer("a", 2000)];
    const scan = new VisibilityScan({
      budgetMs: 1,
      checkEvery: 1,
      ...clock(0.1),
    });
    scan.begin(frame, layers);
    expect(scan.step(layers)).toBe(false);
    expect(scan.result().size).toBe(0);
    sweep(scan, layers);
    expect(scan.result().get("a")).toBeDefined();
    expect(scan.sweeping).toBe(false);
  });

  test("the previous result stays readable while the next sweep runs", () => {
    const frame = frameLooking();
    const layers = [ringLayer("a", 2000)];
    const scan = new VisibilityScan({
      budgetMs: 1,
      checkEvery: 1,
      ...clock(0.1),
    });
    scan.begin(frame, layers);
    sweep(scan, layers);
    const first = scan.result().get("a");
    scan.begin(frame, layers);
    scan.step(layers);
    expect(scan.result().get("a")).toBe(first);
  });

  test("a layer removed mid-sweep is left out of the result", () => {
    const frame = frameLooking();
    const a = ringLayer("a", 2000);
    const b = ringLayer("b", 2000);
    const scan = new VisibilityScan({
      budgetMs: 1,
      checkEvery: 1,
      ...clock(0.1),
    });
    scan.begin(frame, [a, b]);
    scan.step([a, b]);
    sweep(scan, [a]);
    expect(scan.result().has("a")).toBe(true);
    expect(scan.result().has("b")).toBe(false);
  });

  test("a layer added mid-sweep waits for the next sweep", () => {
    const frame = frameLooking();
    const a = ringLayer("a", 2000);
    const c = ringLayer("c", 500);
    const scan = new VisibilityScan({
      budgetMs: 1,
      checkEvery: 1,
      ...clock(0.1),
    });
    scan.begin(frame, [a]);
    scan.step([a]);
    sweep(scan, [a, c]);
    expect(scan.result().has("c")).toBe(false);
    scan.begin(frame, [a, c]);
    sweep(scan, [a, c]);
    expect(scan.result().get("c")?.inView).toBe(brute(c, frame).inView);
  });

  test("a layer replaced mid-sweep is scanned again from its start", () => {
    const frame = frameLooking();
    const before = ringLayer("a", 3000);
    const after = ringLayer("a", 1500);
    const scan = new VisibilityScan({
      budgetMs: 1,
      checkEvery: 1,
      ...clock(0.1),
    });
    scan.begin(frame, [before]);
    scan.step([before]);
    sweep(scan, [after]);
    const found = scan.result().get("a");
    expect(found?.onScreen.length).toBe(1500);
    expect(found?.inView).toBe(brute(after, frame).inView);
  });

  test("a hidden layer reports nothing in view", () => {
    const frame = frameLooking();
    const layers = [ringLayer("a", 1000, false)];
    const scan = new VisibilityScan({ budgetMs: 1.5, ...clock(0.001) });
    scan.begin(frame, layers);
    sweep(scan, layers);
    expect(scan.result().get("a")?.inView).toBe(0);
    expect(
      scan
        .result()
        .get("a")
        ?.onScreen.every((v) => v === 0),
    ).toBe(true);
  });

  test("an empty set of layers finishes at once", () => {
    const scan = new VisibilityScan({ budgetMs: 1, ...clock(0.1) });
    scan.begin(frameLooking(), []);
    expect(scan.step([])).toBe(true);
    expect(scan.result().size).toBe(0);
  });

  test("step does nothing when no sweep was begun", () => {
    const scan = new VisibilityScan({ budgetMs: 1, ...clock(0.1) });
    expect(scan.step([])).toBe(false);
  });

  test("a sweep covers every marker once", () => {
    const frame = frameLooking();
    let seen = 0;
    const counting: ScanFrame = {
      ...frame,
      project(x, y, z, out) {
        seen++;
        return frame.project(x, y, z, out);
      },
    };
    const layer = ringLayer("a", 4000);
    const horizon = brute(layer, {
      ...frame,
      project: (x, y, z, out) => frame.project(x, y, z, out),
    });
    const scan = new VisibilityScan({
      budgetMs: 0.5,
      checkEvery: 7,
      ...clock(0.1),
    });
    scan.begin(counting, [layer]);
    sweep(scan, [layer]);
    expect(seen).toBeGreaterThanOrEqual(horizon.inView);
    expect(seen).toBeLessThanOrEqual(layer.count);
    expect(scan.result().get("a")?.inView).toBe(horizon.inView);
  });
});
