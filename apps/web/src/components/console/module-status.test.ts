import { describe, expect, test } from "vitest";
import { moduleInfo } from "@/api/test-data";
import { attributionLine, moduleStatusLines } from "./module-status";

describe("attribution", () => {
  test("lists enabled modules once each, with commas", () => {
    expect(
      attributionLine([
        moduleInfo("earthquakes", "USGS"),
        moduleInfo("wildfires", "NASA FIRMS"),
        moduleInfo("tsunamis", "USGS"),
        moduleInfo("vessels", "AISStream.io", { enabled: false }),
      ]),
    ).toBe("Data: USGS, NASA FIRMS");
  });

  test("nothing enabled means no line", () => {
    expect(
      attributionLine([moduleInfo("x", "X", { enabled: false })]),
    ).toBeNull();
  });
});

describe("module status lines", () => {
  test("one line per enabled module with its health", () => {
    expect(
      moduleStatusLines(
        [
          moduleInfo("earthquakes", "USGS"),
          moduleInfo("aircraft", "OpenSky", {}, { state: "stale" }),
          moduleInfo("ports", "WPI", {}, { state: "failed" }),
          moduleInfo(
            "fires",
            "FIRMS",
            {},
            { state: "pending", fetched_at: null },
          ),
          moduleInfo(
            "wildfires",
            "FIRMS",
            { requires_key: true, key_env: "FIRMS_MAP_KEY" },
            { state: "missing_key", fetched_at: null },
          ),
          moduleInfo("off", "Off", { enabled: false }),
        ],
        false,
      ),
    ).toEqual([
      { health: "fresh", text: "earthquakes 05:59:12Z" },
      { health: "stale", text: "aircraft stale, last 05:59:12Z" },
      { health: "failed", text: "ports failed 05:59:12Z" },
      { health: "empty", text: "fires waiting for first fetch" },
      { health: "missing-key", text: "wildfires needs FIRMS_MAP_KEY" },
    ]);
  });

  test("API down and loading states", () => {
    expect(moduleStatusLines(undefined, true)).toEqual([
      { health: "failed", text: "API unreachable" },
    ]);
    expect(moduleStatusLines(undefined, false)).toEqual([
      { health: "empty", text: "connecting to API" },
    ]);
    expect(moduleStatusLines([], false)).toEqual([
      { health: "empty", text: "no modules enabled" },
    ]);
  });
});
