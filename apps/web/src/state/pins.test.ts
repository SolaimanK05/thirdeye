import { beforeEach, describe, expect, test } from "vitest";
import { useHere } from "./here";
import { usePins } from "./pins";

beforeEach(() => {
  usePins.setState({ pins: {} });
  useHere.setState({ counts: {} });
});

describe("pins", () => {
  test("pin remembers the level, unpin forgets it", () => {
    usePins.getState().pin("aircraft", 1);
    expect(usePins.getState().pins).toEqual({ aircraft: 1 });
    usePins.getState().pin("vessels", 4);
    usePins.getState().unpin("aircraft");
    expect(usePins.getState().pins).toEqual({ vessels: 4 });
  });

  test("repeating a pin or unpinning a stranger changes nothing", () => {
    usePins.getState().pin("aircraft", 1);
    const before = usePins.getState().pins;
    usePins.getState().pin("aircraft", 1);
    usePins.getState().unpin("ports");
    expect(usePins.getState().pins).toBe(before);
  });
});

describe("here counts", () => {
  test("set, replace and clear", () => {
    useHere.getState().setCount("satellites", 12);
    useHere.getState().setCount("ports", 0);
    expect(useHere.getState().counts).toEqual({ satellites: 12, ports: 0 });
    useHere.getState().setCount("satellites", 9);
    useHere.getState().setCount("ports", null);
    expect(useHere.getState().counts).toEqual({ satellites: 9 });
  });

  test("the same count keeps the same object", () => {
    useHere.getState().setCount("satellites", 3);
    const before = useHere.getState().counts;
    useHere.getState().setCount("satellites", 3);
    useHere.getState().setCount("vessels", null);
    expect(useHere.getState().counts).toBe(before);
  });
});
