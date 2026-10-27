import { describe, expect, test } from "vitest";
import type { EntityDetail, EntityRow } from "@/api/client";
import { entitySelectionFor } from "../registry";
import { LABEL_FROM_LEVEL, portMarkers, portSize } from "./render";
import { harborSizeLabel, harborTypeLabel, portSelection } from "./selection";

const NOW = Date.parse("2026-10-15T06:05:00Z");

const ROW: EntityRow = {
  id: "a0000000-0000-4000-8000-000000000001",
  kind: "facility",
  name: "Karachi",
  lon: 66.98,
  lat: 24.78,
  t: "2026-10-15T06:00:00Z",
  sog: null,
  cog: null,
  heading: null,
  alt: null,
  confidence: "reported",
  attrs: { harbor_size: "L" },
};

const PORT: EntityDetail = {
  id: ROW.id,
  kind: "facility",
  names: ["Karachi", "Port Karachi"],
  identifiers: { wpi: "48600", unlocode: "PKKHI" },
  attrs: {
    country_code: "PK",
    country: "Pakistan",
    region: "Arabian Sea",
    harbor_size: "L",
    harbor_type: "CN",
  },
  first_seen: "2026-10-15T05:00:00Z",
  last_seen: "2026-10-15T05:00:00Z",
  retrieved_at: "2026-10-15T05:00:00Z",
  last_observation: {
    t: "2026-10-15T05:00:00Z",
    position: { lon: 66.98, lat: 24.78 },
    sog: null,
    cog: null,
    alt: null,
    confidence: "reported",
  },
  source: {
    id: "nga-wpi",
    url: "https://example.invalid/wpi",
    licence: "Public domain",
    reliability: "primary",
  },
  provenance: {
    source_id: "nga-wpi",
    source: "NGA World Port Index",
    licence: "Public domain",
    attribution: "NGA",
    freshness: "Downloaded from the publisher once a week",
    confidence: "reported",
    limitations: ["Reference data.", "Not every port is listed."],
  },
};

describe("portSize", () => {
  test("larger harbours get larger squares", () => {
    expect(portSize("L")).toBeGreaterThan(portSize("M"));
    expect(portSize("M")).toBeGreaterThan(portSize("S"));
    expect(portSize("S")).toBeGreaterThan(portSize("V"));
  });

  test("squares shrink when the globe is zoomed out", () => {
    expect(portSize("L", 2)).toBeLessThan(portSize("L", 3));
    expect(portSize("L", 3)).toBeLessThan(portSize("L", 4));
    expect(portSize("V", 1)).toBeGreaterThanOrEqual(4);
  });

  test("unknown or missing sizes fall back to the small default", () => {
    expect(portSize("X")).toBe(portSize("S"));
    expect(portSize(undefined)).toBe(portSize("S"));
    expect(portSize(3)).toBe(portSize("S"));
  });
});

describe("portMarkers", () => {
  test("draws squares that select as entities", () => {
    const [marker] = portMarkers([ROW], { level: 2 });
    expect(marker).toMatchObject({
      id: ROW.id,
      glyph: "square",
      tone: "default",
      label: "Karachi",
      entity: true,
      lon: 66.98,
      lat: 24.78,
    });
  });

  test("names appear only from the local level", () => {
    const labelled = (level: 1 | 2 | 3 | 4) =>
      portMarkers([ROW], { level })[0].persistentLabel;
    expect(labelled(2)).toBe(false);
    expect(labelled(3)).toBe(false);
    expect(labelled(LABEL_FROM_LEVEL)).toBe(true);
  });
});

describe("harbour codes", () => {
  test("are spelled out and unknown codes are kept", () => {
    expect(harborSizeLabel("V")).toBe("Very small");
    expect(harborTypeLabel("OR")).toBe("Open roadstead");
    expect(harborTypeLabel("ZZ")).toBe("ZZ");
    expect(harborSizeLabel(" ")).toBeNull();
    expect(harborTypeLabel(undefined)).toBeNull();
  });
});

describe("portSelection", () => {
  const options = { starred: false, canStar: true };

  test("describes the port as a facility", () => {
    const selection = portSelection(PORT, NOW, options);
    expect(selection.kind).toBe("FACILITY");
    expect(selection.name).toBe("Karachi");
    expect(selection.subline).toBe("Pakistan (PK)");
    expect(selection.actions).toEqual(["star", "center"]);
    const [where, port] = selection.sections;
    expect(where.label).toBe("POSITION");
    expect(where.rows.map((r) => [r.key, r.value])).toEqual([
      ["POSITION", "24.8°N 67.0°E"],
      ["COUNTRY", "Pakistan (PK)"],
      ["REGION", "Arabian Sea"],
    ]);
    expect(port.label).toBe("PORT");
    expect(port.rows.map((r) => [r.key, r.value])).toEqual([
      ["WPI", "48600"],
      ["UN/LOCODE", "PKKHI"],
      ["HARBOUR SIZE", "Large"],
      ["HARBOUR TYPE", "Coastal, natural"],
      ["ALIAS", "Port Karachi"],
    ]);
    expect(selection.limitations).toEqual(PORT.provenance?.limitations);
    expect(selection.provenance.source).toBe("NGA World Port Index");
  });

  test("every value is reported, never observed", () => {
    const selection = portSelection(PORT, NOW, options);
    const tags = selection.sections.flatMap((s) =>
      s.rows.map((r) => r.confidence),
    );
    expect(new Set(tags)).toEqual(new Set(["REP"]));
  });

  test("leaves out what the file did not say", () => {
    const sparse: EntityDetail = {
      ...PORT,
      names: ["Karachi"],
      identifiers: { wpi: "48600" },
      attrs: {},
      last_observation: null,
    };
    const selection = portSelection(sparse, NOW, {
      starred: true,
      canStar: false,
    });
    expect(selection.subline).toBe("Port");
    expect(selection.starred).toBe(true);
    expect(selection.actions).toEqual(["center"]);
    expect(selection.sections[0].rows).toEqual([
      { key: "POSITION", value: "no position", confidence: "REP" },
    ]);
    expect(selection.sections[1].rows.map((r) => r.key)).toEqual(["WPI"]);
  });
});

describe("entitySelectionFor", () => {
  test("uses the port panel for ports and the generic one for the rest", () => {
    const options = { starred: false, canStar: true };
    expect(entitySelectionFor("ports", PORT, NOW, options).kind).toBe(
      "FACILITY",
    );
    expect(entitySelectionFor("satellites", PORT, NOW, options).kind).toBe(
      "FACILITY",
    );
    expect(
      entitySelectionFor("satellites", PORT, NOW, options).sections[0].label,
    ).toBe("IDENTITY");
  });
});
