import { describe, expect, test } from "vitest";
import type { WatchItem } from "@/api/client";
import { moduleInfo } from "@/api/test-data";
import {
  buildDomains,
  countStarred,
  effectiveFilter,
  starredTone,
  toRow,
  toStarred,
} from "./rail";

const quakes = moduleInfo("earthquakes", "USGS", { name: "Earthquakes" });

describe("effectiveFilter", () => {
  test("a chosen filter beats the server default", () => {
    expect(effectiveFilter({ earthquakes: "none" }, quakes)).toBe("none");
  });

  test("with no choice the server default applies", () => {
    expect(effectiveFilter({}, quakes)).toBe("all");
    expect(
      effectiveFilter({}, moduleInfo("x", "X", { default_filter: "none" })),
    ).toBe("none");
  });

  test("choices for other modules are ignored", () => {
    expect(effectiveFilter({ other: "none" }, quakes)).toBe("all");
  });
});

describe("toRow with capped layers", () => {
  test("carries the cap for the module and no other", () => {
    const caps = { earthquakes: { shown: 3, matched: 9 } };
    expect(toRow(quakes, {}, {}, caps).capped).toEqual({
      shown: 3,
      matched: 9,
    });
    const other = moduleInfo("wildfires", "NASA FIRMS");
    expect(toRow(other, {}, {}, caps).capped).toBeUndefined();
  });
});

describe("toRow", () => {
  test("maps the API module onto a rail row", () => {
    expect(toRow(quakes, {}, { earthquakes: 4 })).toEqual({
      id: "earthquakes",
      name: "Earthquakes",
      health: "fresh",
      zoomRange: [1, 4],
      filter: "all",
      loaded: 10,
      starredCount: 0,
      inView: 4,
      missingKey: undefined,
      failure: undefined,
      cooldownUntil: undefined,
      lastGood: "05:59:12Z",
    });
  });

  test("a cooldown carries the minute it ends", () => {
    const row = toRow(
      moduleInfo(
        "aircraft",
        "OpenSky",
        {},
        { state: "cooldown", cooldown_until: "2026-10-26T11:32:40Z" },
      ),
      {},
      {},
    );
    expect(row.health).toBe("cooldown");
    expect(row.cooldownUntil).toBe("11:32Z");
  });

  test("a missing key names the env var", () => {
    const row = toRow(
      moduleInfo(
        "wildfires",
        "FIRMS",
        { key_env: "FIRMS_MAP_KEY", requires_key: true },
        { state: "missing_key", fetched_at: null },
      ),
      {},
      {},
    );
    expect(row.health).toBe("missing-key");
    expect(row.missingKey).toBe("FIRMS_MAP_KEY");
    expect(row.lastGood).toBeUndefined();
  });

  test("a failure carries the reason", () => {
    const row = toRow(
      moduleInfo("x", "X", {}, { state: "failed", reason: "HTTP 503" }),
      {},
      {},
    );
    expect(row.health).toBe("failed");
    expect(row.failure).toBe("HTTP 503");
  });

  test("a module with no map layer has no zoom range", () => {
    expect(
      toRow(moduleInfo("x", "X", { zoom_range: null }), {}, {}).zoomRange,
    ).toBeNull();
  });
});

describe("buildDomains", () => {
  test("groups by domain in the order the API sent them", () => {
    const groups = buildDomains(
      [
        quakes,
        moduleInfo("fires", "FIRMS", { domain: "earth" }),
        moduleInfo("boats", "AIS", { domain: "movers" }),
        moduleInfo("grid", "OSM", { domain: "infrastructure" }),
      ],
      {},
      {},
    );
    expect(groups.map((g) => [g.label, g.modules.map((m) => m.id)])).toEqual([
      ["EARTH", ["earthquakes", "fires"]],
      ["MOVERS", ["boats"]],
      ["INFRASTRUCTURE", ["grid"]],
    ]);
  });

  test("modules that are not enabled are not listed", () => {
    const groups = buildDomains(
      [quakes, moduleInfo("off", "Off", { enabled: false, domain: "movers" })],
      {},
      {},
    );
    expect(groups.map((g) => g.label)).toEqual(["EARTH"]);
  });

  test("a module nobody has heard of still gets a row", () => {
    const groups = buildDomains(
      [moduleInfo("brand-new", "New", { name: "Brand New", domain: "street" })],
      {},
      {},
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("STREET");
    expect(groups[0].modules[0].name).toBe("Brand New");
  });

  test("nothing enabled gives no groups", () => {
    expect(buildDomains([], {}, {})).toEqual([]);
  });
});

describe("starred", () => {
  const item = (id: string, moduleId: string, lastSeen: string): WatchItem => ({
    entity_id: id,
    name: id.toUpperCase(),
    kind: "vessel",
    module_id: moduleId,
    added_at: "2026-10-14T00:00:00Z",
    last_seen: lastSeen,
    position: null,
  });
  const NOW = Date.parse("2026-10-14T06:00:00Z");

  test("counts per module", () => {
    expect(
      countStarred([
        item("a", "vessels", "2026-10-14T05:59:00Z"),
        item("b", "vessels", "2026-10-14T05:59:00Z"),
        item("c", "aircraft", "2026-10-14T05:59:00Z"),
      ]),
    ).toEqual({ vessels: 2, aircraft: 1 });
    expect(countStarred([])).toEqual({});
  });

  test("tone follows how long ago the entity was last seen", () => {
    expect(starredTone(59 * 60_000)).toBe("normal");
    expect(starredTone(60 * 60_000)).toBe("stale");
    expect(starredTone(24 * 60 * 60_000)).toBe("gap");
  });

  test("maps watchlist items to rail entries", () => {
    const [recent, old] = toStarred(
      [
        item("a", "vessels", "2026-10-14T05:50:00Z"),
        item("b", "mystery", "2026-10-12T06:00:00Z"),
      ],
      [{ id: "vessels", name: "Vessels" }],
      NOW,
    );
    expect(recent).toMatchObject({
      id: "a",
      moduleId: "vessels",
      module: "Vessels",
      age: "10 min ago",
      tone: "normal",
    });
    expect(old).toMatchObject({
      module: "mystery",
      age: "2 d ago",
      tone: "gap",
    });
  });

  test("a star that has not been looked up yet has no age", () => {
    const [entry] = toStarred(
      [
        {
          entity_id: "a",
          module_id: "ports",
          name: "A",
          position: null,
          last_seen: null,
        },
      ],
      [{ id: "ports", name: "Ports" }],
      NOW,
    );
    expect(entry).toMatchObject({ age: "no data", tone: "normal" });
  });

  test("toRow takes the starred count from the watchlist", () => {
    const module = moduleInfo("vessels", "AISStream");
    expect(toRow(module, {}, {}, {}, { vessels: 4 }).starredCount).toBe(4);
    expect(toRow(module, {}, {}).starredCount).toBe(0);
  });
});
