import { describe, expect, test } from "vitest";
import { MODULE_VIEWS, selectionFor } from "../registry";
import { fireMarkers, fireSize, powerLabel } from "./render";
import { fireSelection } from "./selection";
import { FIRE_DETAIL, fireRow } from "./test-data";

const NOW = Date.parse("2026-10-14T09:12:00Z");

describe("fire markers", () => {
  test("size grows with radiative power and stays within bounds", () => {
    expect(fireSize(null)).toBe(8);
    expect(fireSize(0)).toBe(8);
    expect(fireSize(-3)).toBe(8);
    expect(fireSize(9)).toBe(11);
    expect(fireSize(99)).toBe(14);
    expect(fireSize(5000)).toBe(18);
    expect(fireSize(1_000_000)).toBe(18);
  });

  test("every fire is an amber flame labelled with its power", () => {
    const [weak, strong, unknown] = fireMarkers([
      fireRow("wildfires:a", 1.34),
      fireRow("wildfires:b", 27.6),
      fireRow("wildfires:c", null),
    ]);
    expect([weak.glyph, strong.glyph, unknown.glyph]).toEqual([
      "flame",
      "flame",
      "flame",
    ]);
    expect([weak.tone, strong.tone, unknown.tone]).toEqual([
      "notable",
      "notable",
      "notable",
    ]);
    expect([weak.label, strong.label, unknown.label]).toEqual([
      "1.3 MW",
      "28 MW",
      "FRP ?",
    ]);
    expect(strong).toMatchObject({
      id: "wildfires:b",
      lon: 98.04,
      lat: 16.52,
    });
  });

  test("a merged cluster is a ring sized above any single fire of its power", () => {
    const [single, merged] = fireMarkers([
      fireRow("wildfires:a", 99),
      { ...fireRow("wildfires:b", 99), attrs: { cluster_count: 1234 } },
    ]);
    expect(single.cluster).toBeUndefined();
    expect(merged).toMatchObject({
      id: "wildfires:b",
      glyph: "flame-ring",
      tone: "notable",
      cluster: { count: 1234, megawatts: 99 },
      label: "1,234 detections, 99 MW",
    });
    expect(merged.size).toBe(single.size + 4);
  });

  test("a cluster count that is not a whole number above one is ignored", () => {
    const markers = fireMarkers(
      [1, 0, -2, 2.5, "7", null].map((count, index) => ({
        ...fireRow(`wildfires:${index}`, 5),
        attrs: { cluster_count: count },
      })),
    );
    expect(markers.map((marker) => marker.glyph)).toEqual(
      Array(6).fill("flame"),
    );
  });

  test("power labels switch from one decimal to whole megawatts at ten", () => {
    expect(powerLabel(9.94)).toBe("9.9 MW");
    expect(powerLabel(10)).toBe("10 MW");
  });
});

describe("fire selection", () => {
  const selection = fireSelection(FIRE_DETAIL, NOW);
  const rows = Object.fromEntries(
    selection.sections[0].rows.map((row) => [row.key, row]),
  );

  test("calls it a thermal anomaly, not a fire", () => {
    expect(selection.kind).toBe("EVENT");
    expect(selection.name).toBe("Thermal anomaly");
    expect(selection.subline).toBe("N VIIRS, day pass");
    expect(selection.actions).toEqual(["center"]);
  });

  test("details carry values and confidence tags", () => {
    expect(rows.DETECTED).toEqual({
      key: "DETECTED",
      value: "06:47:00Z 14 OCT",
      confidence: "DER",
    });
    expect(rows.POSITION.value).toBe("16.5°N 98.0°E");
    expect(rows.POWER).toMatchObject({ value: "28 MW", confidence: "DER" });
    expect(rows.HEAT.value).toBe("361.2 K");
    expect(rows.CERTAINTY).toMatchObject({ value: "high", confidence: "REP" });
    expect(rows.PIXEL.value).toBe("510 x 420 m");
  });

  test("a cluster adds its totals above the strongest detection", () => {
    const merged = fireSelection(FIRE_DETAIL, NOW, {
      count: 1234,
      megawatts: 4200,
    });
    expect(merged.name).toBe("Thermal anomaly cluster");
    expect(merged.sections.map((section) => section.label)).toEqual([
      "CLUSTER",
      "STRONGEST DETECTION",
    ]);
    expect(merged.sections[0].rows).toEqual([
      { key: "DETECTIONS", value: "1,234", confidence: "DER" },
      { key: "COMBINED", value: "4200 MW", confidence: "DER" },
    ]);
    expect(merged.sections[1].rows).toEqual(selection.sections[0].rows);
  });

  test("provenance shows source, retrieved time and every limitation", () => {
    expect(selection.provenance).toEqual({
      source: "NASA FIRMS, VIIRS S-NPP near real time active fire detections",
      retrieved: "09:00:04Z, 11 min ago",
      reliability: "primary",
      licence: "Open, attribution required",
    });
    expect(selection.limitations).toEqual(FIRE_DETAIL.provenance?.limitations);
    expect(selection.limitations[0]).toContain("not a confirmed fire");
  });

  test("missing values say so instead of breaking", () => {
    const bare = fireSelection(
      { ...FIRE_DETAIL, severity: null, attrs: {}, provenance: null },
      NOW,
    );
    const values = Object.fromEntries(
      bare.sections[0].rows.map((row) => [row.key, row.value]),
    );
    expect(values.POWER).toBe("not reported");
    expect(values.HEAT).toBe("not reported");
    expect(values.CERTAINTY).toBe("not reported");
    expect(values.PIXEL).toBeUndefined();
    expect(bare.subline).toBe("VIIRS");
    expect(bare.provenance.source).toBe("nasa-firms");
    expect(bare.limitations).toEqual([]);
  });

  test("the registry routes wildfires to this view", () => {
    expect(MODULE_VIEWS.wildfires).toBeDefined();
    expect(selectionFor(FIRE_DETAIL, NOW).name).toBe("Thermal anomaly");
  });
});
