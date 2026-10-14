import { describe, expect, test } from "vitest";
import type { ModuleInfo } from "@/api/client";
import { attributionLine, moduleStatusLines } from "./module-status";

function moduleInfo(
  id: string,
  attribution: string,
  overrides: Partial<ModuleInfo> = {},
  health: Partial<ModuleInfo["health"]> = {},
): ModuleInfo {
  return {
    id,
    name: id,
    domain: "earth",
    enabled: true,
    cadence_seconds: 60,
    zoom_range: { min: 1, max: 4 },
    requires_key: false,
    provenance: {
      source_id: id,
      source: id,
      licence: "open",
      attribution,
      freshness: "1 min",
      confidence: "observed",
      limitations: ["a", "b"],
    },
    health: {
      state: "fresh",
      fetched_at: "2026-10-14T05:59:12Z",
      record_count: 10,
      reason: null,
      stale_after_seconds: 180,
      ...health,
    },
    ...overrides,
  };
}

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
          moduleInfo("off", "Off", { enabled: false }),
        ],
        false,
      ),
    ).toEqual([
      { health: "fresh", text: "earthquakes 05:59:12Z" },
      { health: "stale", text: "aircraft stale, last 05:59:12Z" },
      { health: "failed", text: "ports failed 05:59:12Z" },
      { health: "empty", text: "fires waiting for first fetch" },
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
