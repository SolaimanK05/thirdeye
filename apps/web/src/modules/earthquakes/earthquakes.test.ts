import { describe, expect, test } from "vitest";
import { selectionFor } from "../registry";
import { NOTABLE_MAGNITUDE, quakeMarkers, quakeSize } from "./render";
import { quakeSelection } from "./selection";
import { QUAKE_DETAIL, quakeRow } from "./test-data";

const NOW = Date.parse("2026-10-14T06:05:00Z");

describe("quake markers", () => {
  test("size grows with magnitude and stays readable", () => {
    expect(quakeSize(null)).toBe(8);
    expect(quakeSize(-0.5)).toBe(8);
    expect(quakeSize(2.5)).toBe(13);
    expect(quakeSize(5)).toBe(18);
    expect(quakeSize(9.5)).toBe(24);
  });

  test("M5 and above are notable, the rest default", () => {
    const [small, edge, big, unknown] = quakeMarkers([
      quakeRow("earthquakes:a", 4.9),
      quakeRow("earthquakes:b", NOTABLE_MAGNITUDE),
      quakeRow("earthquakes:c", 6.1),
      quakeRow("earthquakes:d", null),
    ]);
    expect([small.tone, edge.tone, big.tone, unknown.tone]).toEqual([
      "default",
      "notable",
      "notable",
      "default",
    ]);
    expect(big).toMatchObject({
      id: "earthquakes:c",
      glyph: "triangle",
      label: "M6.1",
      lon: 90,
      lat: 23,
    });
    expect(unknown.label).toBe("M?");
  });
});

describe("quake selection", () => {
  const selection = quakeSelection(QUAKE_DETAIL, NOW);
  const rows = Object.fromEntries(
    selection.sections[0].rows.map((row) => [row.key, row]),
  );

  test("names the quake by magnitude and region", () => {
    expect(selection.kind).toBe("EVENT");
    expect(selection.name).toBe("M5.2 29 km SW of Falam, Myanmar");
    expect(selection.subline).toBe("Earthquake, reviewed");
    expect(selection.actions).toEqual(["center"]);
  });

  test("details carry values and confidence tags", () => {
    expect(rows.MAGNITUDE).toEqual({
      key: "MAGNITUDE",
      value: "5.2 mww",
      confidence: "OBS",
    });
    expect(rows.DEPTH.value).toBe("10.0 km");
    expect(rows.ORIGIN.value).toBe("05:50:12Z 14 OCT");
    expect(rows.POSITION.value).toBe("22.4°N 93.3°E");
    expect(rows.REGION).toMatchObject({ confidence: "DER" });
    expect(rows.FELT).toMatchObject({ value: "3 reports", confidence: "REP" });
    expect(rows.TSUNAMI).toBeUndefined();
  });

  test("provenance shows source, retrieved time and every limitation", () => {
    expect(selection.provenance).toEqual({
      source:
        "USGS Earthquake Hazards Program, real-time GeoJSON feed (past day)",
      retrieved: "05:52:04Z, 12 min ago",
      reliability: "primary",
      licence: "Public domain (US Government work)",
    });
    expect(selection.limitations).toEqual(QUAKE_DETAIL.provenance?.limitations);
  });

  test("missing values say so instead of breaking", () => {
    const bare = quakeSelection(
      { ...QUAKE_DETAIL, severity: null, attrs: {}, provenance: null },
      NOW,
    );
    expect(bare.name).toBe("M? Earthquake");
    expect(bare.subline).toBe("Earthquake");
    const values = Object.fromEntries(
      bare.sections[0].rows.map((row) => [row.key, row.value]),
    );
    expect(values.MAGNITUDE).toBe("not reported");
    expect(values.DEPTH).toBe("not reported");
    expect(bare.provenance.source).toBe("usgs-earthquakes");
    expect(bare.limitations).toEqual([]);
  });

  test("a single felt report is singular", () => {
    const one = quakeSelection(
      { ...QUAKE_DETAIL, attrs: { ...QUAKE_DETAIL.attrs, felt: 1 } },
      NOW,
    );
    const felt = one.sections[0].rows.find((row) => row.key === "FELT");
    expect(felt?.value).toBe("1 report");
  });

  test("unknown modules fall back to a position panel", () => {
    const generic = selectionFor(
      { ...QUAKE_DETAIL, module_id: "mystery", category: "flood" },
      NOW,
    );
    expect(generic.name).toBe("flood");
    expect(generic.sections[0].label).toBe("POSITION");
  });
});
