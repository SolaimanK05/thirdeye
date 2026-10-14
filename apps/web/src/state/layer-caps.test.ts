import { beforeEach, describe, expect, test } from "vitest";
import { useLayerCaps } from "./layer-caps";
import { useViewport } from "./viewport";

beforeEach(() => {
  useLayerCaps.setState({ caps: {} });
  useViewport.setState({ box: null });
});

describe("layer caps", () => {
  test("remembers what a module was cut down to", () => {
    useLayerCaps
      .getState()
      .setCap("wildfires", { shown: 3000, matched: 41230 });
    expect(useLayerCaps.getState().caps).toEqual({
      wildfires: { shown: 3000, matched: 41230 },
    });
  });

  test("clearing a module leaves the others alone", () => {
    const { setCap } = useLayerCaps.getState();
    setCap("wildfires", { shown: 3000, matched: 41230 });
    setCap("ships", { shown: 10, matched: 20 });
    setCap("wildfires", null);
    expect(useLayerCaps.getState().caps).toEqual({
      ships: { shown: 10, matched: 20 },
    });
  });

  test("setting the same value again does not change the state object", () => {
    const { setCap } = useLayerCaps.getState();
    setCap("wildfires", { shown: 3000, matched: 41230 });
    const before = useLayerCaps.getState().caps;
    setCap("wildfires", { shown: 3000, matched: 41230 });
    setCap("ships", null);
    expect(useLayerCaps.getState().caps).toBe(before);
  });
});

describe("viewport store", () => {
  test("the same box does not notify again", () => {
    const { setBox } = useViewport.getState();
    setBox({ west: 1, south: 2, east: 3, north: 4 });
    const before = useViewport.getState().box;
    setBox({ west: 1, south: 2, east: 3, north: 4 });
    expect(useViewport.getState().box).toBe(before);
    setBox(null);
    expect(useViewport.getState().box).toBeNull();
  });
});
