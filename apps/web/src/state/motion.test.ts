import { beforeEach, describe, expect, test } from "vitest";
import {
  addPositionProbe,
  renderedPosition,
  setMotionProbe,
  useMotionStatus,
} from "./motion";

beforeEach(() => {
  useMotionStatus.setState({ modes: {} });
  setMotionProbe(null);
});

describe("motion status", () => {
  test("records the mode of a module", () => {
    useMotionStatus.getState().setMode("aircraft", "interpolated");
    expect(useMotionStatus.getState().modes).toEqual({
      aircraft: "interpolated",
    });
    useMotionStatus.getState().setMode("aircraft", "extrapolated");
    expect(useMotionStatus.getState().modes.aircraft).toBe("extrapolated");
  });

  test("removes a module when it has no mode", () => {
    useMotionStatus.getState().setMode("aircraft", "interpolated");
    useMotionStatus.getState().setMode("aircraft", null);
    expect(useMotionStatus.getState().modes).toEqual({});
  });

  test("setting the same thing again does not notify", () => {
    let calls = 0;
    const stop = useMotionStatus.subscribe(() => {
      calls += 1;
    });
    const { setMode } = useMotionStatus.getState();
    setMode("aircraft", "interpolated");
    setMode("aircraft", "interpolated");
    setMode("ports", null);
    stop();
    expect(calls).toBe(1);
  });
});

describe("the rendered position", () => {
  test("is unknown without a probe", () => {
    expect(renderedPosition("aircraft", "a")).toBeNull();
  });

  test("comes from the probe", () => {
    setMotionProbe((moduleId, id) =>
      moduleId === "aircraft" && id === "a" ? { lat: 1, lon: 2 } : null,
    );
    expect(renderedPosition("aircraft", "a")).toEqual({ lat: 1, lon: 2 });
    expect(renderedPosition("aircraft", "b")).toBeNull();
    setMotionProbe(null);
    expect(renderedPosition("aircraft", "a")).toBeNull();
  });

  test("also comes from added probes until they are removed", () => {
    const remove = addPositionProbe((moduleId, id) =>
      moduleId === "satellites" && id === "s" ? { lat: 3, lon: 4 } : null,
    );
    expect(renderedPosition("satellites", "s")).toEqual({ lat: 3, lon: 4 });
    expect(renderedPosition("satellites", "t")).toBeNull();
    remove();
    expect(renderedPosition("satellites", "s")).toBeNull();
  });

  test("the motion probe wins over an added one", () => {
    setMotionProbe(() => ({ lat: 1, lon: 1 }));
    const remove = addPositionProbe(() => ({ lat: 2, lon: 2 }));
    expect(renderedPosition("aircraft", "a")).toEqual({ lat: 1, lon: 1 });
    remove();
    setMotionProbe(null);
  });
});
