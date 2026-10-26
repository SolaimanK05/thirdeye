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

  test("a cooling down module says until when and keeps its last good time", () => {
    const [line] = moduleStatusLines(
      [
        moduleInfo(
          "aircraft",
          "OpenSky",
          {},
          {
            state: "cooldown",
            fetched_at: "2026-10-26T11:21:07Z",
            cooldown_until: "2026-10-26T11:32:40Z",
          },
        ),
      ],
      false,
    );
    expect(line).toEqual({
      health: "cooldown",
      text: "aircraft cooldown until 11:32Z, last good 11:21:07Z",
    });
  });

  test("a cooldown with nothing fetched yet has no last good time", () => {
    const [line] = moduleStatusLines(
      [
        moduleInfo(
          "aircraft",
          "OpenSky",
          {},
          {
            state: "cooldown",
            record_count: 0,
            cooldown_until: "2026-10-26T11:32:40Z",
          },
        ),
      ],
      false,
    );
    expect(line.text).toBe("aircraft cooldown until 11:32Z");
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

describe("live stream status", () => {
  const quakes = moduleInfo("earthquakes", "USGS");

  test("a reconnecting stream adds a line above the modules", () => {
    expect(moduleStatusLines([quakes], false, "reconnecting")).toEqual([
      { health: "stale", text: "live stream reconnecting" },
      { health: "fresh", text: "earthquakes 05:59:12Z" },
    ]);
  });

  test("a live or connecting stream adds nothing", () => {
    for (const stream of ["live", "connecting"] as const) {
      expect(moduleStatusLines([quakes], false, stream)).toEqual([
        { health: "fresh", text: "earthquakes 05:59:12Z" },
      ]);
    }
  });

  test("an unreachable API is the only thing said", () => {
    expect(moduleStatusLines(undefined, true, "reconnecting")).toEqual([
      { health: "failed", text: "API unreachable" },
    ]);
  });

  test("nothing enabled stays the only line while reconnecting", () => {
    expect(moduleStatusLines([], false, "reconnecting")).toEqual([
      { health: "empty", text: "no modules enabled" },
    ]);
  });
});
