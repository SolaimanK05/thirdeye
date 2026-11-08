import { beforeEach, describe, expect, test } from "vitest";
import { DAY_MS } from "@/motion/trail";
import { isLive, REPLAY_RATE, useReplay } from "./replay";

beforeEach(() => useReplay.getState().live());

describe("replay clock", () => {
  test("starts live", () => {
    expect(isLive(useReplay.getState())).toBe(true);
  });

  test("playing from live starts at the beginning of the 24 h", () => {
    useReplay.getState().play();
    expect(useReplay.getState()).toMatchObject({ back: DAY_MS, playing: true });
  });

  test("24 hours take 30 seconds", () => {
    expect(REPLAY_RATE).toBe(2880);
    useReplay.getState().play();
    useReplay.getState().tick(15_000);
    expect(useReplay.getState().back).toBe(DAY_MS / 2);
  });

  test("reaching now goes back to live and stops", () => {
    useReplay.getState().play();
    useReplay.getState().tick(31_000);
    expect(useReplay.getState()).toMatchObject({ back: 0, playing: false });
    expect(isLive(useReplay.getState())).toBe(true);
  });

  test("pausing keeps the place; playing again carries on from it", () => {
    useReplay.getState().scrubTo(DAY_MS / 4);
    useReplay.getState().play();
    expect(useReplay.getState().back).toBe(DAY_MS / 4);
    useReplay.getState().pause();
    useReplay.getState().tick(10_000);
    expect(useReplay.getState().back).toBe(DAY_MS / 4);
    expect(isLive(useReplay.getState())).toBe(false);
  });

  test("scrubbing is kept inside the 24 h", () => {
    useReplay.getState().scrubTo(DAY_MS * 3);
    expect(useReplay.getState().back).toBe(DAY_MS);
    useReplay.getState().scrubTo(-5);
    expect(useReplay.getState().back).toBe(0);
  });

  test("live drops any replay", () => {
    useReplay.getState().play();
    useReplay.getState().live();
    expect(isLive(useReplay.getState())).toBe(true);
  });
});
