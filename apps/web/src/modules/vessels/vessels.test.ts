import { describe, expect, test } from "vitest";
import type { EntityDetail, EntityRow, FixOut } from "@/api/client";
import { passes, refineRows, resolveValues } from "../refine";
import { ENTITY_VIEWS, entitySelectionFor } from "../registry";
import { speedHistory } from "./history";
import { SHIP_TYPES, shipTypeOf, UNKNOWN_TYPE, vesselRefine } from "./refine";
import {
  FAR_DOT_SIZE,
  FULL_SIZE_AT,
  MIN_SIZE_AT,
  SHIP_FROM_SIZE,
  SHIP_MAX_SIZE,
  SHIP_MIN_SIZE,
  vesselHeading,
  vesselMarkers,
  vesselSizing,
} from "./render";
import {
  draughtLabel,
  navStatusLabel,
  shipTypeLabel,
  sizeLabel,
  vesselSelection,
} from "./selection";

const NOW = Date.parse("2026-10-27T10:00:00Z");

const ROW: EntityRow = {
  id: "c0000000-0000-4000-8000-000000000001",
  kind: "vessel",
  name: "EVER GIVEN",
  lon: 90.4,
  lat: 21.2,
  t: "2026-10-27T09:59:30Z",
  sog: 12.3,
  cog: 84.5,
  heading: 85,
  alt: null,
  confidence: "observed",
  attrs: { ship_type: "cargo", nav_status: 0 },
};

const DETAIL: EntityDetail = {
  id: ROW.id,
  kind: "vessel",
  names: ["EVER GIVEN"],
  identifiers: { mmsi: "353136000", imo: "9811000", callsign: "H3RC" },
  attrs: {
    flag: "Panama",
    ship_type: "cargo",
    nav_status: 0,
    length: 400,
    beam: 59,
    destination: "ROTTERDAM",
    eta: "11-02 06:00Z",
    draught: 14.5,
  },
  first_seen: "2026-10-27T08:00:00Z",
  last_seen: "2026-10-27T09:59:30Z",
  retrieved_at: "2026-10-27T09:59:35Z",
  last_observation: {
    t: "2026-10-27T09:59:30Z",
    position: { lon: 90.4, lat: 21.2 },
    sog: 12.3,
    cog: 84.5,
    alt: null,
    confidence: "observed",
  },
  source: {
    id: "aisstream",
    reliability: "B",
    licence: "AISStream terms of use",
  },
  provenance: {
    source: "AISStream",
    licence: "AISStream terms of use",
    limitations: ["AIS is self-reported."],
  },
} as unknown as EntityDetail;

const OPTIONS = { starred: false, canStar: true, canFollow: true };

describe("vessel markers", () => {
  test("points the ship along its heading, falling back to course", () => {
    expect(vesselHeading(ROW)).toBe(85);
    expect(vesselHeading({ ...ROW, heading: null })).toBe(84.5);
    expect(vesselHeading({ ...ROW, heading: null, cog: null })).toBe(0);
  });

  test("draws one adaptive ship marker per row once zoomed in", () => {
    const [marker] = vesselMarkers([ROW], { level: 3 });
    expect(marker).toMatchObject({
      id: ROW.id,
      glyph: "ship",
      entity: true,
      adaptive: true,
      rotation: 85,
      label: "EVER GIVEN",
    });
  });

  test("draws small fixed dots when the globe is far away", () => {
    for (const level of [1, 2] as const) {
      const [marker] = vesselMarkers([ROW], { level });
      expect(marker).toMatchObject({
        glyph: "dot",
        size: FAR_DOT_SIZE,
        adaptive: false,
      });
    }
    expect(vesselMarkers([ROW], { level: 4 })[0].glyph).toBe("ship");
  });

  test("shrinks ships as more come into view and turns them into dots", () => {
    expect(vesselSizing(1)).toEqual({ glyph: "ship", size: SHIP_MAX_SIZE });
    expect(vesselSizing(FULL_SIZE_AT)).toEqual({
      glyph: "ship",
      size: SHIP_MAX_SIZE,
    });
    const crowded = vesselSizing(MIN_SIZE_AT * 10);
    expect(crowded.glyph).toBe("dot");
    expect(crowded.size).toBeGreaterThan(0);
    let previous = Number.POSITIVE_INFINITY;
    for (const count of [50, 200, 800, 2000, 8000, 50_000]) {
      const { glyph, size } = vesselSizing(count);
      const shown = glyph === "ship" ? size : size / 0.7;
      expect(shown).toBeLessThanOrEqual(previous);
      previous = shown;
      if (glyph === "ship") expect(size).toBeGreaterThanOrEqual(SHIP_FROM_SIZE);
      expect(size).toBeGreaterThanOrEqual(SHIP_MIN_SIZE * 0.7 - 1);
    }
  });
});

describe("vessel refine", () => {
  const rows: EntityRow[] = [
    { ...ROW, id: "a", sog: 0, attrs: { ship_type: "tanker" } },
    { ...ROW, id: "b", sog: 14, attrs: { ship_type: "cargo" } },
    { ...ROW, id: "c", sog: null, attrs: {} },
    { ...ROW, id: "d", sog: 25, attrs: { ship_type: "high_speed" } },
  ];

  test("starts with every ship showing", () => {
    const values = resolveValues(vesselRefine.controls, {});
    const refined = refineRows(rows, vesselRefine, values, NOW);
    expect(refined.kept).toBe(rows.length);
  });

  test("maps types it has no filter for to other, and unknown to other", () => {
    expect(shipTypeOf(rows[3])).toBe(UNKNOWN_TYPE);
    expect(shipTypeOf(rows[2])).toBeNull();
    expect(SHIP_TYPES.map((type) => type.value)).toContain(UNKNOWN_TYPE);
  });

  test("filters by type and keeps ships of unknown type under other", () => {
    const only = (...types: string[]) =>
      refineRows(rows, vesselRefine, { type: types }, NOW).rows.map(
        (row) => row.id,
      );
    expect(only("tanker")).toEqual(["a"]);
    expect(only("cargo", "tanker")).toEqual(["a", "b"]);
    expect(only("other")).toEqual(["c", "d"]);
    expect(only()).toEqual([]);
  });

  test("filters by speed and hides ships with no speed once a floor is set", () => {
    const speed = (low: number, high: number) =>
      refineRows(rows, vesselRefine, { speed: [low, high] }, NOW).rows.map(
        (row) => row.id,
      );
    expect(speed(0, 30)).toEqual(["a", "b", "c", "d"]);
    expect(speed(1, 30)).toEqual(["b", "d"]);
    expect(speed(0, 14)).toEqual(["a", "b", "c"]);
    expect(speed(10, 20)).toEqual(["b"]);
  });

  test("keeps a selected ship whatever the filters say", () => {
    const refined = refineRows(
      rows,
      vesselRefine,
      { speed: [20, 30] },
      NOW,
      new Set(["a"]),
    );
    expect(refined.rows.map((row) => row.id)).toEqual(["a", "d"]);
  });

  test("passes a ship through its own readers", () => {
    const values = resolveValues(vesselRefine.controls, {});
    expect(passes(vesselRefine, values, ROW, NOW)).toBe(true);
  });
});

describe("vessel selection", () => {
  test("is registered as the vessels view", () => {
    expect(ENTITY_VIEWS.vessels).toBeDefined();
    expect(ENTITY_VIEWS.vessels.sizing).toBe(vesselSizing);
    expect(ENTITY_VIEWS.vessels.history).toBe(speedHistory);
    expect(entitySelectionFor("vessels", DETAIL, NOW, OPTIONS).kind).toBe(
      "VESSEL",
    );
  });

  test("lays out identity, telemetry and declared sections", () => {
    const selection = vesselSelection(DETAIL, NOW, OPTIONS);
    expect(selection.name).toBe("EVER GIVEN");
    expect(selection.subline).toBe("Cargo ship");
    expect(selection.actions).toEqual(["star", "follow", "center"]);
    expect(selection.sections.map((section) => section.label)).toEqual([
      "IDENTITY",
      "TELEMETRY",
      "DECLARED",
    ]);
    const identity = Object.fromEntries(
      selection.sections[0].rows.map((row) => [row.key, row]),
    );
    expect(identity.MMSI).toMatchObject({ value: "353136000" });
    expect(identity.IMO).toMatchObject({ value: "9811000" });
    expect(identity.FLAG).toMatchObject({ value: "Panama", confidence: "DER" });
    expect(identity.SIZE).toMatchObject({ value: "400 by 59 m" });
    const telemetry = Object.fromEntries(
      selection.sections[1].rows.map((row) => [row.key, row.value]),
    );
    expect(telemetry.STATUS).toBe("Under way using engine");
    expect(telemetry.SPEED).toBe("12.3 kn");
    expect(telemetry.COURSE).toBe("85°");
    const declared = Object.fromEntries(
      selection.sections[2].rows.map((row) => [row.key, row.value]),
    );
    expect(declared).toEqual({
      DESTINATION: "ROTTERDAM",
      ETA: "11-02 06:00Z",
      DRAUGHT: "14.5 m",
    });
    expect(selection.limitations).toEqual(["AIS is self-reported."]);
  });

  test("leaves out what the ship has not declared", () => {
    const bare = {
      ...DETAIL,
      identifiers: { mmsi: "353136000" },
      attrs: {},
      last_observation: null,
    } as unknown as EntityDetail;
    const selection = vesselSelection(bare, NOW, {
      ...OPTIONS,
      canFollow: true,
    });
    expect(selection.subline).toBe("Vessel");
    expect(selection.actions).toEqual(["star", "center"]);
    expect(selection.sections.map((section) => section.label)).toEqual([
      "IDENTITY",
      "TELEMETRY",
    ]);
    const telemetry = selection.sections[1].rows.map((row) => row.key);
    expect(telemetry).toEqual(["POSITION", "LAST FIX"]);
  });

  test("labels navigation status, type, size and draught", () => {
    expect(navStatusLabel(5)).toBe("Moored");
    expect(navStatusLabel(11)).toBeNull();
    expect(navStatusLabel("5")).toBeNull();
    expect(shipTypeLabel("tanker")).toBe("Tanker");
    expect(shipTypeLabel("mystery")).toBeNull();
    expect(sizeLabel(100, null)).toBe("100 m long");
    expect(sizeLabel(null, 20)).toBe("20 m wide");
    expect(sizeLabel(null, null)).toBeNull();
    expect(draughtLabel(7.25)).toBe("7.3 m");
    expect(draughtLabel(null)).toBeNull();
  });
});

describe("speed history", () => {
  const fix = (t: string, sog: number | null): FixOut => ({
    t,
    position: { lon: 0, lat: 0 },
    sog,
    cog: null,
    heading: null,
    alt: null,
    confidence: "observed",
  });

  test("turns fixes into a speed series, oldest first", () => {
    const chart = speedHistory([
      fix("2026-10-27T09:10:00Z", 5),
      fix("2026-10-27T09:00:00Z", 3),
      fix("2026-10-27T09:05:00Z", null),
    ]);
    expect(chart?.label).toBe("SPEED");
    expect(chart?.unit).toBe("kn");
    expect(chart?.points.map((point) => point.v)).toEqual([3, 5]);
  });

  test("has nothing to draw with fewer than two readings", () => {
    expect(speedHistory([])).toBeUndefined();
    expect(speedHistory([fix("2026-10-27T09:00:00Z", 3)])).toBeUndefined();
    expect(
      speedHistory([
        fix("2026-10-27T09:00:00Z", null),
        fix("2026-10-27T09:01:00Z", 3),
      ]),
    ).toBeUndefined();
  });

  test("skips fixes with an unreadable time", () => {
    const chart = speedHistory([
      fix("not a time", 3),
      fix("2026-10-27T09:00:00Z", 1),
      fix("2026-10-27T09:01:00Z", 2),
    ]);
    expect(chart?.points).toHaveLength(2);
  });
});
