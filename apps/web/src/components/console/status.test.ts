import { describe, expect, test } from "vitest";
import { SAMPLE } from "./sample";
import { everyModuleFilter, moduleNote, railCounts, rangeNote } from "./status";
import type { DomainGroup, ModuleRow } from "./types";

const quakes: ModuleRow = {
  id: "earthquakes",
  name: "Earthquakes",
  health: "fresh",
  zoomRange: [1, 4],
  filter: "all",
};

describe("moduleNote follows the SCREENS priority order", () => {
  test("missing key wins over everything", () => {
    const row: ModuleRow = {
      ...quakes,
      health: "missing-key",
      missingKey: "FIRMS_MAP_KEY",
      filter: "none",
    };
    expect(moduleNote(row, 2)).toEqual({
      text: "needs FIRMS_MAP_KEY",
      tone: "ink-3",
    });
  });

  test("a failed feed shows its reason in red", () => {
    const row: ModuleRow = {
      ...quakes,
      health: "failed",
      failure: "HTTP 503, retry 30s",
    };
    expect(moduleNote(row, 2)).toEqual({
      text: "HTTP 503, retry 30s",
      tone: "red",
    });
  });

  test("filter None reads off", () => {
    expect(moduleNote({ ...quakes, filter: "none" }, 2).text).toBe("off");
  });

  test("outside its zoom range it says hidden, with the count in view", () => {
    const row: ModuleRow = { ...quakes, zoomRange: [3, 4], inView: 3 };
    expect(moduleNote(row, 2)).toEqual({
      text: "hidden, 3 here",
      tone: "ink-2",
    });
    expect(moduleNote({ ...row, inView: 0 }, 1).text).toBe("hidden here");
  });

  test("stale shows the last good time in amber", () => {
    const row: ModuleRow = { ...quakes, health: "stale", lastGood: "11:21Z" };
    expect(moduleNote(row, 2)).toEqual({
      text: "cooldown, last 11:21Z",
      tone: "amber",
    });
  });

  test("normal shows when the module draws, in zoom percent", () => {
    expect(moduleNote(quakes, 2).text).toBe("auto, any zoom");
    expect(moduleNote({ ...quakes, zoomRange: null }, 2).text).toBe(
      "no map layer",
    );
  });
});

describe("rail summary", () => {
  const domains = (...modules: ModuleRow[]): DomainGroup[] => [
    { label: "EARTH", modules },
  ];

  test("every-module control reads MIXED when filters differ", () => {
    expect(everyModuleFilter(domains(quakes, { ...quakes, id: "b" }))).toBe(
      "all",
    );
    expect(
      everyModuleFilter(
        domains(quakes, { ...quakes, id: "b", filter: "starred" }),
      ),
    ).toBe("mixed");
  });

  test("modules without a key don't count towards the filter", () => {
    const keyless: ModuleRow = {
      ...quakes,
      id: "w",
      health: "missing-key",
      filter: "none",
    };
    expect(everyModuleFilter(domains(quakes, keyless))).toBe("all");
  });

  test("counts modules on and drawn at the current zoom", () => {
    expect(railCounts(SAMPLE.domains, 2)).toEqual({ on: 5, drawn: 5 });
    expect(railCounts(SAMPLE.domains, 4)).toEqual({ on: 5, drawn: 4 });
    expect(railCounts(SAMPLE.domains, 1)).toEqual({ on: 5, drawn: 2 });
  });
});

describe("rangeNote", () => {
  test("turns zoom levels into percentages", () => {
    expect(rangeNote([1, 4])).toBe("auto, any zoom");
    expect(rangeNote([2, 4])).toBe("auto from 60%");
    expect(rangeNote([1, 2])).toBe("auto to 199%");
    expect(rangeNote([3, 3])).toBe("auto 200–999%");
    expect(rangeNote([2, 3])).toBe("auto 60–999%");
  });
});
