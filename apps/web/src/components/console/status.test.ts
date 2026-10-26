import { describe, expect, test } from "vitest";
import {
  drawsAnything,
  everyModuleFilter,
  moduleNote,
  railCounts,
  rangeNote,
} from "./status";
import type { DomainGroup, ModuleRow } from "./types";

const quakes: ModuleRow = {
  id: "earthquakes",
  name: "Earthquakes",
  health: "fresh",
  zoomRange: [1, 4],
  filter: "all",
  loaded: 10,
  starredCount: 0,
};

const row = (id: string, changes: Partial<ModuleRow> = {}): ModuleRow => ({
  ...quakes,
  id,
  name: id,
  ...changes,
});

const SAMPLE_DOMAINS: DomainGroup[] = [
  {
    label: "EARTH",
    modules: [
      row("earthquakes"),
      row("wildfires", { health: "missing-key", zoomRange: [2, 4] }),
    ],
  },
  {
    label: "MOVERS",
    modules: [
      row("vessels", { zoomRange: [2, 4] }),
      row("aircraft", { zoomRange: [2, 4], health: "stale" }),
      row("satellites", { zoomRange: [1, 2] }),
    ],
  },
  { label: "INFRASTRUCTURE", modules: [row("ports", { zoomRange: [2, 4] })] },
];

describe("moduleNote for a layer cut down to its strongest rows", () => {
  const capped: ModuleRow = {
    ...quakes,
    zoomRange: [2, 4],
    capped: { shown: 3000, matched: 41230 },
  };

  test("says how many of how many are drawn", () => {
    expect(moduleNote(capped, 3)).toEqual({
      text: "top 3,000 of 41,230",
      tone: "ink-2",
    });
  });

  test("the usual states still win over it", () => {
    expect(moduleNote({ ...capped, filter: "none" }, 3).text).toBe("off");
    expect(moduleNote({ ...capped, health: "stale" }, 3).tone).toBe("amber");
    expect(moduleNote(capped, 1).text).toBe("hidden here");
  });
});

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

  test("Starred with nothing starred says so", () => {
    expect(moduleNote({ ...quakes, filter: "starred" }, 2)).toEqual({
      text: "nothing starred",
      tone: "ink-3",
    });
    expect(
      moduleNote({ ...quakes, filter: "starred", starredCount: 2 }, 2).text,
    ).toBe("auto, any zoom");
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
      text: "last good 11:21Z",
      tone: "amber",
    });
  });

  test("a cooldown shows when it ends and the last good time, in amber", () => {
    const row: ModuleRow = {
      ...quakes,
      health: "cooldown",
      lastGood: "11:21:07Z",
      cooldownUntil: "11:32Z",
    };
    expect(moduleNote(row, 2)).toEqual({
      text: "cooldown until 11:32Z, last good 11:21:07Z",
      tone: "amber",
    });
  });

  test("a cooldown before any good fetch has no last good time", () => {
    const row: ModuleRow = {
      ...quakes,
      health: "cooldown",
      loaded: 0,
      lastGood: "11:21:07Z",
      cooldownUntil: "11:32Z",
    };
    expect(moduleNote(row, 2).text).toBe("cooldown until 11:32Z");
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
    expect(railCounts(SAMPLE_DOMAINS, 2)).toEqual({ on: 5, drawn: 5 });
    expect(railCounts(SAMPLE_DOMAINS, 4)).toEqual({ on: 5, drawn: 4 });
    expect(railCounts(SAMPLE_DOMAINS, 1)).toEqual({ on: 5, drawn: 2 });
  });

  test("a module set to None is neither on nor drawn", () => {
    const domains = [
      { label: "EARTH", modules: [quakes, row("b", { filter: "none" })] },
    ];
    expect(railCounts(domains, 2)).toEqual({ on: 1, drawn: 1 });
  });

  test("Starred only counts as drawn once something is starred", () => {
    const starred = (count: number) => [
      {
        label: "EARTH",
        modules: [row("b", { filter: "starred", starredCount: count })],
      },
    ];
    expect(railCounts(starred(0), 2)).toEqual({ on: 1, drawn: 0 });
    expect(railCounts(starred(3), 2)).toEqual({ on: 1, drawn: 1 });
  });
});

describe("drawsAnything", () => {
  test("only All, or Starred with something starred, draws", () => {
    expect(drawsAnything(quakes)).toBe(true);
    expect(drawsAnything({ ...quakes, filter: "none" })).toBe(false);
    expect(drawsAnything({ ...quakes, filter: "starred" })).toBe(false);
    expect(
      drawsAnything({ ...quakes, filter: "starred", starredCount: 1 }),
    ).toBe(true);
    expect(drawsAnything({ ...quakes, health: "missing-key" })).toBe(false);
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
