import { describe, expect, test, vi } from "vitest";
import { type FrameScheduler, MOTION_HZ, MotionLoop } from "./loop";

function frames() {
  let next = 1;
  const pending = new Map<number, (timestamp: number) => void>();
  const scheduler: FrameScheduler = {
    request: (callback) => {
      const handle = next++;
      pending.set(handle, callback);
      return handle;
    },
    cancel: (handle) => {
      pending.delete(handle);
    },
  };
  const run = (timestamp: number) => {
    const queued = [...pending.entries()];
    pending.clear();
    for (const [, callback] of queued) callback(timestamp);
  };
  return { scheduler, run, pending };
}

function drive(
  run: (timestamp: number) => void,
  from: number,
  to: number,
  frameMs = 1000 / 60,
) {
  for (let t = from; t <= to; t += frameMs) run(t);
}

describe("the motion loop", () => {
  test("runs at about twelve steps a second on a sixty hertz display", () => {
    const { scheduler, run } = frames();
    const step = vi.fn(() => true);
    const loop = new MotionLoop({ step, frames: scheduler });
    expect(MOTION_HZ).toBe(12);
    loop.wake();
    drive(run, 0, 1000);
    expect(step.mock.calls.length).toBeGreaterThanOrEqual(11);
    expect(step.mock.calls.length).toBeLessThanOrEqual(13);
  });

  test("steps again no sooner than the interval", () => {
    const { scheduler, run } = frames();
    const stamps: number[] = [];
    const loop = new MotionLoop({
      step: (timestamp) => {
        stamps.push(timestamp);
        return true;
      },
      frames: scheduler,
    });
    loop.wake();
    drive(run, 0, 600);
    for (let i = 1; i < stamps.length; i++) {
      expect(stamps[i] - stamps[i - 1]).toBeGreaterThanOrEqual(1000 / 12 - 2);
    }
  });

  test("stops asking for frames once nothing moves", () => {
    const { scheduler, run, pending } = frames();
    const step = vi.fn(() => false);
    const loop = new MotionLoop({ step, frames: scheduler });
    loop.wake();
    expect(loop.running).toBe(true);
    run(0);
    expect(step).toHaveBeenCalledTimes(1);
    expect(loop.running).toBe(false);
    expect(pending.size).toBe(0);
  });

  test("starts again when woken", () => {
    const { scheduler, run } = frames();
    let moving = false;
    const step = vi.fn(() => moving);
    const loop = new MotionLoop({ step, frames: scheduler });
    loop.wake();
    run(0);
    expect(loop.running).toBe(false);
    moving = true;
    loop.wake();
    run(100);
    expect(step).toHaveBeenCalledTimes(2);
    expect(loop.running).toBe(true);
  });

  test("waking twice does not schedule twice", () => {
    const { scheduler, pending } = frames();
    const loop = new MotionLoop({ step: () => true, frames: scheduler });
    loop.wake();
    loop.wake();
    expect(pending.size).toBe(1);
  });

  test("stopping cancels the pending frame", () => {
    const { scheduler, run, pending } = frames();
    const step = vi.fn(() => true);
    const loop = new MotionLoop({ step, frames: scheduler });
    loop.wake();
    loop.stop();
    expect(pending.size).toBe(0);
    run(0);
    expect(step).not.toHaveBeenCalled();
    expect(loop.running).toBe(false);
  });

  test("stopping a loop that is not running does nothing", () => {
    const { scheduler } = frames();
    const loop = new MotionLoop({ step: () => true, frames: scheduler });
    expect(() => loop.stop()).not.toThrow();
  });

  test("a different rate can be chosen", () => {
    const { scheduler, run } = frames();
    const step = vi.fn(() => true);
    const loop = new MotionLoop({ step, frames: scheduler, hz: 4 });
    loop.wake();
    drive(run, 0, 1000);
    expect(step.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(step.mock.calls.length).toBeLessThanOrEqual(5);
  });

  test("the first step after a wake is not held back", () => {
    const { scheduler, run } = frames();
    const step = vi.fn(() => false);
    const loop = new MotionLoop({ step, frames: scheduler });
    loop.wake();
    run(5);
    loop.wake();
    run(10);
    expect(step).toHaveBeenCalledTimes(2);
  });
});
