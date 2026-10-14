import { describe, expect, test } from "vitest";
import { moduleInfo } from "@/api/test-data";
import { buildDomains, effectiveFilter, toRow } from "./rail";

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
      lastGood: "05:59:12Z",
    });
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
