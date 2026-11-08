import { describe, expect, test } from "vitest";
import {
  canShowHere,
  drawsAnything,
  everyModuleFilter,
  inRange,
  isShown,
  moduleStatus,
  railCounts,
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

describe("moduleStatus for a layer cut down to its strongest rows", () => {
  const capped: ModuleRow = {
    ...quakes,
    zoomRange: [2, 4],
    capped: { shown: 3000, matched: 41230 },
  };

  test("says how many of how many are drawn", () => {
    expect(moduleStatus(capped, 3)).toEqual({
      text: "Showing top 3,000 of 41,230",
      state: "live",
    });
  });

  test("the usual states still win over it", () => {
    expect(moduleStatus({ ...capped, filter: "none" }, 3).text).toBe("Off");
    expect(moduleStatus({ ...capped, health: "stale" }, 3).state).toBe(
      "attention",
    );
    expect(moduleStatus(capped, 1).text).toBe("Hidden at this zoom");
  });
});

describe("moduleStatus follows the priority order, in plain words", () => {
  test("missing key wins over everything", () => {
    const row: ModuleRow = {
      ...quakes,
      health: "missing-key",
      missingKey: "FIRMS_MAP_KEY",
      filter: "none",
    };
    expect(moduleStatus(row, 2)).toEqual({
      text: "Needs FIRMS_MAP_KEY",
      state: "off",
    });
  });

  test("a failed feed is marked failed and keeps its reason for a tooltip", () => {
    const row: ModuleRow = {
      ...quakes,
      health: "failed",
      failure: "HTTP 503, retry 30s",
    };
    expect(moduleStatus(row, 2)).toEqual({
      text: "Feed failed, last data kept",
      state: "attention",
      failed: true,
      detail: "HTTP 503, retry 30s",
    });
  });

  test("filter None reads Off", () => {
    expect(moduleStatus({ ...quakes, filter: "none" }, 2)).toEqual({
      text: "Off",
      state: "off",
    });
  });

  test("Starred with nothing starred says so", () => {
    expect(moduleStatus({ ...quakes, filter: "starred" }, 2)).toEqual({
      text: "Nothing starred yet",
      state: "off",
    });
    expect(
      moduleStatus({ ...quakes, filter: "starred", starredCount: 2 }, 2).text,
    ).toBe("Up to date");
  });

  test("outside its zoom range it says hidden at this zoom", () => {
    const row: ModuleRow = { ...quakes, zoomRange: [3, 4], inView: 3 };
    expect(moduleStatus(row, 2)).toEqual({
      text: "Hidden at this zoom",
      state: "off",
    });
  });

  test("stale shows the time of the last good fetch", () => {
    const row: ModuleRow = { ...quakes, health: "stale", lastGood: "11:21Z" };
    expect(moduleStatus(row, 2)).toEqual({
      text: "Stale since 11:21Z",
      state: "attention",
    });
  });

  test("a cooldown shows when it ends and the last good time", () => {
    const row: ModuleRow = {
      ...quakes,
      health: "cooldown",
      lastGood: "11:21:07Z",
      cooldownUntil: "11:32Z",
    };
    expect(moduleStatus(row, 2)).toEqual({
      text: "Paused until 11:32Z, last good 11:21Z",
      state: "attention",
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
    expect(moduleStatus(row, 2).text).toBe("Paused until 11:32Z");
  });

  test("a healthy module in range is up to date; no map layer says so", () => {
    expect(moduleStatus(quakes, 2)).toEqual({
      text: "Up to date",
      state: "live",
    });
    expect(moduleStatus({ ...quakes, zoomRange: null }, 2).text).toBe(
      "No map layer",
    );
    expect(moduleStatus({ ...quakes, health: "empty" }, 2).state).toBe("off");
  });

  test("no line mentions the old range notes or lower-case jargon", () => {
    const rows: ModuleRow[] = [
      quakes,
      { ...quakes, zoomRange: [3, 4] },
      { ...quakes, health: "stale", lastGood: "11:21Z" },
      { ...quakes, filter: "none" },
    ];
    for (const entry of rows) {
      expect(moduleStatus(entry, 2).text).not.toMatch(/auto|cooldown|pinned/);
    }
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

describe("a module with its own zoom cap", () => {
  const capped: ModuleRow = {
    ...quakes,
    id: "satellites",
    zoomRange: [1, 3],
    maxPercent: 300,
  };

  test("is in range until the zoom is past the cap, and out of it beyond", () => {
    expect(inRange(capped, 3, false)).toBe(true);
    expect(inRange(capped, 3, true)).toBe(false);
    expect(inRange(capped, 4, false)).toBe(false);
    expect(inRange(capped, 3)).toBe(true);
  });

  test("names its own cap when it hides itself beyond it", () => {
    expect(moduleStatus(capped, 3, false).text).toBe("Up to date");
    expect(moduleStatus({ ...capped, inView: 1 }, 3, true).text).toBe(
      "Hidden above 300%",
    );
  });

  test("says starred are still shown while hidden with something starred", () => {
    const starred = { ...capped, starredCount: 2 };
    expect(moduleStatus(starred, 3, true).text).toBe(
      "Hidden above 300%, starred still shown",
    );
    expect(moduleStatus({ ...starred, filter: "starred" }, 3, true).text).toBe(
      "Hidden above 300%, starred still shown",
    );
  });

  test("counts as drawn only while inside the cap", () => {
    const domains = [{ label: "MOVERS", modules: [capped] }];
    expect(railCounts(domains, 3, new Set()).drawn).toBe(1);
    expect(railCounts(domains, 3, new Set(["satellites"])).drawn).toBe(0);
  });
});

describe("SHOW HERE", () => {
  const hidden: ModuleRow = { ...quakes, zoomRange: [3, 4] };

  test("a pinned module out of range says you are showing it", () => {
    expect(moduleStatus({ ...hidden, pinned: 3 }, 1)).toEqual({
      text: "Shown here by you",
      state: "live",
    });
  });

  test("a pinned module is shown although it is out of range", () => {
    expect(isShown(hidden, 1)).toBe(false);
    expect(isShown({ ...hidden, pinned: 1 }, 1)).toBe(true);
    expect(isShown({ ...hidden, pinned: 1, filter: "none" }, 1)).toBe(false);
  });

  test("the button is offered only to a module that is on but hidden", () => {
    expect(canShowHere(hidden, 1)).toBe(true);
    expect(canShowHere(hidden, 3)).toBe(false);
    expect(canShowHere({ ...hidden, pinned: 1 }, 1)).toBe(false);
    expect(canShowHere({ ...hidden, filter: "starred" }, 1)).toBe(false);
    expect(canShowHere({ ...hidden, filter: "none" }, 1)).toBe(false);
    expect(canShowHere({ ...hidden, health: "missing-key" }, 1)).toBe(false);
    expect(canShowHere({ ...hidden, zoomRange: null }, 1)).toBe(false);
  });

  test("past a module's own cap the button is offered too", () => {
    const sats: ModuleRow = { ...quakes, zoomRange: [1, 3] };
    expect(canShowHere(sats, 2)).toBe(false);
    expect(canShowHere(sats, 2, true)).toBe(true);
  });

  test("starred items stay shown while the rest is hidden", () => {
    expect(
      moduleStatus({ ...hidden, starredCount: 1, inView: 4 }, 1).text,
    ).toBe("Hidden at this zoom, starred still shown");
  });
});
