import { describe, expect, test } from "vitest";
import type { EntityDetail } from "@/api/client";
import { entityName, entitySelection, identifierLabel } from "./entity";

const NOW = Date.parse("2026-10-14T06:05:00Z");

const VESSEL: EntityDetail = {
  id: "a0000000-0000-4000-8000-000000000001",
  kind: "vessel",
  names: ["EVER GIVEN", "EVERGIVEN"],
  identifiers: { mmsi: "353136000", imo: 9811000, flagged: false, empty: " " },
  attrs: {},
  first_seen: "2026-10-13T05:00:00Z",
  last_seen: "2026-10-14T05:55:00Z",
  retrieved_at: "2026-10-14T06:00:00Z",
  last_observation: {
    t: "2026-10-14T05:55:00Z",
    position: { lon: 32.5, lat: 30 },
    sog: 11.2,
    cog: 183.6,
    alt: null,
    confidence: "observed",
  },
  source: {
    id: "aisstream",
    url: "aisstream.io",
    licence: "Free tier",
    reliability: "aggregated",
  },
  provenance: {
    source_id: "aisstream",
    source: "AISStream live AIS feed",
    licence: "Free tier",
    attribution: "AISStream",
    freshness: "Seconds to minutes",
    confidence: "reported",
    limitations: ["Coverage depends on terrestrial receivers."],
  },
};

describe("entityName", () => {
  test("prefers the first name", () => {
    expect(entityName(VESSEL)).toBe("EVER GIVEN");
  });

  test("falls back to the first usable identifier, then the id", () => {
    expect(
      entityName({ ...VESSEL, names: [], identifiers: { x: " ", y: "abc" } }),
    ).toBe("abc");
    expect(entityName({ ...VESSEL, names: [], identifiers: {} })).toBe(
      VESSEL.id,
    );
  });
});

describe("identifierLabel", () => {
  test("known keys get their usual spelling, others are upper-cased", () => {
    expect(identifierLabel("mmsi")).toBe("MMSI");
    expect(identifierLabel("icao24")).toBe("ICAO24");
    expect(identifierLabel("tail_number")).toBe("TAIL NUMBER");
  });
});

describe("entitySelection", () => {
  const options = { starred: false, canStar: true };

  test("describes the entity", () => {
    const selection = entitySelection(VESSEL, NOW, options);
    expect(selection.kind).toBe("VESSEL");
    expect(selection.name).toBe("EVER GIVEN");
    expect(selection.subline).toBe("aisstream");
    const identity = selection.sections.find((s) => s.label === "IDENTITY");
    expect(identity?.rows.map((r) => [r.key, r.value])).toEqual([
      ["ALIAS", "EVERGIVEN"],
      ["MMSI", "353136000"],
      ["IMO", "9811000"],
      ["FLAGGED", "false"],
    ]);
    const track = selection.sections.find((s) => s.label === "TRACK");
    expect(track?.rows.map((r) => [r.key, r.value])).toEqual([
      ["LAST SEEN", "05:55:00Z, 10 min ago"],
      ["POSITION", "30.0°N 32.5°E"],
      ["COURSE", "184°"],
    ]);
    expect(selection.provenance.source).toBe("AISStream live AIS feed");
    expect(selection.limitations).toEqual([
      "Coverage depends on terrestrial receivers.",
    ]);
  });

  test("offers star and center when it can", () => {
    expect(entitySelection(VESSEL, NOW, options).actions).toEqual([
      "star",
      "center",
    ]);
  });

  test("hides star when the instance is read-only", () => {
    const selection = entitySelection(VESSEL, NOW, {
      starred: false,
      canStar: false,
    });
    expect(selection.actions).toEqual(["center"]);
  });

  test("an entity with no fix cannot be centred", () => {
    const selection = entitySelection(
      { ...VESSEL, last_observation: null, identifiers: {}, names: ["X"] },
      NOW,
      options,
    );
    expect(selection.actions).toEqual(["star"]);
    expect(selection.sections.map((s) => s.label)).toEqual(["TRACK"]);
    expect(
      selection.sections[0].rows.find((r) => r.key === "POSITION")?.value,
    ).toBe("no fix yet");
  });

  test("carries the starred state", () => {
    expect(
      entitySelection(VESSEL, NOW, { starred: true, canStar: true }).starred,
    ).toBe(true);
  });

  test("falls back to the source when provenance is missing", () => {
    const selection = entitySelection(
      { ...VESSEL, provenance: null },
      NOW,
      options,
    );
    expect(selection.provenance.source).toBe("aisstream");
    expect(selection.provenance.licence).toBe("Free tier");
    expect(selection.limitations).toEqual([]);
  });
});
