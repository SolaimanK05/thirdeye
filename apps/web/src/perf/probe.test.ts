import { describe, expect, test } from "vitest";
import { installProbe, type ProbeHost, type ThirdEyePerf } from "./probe";

const probe: ThirdEyePerf = {
  snapshot: () => {
    throw new Error("not called");
  },
  project: () => ({ x: 1, y: 2 }),
  position: (moduleId, id) =>
    moduleId === "aircraft" && id === "a" ? { lon: 3, lat: 4 } : null,
  renderer: "canvas",
};

describe("installProbe", () => {
  test("publishes a frozen helper and removes it again", () => {
    const host: ProbeHost = {};
    const remove = installProbe(host, probe);
    expect(host.__thirdeyePerf?.project(0, 0)).toEqual({ x: 1, y: 2 });
    expect(host.__thirdeyePerf?.renderer).toBe("canvas");
    expect(host.__thirdeyePerf?.position("aircraft", "a")).toEqual({
      lon: 3,
      lat: 4,
    });
    expect(host.__thirdeyePerf?.position("aircraft", "b")).toBeNull();
    expect(Object.isFrozen(host.__thirdeyePerf)).toBe(true);
    remove();
    expect(host.__thirdeyePerf).toBeUndefined();
  });

  test("a stale cleanup does not remove a newer helper", () => {
    const host: ProbeHost = {};
    const removeFirst = installProbe(host, probe);
    const removeSecond = installProbe(host, { ...probe, renderer: "webgl2" });
    removeFirst();
    expect(host.__thirdeyePerf?.renderer).toBe("webgl2");
    removeSecond();
    expect(host.__thirdeyePerf).toBeUndefined();
  });

  test("the renderer reads live, so a fallback shows up", () => {
    const host: ProbeHost = {};
    let kind: "canvas" | "webgl2" = "webgl2";
    const remove = installProbe(host, {
      ...probe,
      get renderer() {
        return kind;
      },
    });
    expect(host.__thirdeyePerf?.renderer).toBe("webgl2");
    kind = "canvas";
    expect(host.__thirdeyePerf?.renderer).toBe("canvas");
    remove();
  });

  test("an untouched host has no helper", () => {
    const host: ProbeHost = {};
    expect(host.__thirdeyePerf).toBeUndefined();
  });
});
