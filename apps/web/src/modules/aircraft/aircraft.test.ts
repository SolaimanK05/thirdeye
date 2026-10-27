import { describe, expect, test } from "vitest";
import type { EntityDetail, EntityRow } from "@/api/client";
import { entitySelectionFor } from "../registry";
import {
  aircraftHeading,
  aircraftMarkers,
  aircraftSizing,
  FULL_SIZE_AT,
  MIN_SIZE_AT,
  PLANE_FROM_SIZE,
  PLANE_MAX_SIZE,
  PLANE_MIN_SIZE,
} from "./render";
import {
  aircraftSelection,
  altitudeLabel,
  categoryLabel,
  squawkLabel,
  verticalRateLabel,
} from "./selection";

const NOW = Date.parse("2026-10-26T11:22:00Z");

const ROW: EntityRow = {
  id: "b0000000-0000-4000-8000-000000000001",
  kind: "aircraft",
  name: "QTR8123",
  lon: 54.38,
  lat: 25.01,
  t: "2026-10-26T11:21:50Z",
  sog: 480,
  cog: 312.5,
  heading: null,
  alt: 11361,
  confidence: "observed",
  attrs: { on_ground: false, category: 6 },
};

const DETAIL: EntityDetail = {
  id: ROW.id,
  kind: "aircraft",
  names: ["QTR8123"],
  identifiers: { icao24: "06a0a1", callsign: "QTR8123" },
  attrs: {
    on_ground: false,
    category: 6,
    squawk: "7700",
    vertical_rate: 1.3,
    origin_country: "Qatar",
  },
  first_seen: "2026-10-26T11:00:00Z",
  last_seen: "2026-10-26T11:21:50Z",
  retrieved_at: "2026-10-26T11:21:55Z",
  last_observation: {
    t: "2026-10-26T11:21:50Z",
    position: { lon: 54.38, lat: 25.01 },
    sog: 480.4,
    cog: 312.5,
    alt: 11361.42,
    confidence: "observed",
  },
  source: {
    id: "opensky",
    url: "https://example.invalid/opensky",
    licence: "OpenSky terms of use",
    reliability: "aggregated",
  },
  provenance: {
    source_id: "opensky",
    source: "OpenSky Network",
    licence: "OpenSky terms of use",
    attribution: "OpenSky Network",
    freshness: "about every 90 seconds",
    confidence: "observed",
    limitations: ["Coverage has gaps.", "Not every aircraft is shown."],
  },
};

const OPTIONS = { starred: false, canStar: true };

describe("aircraftMarkers", () => {
  test("a flying aircraft is an adaptive plane pointing along its track", () => {
    const [marker] = aircraftMarkers([ROW]);
    expect(marker).toMatchObject({
      id: ROW.id,
      glyph: "plane",
      size: PLANE_MAX_SIZE,
      adaptive: true,
      rotation: 312.5,
      entity: true,
    });
  });

  test("the reported heading beats the track for the nose", () => {
    const [marker] = aircraftMarkers([{ ...ROW, heading: 100 }]);
    expect(marker.rotation).toBe(100);
    expect(aircraftHeading({ ...ROW, heading: null, cog: null })).toBe(0);
  });

  test("an aircraft on the ground is drawn exactly like one in the air", () => {
    const [flying] = aircraftMarkers([ROW]);
    const [parked] = aircraftMarkers([
      { ...ROW, alt: 0, attrs: { on_ground: true } },
    ]);
    expect(parked).toMatchObject({
      glyph: "plane",
      size: flying.size,
      adaptive: true,
      rotation: 312.5,
    });
  });

  test("labels are not drawn for every aircraft", () => {
    const [marker] = aircraftMarkers([ROW]);
    expect(marker.persistentLabel).toBeUndefined();
    expect(marker.label).toBe("QTR8123");
  });
});

describe("aircraftSizing", () => {
  test("a few aircraft get the largest plane", () => {
    for (const count of [0, 1, 40, FULL_SIZE_AT]) {
      expect(aircraftSizing(count)).toEqual({
        glyph: "plane",
        size: PLANE_MAX_SIZE,
      });
    }
  });

  test("thousands of aircraft shrink to the smallest dot", () => {
    for (const count of [MIN_SIZE_AT, 8019, 50_000]) {
      const sized = aircraftSizing(count);
      expect(sized.glyph).toBe("dot");
      expect(sized.size).toBe(Math.round(PLANE_MIN_SIZE * 0.6));
    }
  });

  test("planes get smaller as the count grows, never below the plane floor", () => {
    let previous = PLANE_MAX_SIZE + 1;
    for (const count of [150, 200, 300, 500, 800, 1200]) {
      const sized = aircraftSizing(count);
      expect(sized.glyph).toBe("plane");
      expect(sized.size).toBeLessThanOrEqual(previous);
      expect(sized.size).toBeGreaterThanOrEqual(PLANE_FROM_SIZE);
      previous = sized.size;
    }
  });

  test("the plane becomes a dot once it would be too small to read", () => {
    expect(aircraftSizing(1200).glyph).toBe("plane");
    expect(aircraftSizing(2000).glyph).toBe("dot");
  });

  test("the largest plane is bigger than the old fixed size", () => {
    expect(PLANE_MAX_SIZE).toBeGreaterThan(13);
  });
});

describe("labels", () => {
  test("categories use the published names", () => {
    expect(categoryLabel(6)).toBe("Heavy");
    expect(categoryLabel(8)).toBe("Rotorcraft");
    expect(categoryLabel(99)).toBe("Category 99");
    expect(categoryLabel(null)).toBeNull();
    expect(categoryLabel("6")).toBeNull();
  });

  test("emergency squawks are spelled out", () => {
    expect(squawkLabel("7700")).toBe("7700, general emergency");
    expect(squawkLabel("7600")).toBe("7600, radio failure");
    expect(squawkLabel("7500")).toBe("7500, unlawful interference");
    expect(squawkLabel("1200")).toBe("1200");
    expect(squawkLabel("")).toBeNull();
  });

  test("altitude shows metres and feet", () => {
    expect(altitudeLabel(10668)).toBe("10,668 m, 35,000 ft");
    expect(altitudeLabel(null)).toBeNull();
  });

  test("vertical speed carries its sign", () => {
    expect(verticalRateLabel(1.3)).toBe("+1.3 m/s");
    expect(verticalRateLabel(-7.15)).toBe("-7.2 m/s");
    expect(verticalRateLabel(0)).toBe("0.0 m/s");
    expect(verticalRateLabel(null)).toBeNull();
  });
});

describe("aircraftSelection", () => {
  const selection = aircraftSelection(DETAIL, NOW, OPTIONS);
  const rows = (label: string) =>
    selection.sections.find((s) => s.label === label)?.rows ?? [];
  const value = (label: string, key: string) =>
    rows(label).find((r) => r.key === key)?.value;

  test("names the aircraft by callsign", () => {
    expect(selection.kind).toBe("AIRCRAFT");
    expect(selection.name).toBe("QTR8123");
    expect(selection.subline).toBe("Heavy");
  });

  test("identity lists callsign, address, category, squawk and state", () => {
    expect(value("IDENTITY", "CALLSIGN")).toBe("QTR8123");
    expect(value("IDENTITY", "ICAO24")).toBe("06A0A1");
    expect(value("IDENTITY", "CATEGORY")).toBe("Heavy");
    expect(value("IDENTITY", "SQUAWK")).toBe("7700, general emergency");
    expect(value("IDENTITY", "ICAO STATE")).toBe("Qatar");
  });

  test("telemetry lists altitude, speed, track, climb and the last fix", () => {
    expect(value("TELEMETRY", "STATUS")).toBe("Airborne");
    expect(value("TELEMETRY", "ALTITUDE")).toBe("11,361 m, 37,275 ft");
    expect(value("TELEMETRY", "GROUND SPEED")).toBe("480 kn");
    expect(value("TELEMETRY", "TRACK")).toBe("313°");
    expect(value("TELEMETRY", "VERTICAL SPEED")).toBe("+1.3 m/s");
    expect(value("TELEMETRY", "LAST FIX")).toContain("11:21:50Z");
  });

  test("sensor values are tagged observed, the address is reported", () => {
    const telemetry = rows("TELEMETRY").find((r) => r.key === "ALTITUDE");
    expect(telemetry?.confidence).toBe("OBS");
    expect(rows("IDENTITY").find((r) => r.key === "ICAO24")?.confidence).toBe(
      "REP",
    );
  });

  test("on the ground there is no altitude or climb", () => {
    const grounded = aircraftSelection(
      { ...DETAIL, attrs: { ...DETAIL.attrs, on_ground: true } },
      NOW,
      OPTIONS,
    );
    const keys = grounded.sections.flatMap((s) => s.rows.map((r) => r.key));
    expect(keys).toContain("STATUS");
    expect(keys).not.toContain("ALTITUDE");
    expect(keys).not.toContain("VERTICAL SPEED");
  });

  test("without a callsign the address is the name", () => {
    const bare = aircraftSelection(
      {
        ...DETAIL,
        names: [],
        identifiers: { icao24: "06a0a1" },
      },
      NOW,
      OPTIONS,
    );
    expect(bare.name).toBe("06a0a1");
  });

  test("a cooling down source marks the retrieved line stale", () => {
    expect(selection.provenance.retrieved.endsWith("STALE")).toBe(false);
    const stale = aircraftSelection(DETAIL, NOW, { ...OPTIONS, stale: true });
    expect(stale.provenance.retrieved.endsWith(", STALE")).toBe(true);
  });

  test("offers star and center, and keeps the source limitations", () => {
    expect(selection.actions).toEqual(["star", "center"]);
    expect(selection.limitations).toHaveLength(2);
    expect(
      aircraftSelection(DETAIL, NOW, { starred: false, canStar: false })
        .actions,
    ).toEqual(["center"]);
  });

  test("offers follow only when the module moves and there is a fix", () => {
    const options = { ...OPTIONS, canFollow: true };
    expect(aircraftSelection(DETAIL, NOW, options).actions).toEqual([
      "star",
      "follow",
      "center",
    ]);
    expect(
      aircraftSelection({ ...DETAIL, last_observation: null }, NOW, options)
        .actions,
    ).toEqual(["star", "center"]);
    expect(selection.actions).not.toContain("follow");
  });

  test("shows whether it is following", () => {
    expect(selection.following).toBe(false);
    expect(
      aircraftSelection(DETAIL, NOW, { ...OPTIONS, following: true }).following,
    ).toBe(true);
  });

  test("the registry uses this panel for the aircraft module", () => {
    expect(entitySelectionFor("aircraft", DETAIL, NOW, OPTIONS).kind).toBe(
      "AIRCRAFT",
    );
    expect(entitySelectionFor("satellites", DETAIL, NOW, OPTIONS).kind).toBe(
      "AIRCRAFT",
    );
  });
});
