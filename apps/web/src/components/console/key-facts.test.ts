import { describe, expect, test } from "vitest";
import { quakeSelection } from "@/modules/earthquakes/selection";
import { QUAKE_DETAIL } from "@/modules/earthquakes/test-data";
import { TYPE_LABEL } from "@/modules/registry";
import { KEY_FACTS, splitKeyFacts } from "./key-facts";
import type { Selection } from "./types";

const base: Selection = {
  kind: "Vessel",
  name: "MV EXAMPLE",
  subline: "",
  starred: false,
  actions: [],
  sections: [
    {
      label: "IDENTITY",
      rows: [{ key: "MMSI", value: "1", confidence: "REP" }],
    },
    {
      label: "TELEMETRY",
      rows: [
        { key: "COURSE", value: "90°", confidence: "REP" },
        { key: "SPEED", value: "12 kn", confidence: "REP" },
        { key: "POSITION", value: "1, 2", confidence: "DER" },
      ],
    },
  ],
  provenance: { source: "", retrieved: "", reliability: "", licence: "" },
  limitations: [],
};

describe("key facts", () => {
  test("every module's type label has a set of key facts", () => {
    for (const label of Object.values(TYPE_LABEL)) {
      expect(KEY_FACTS[label], label).toBeDefined();
      expect(KEY_FACTS[label].length).toBeLessThanOrEqual(3);
    }
  });

  test("the key rows come out in the configured order and leave the lists", () => {
    const { facts, sections } = splitKeyFacts(base);
    expect(facts.map((row) => row.key)).toEqual(["SPEED", "COURSE"]);
    const left = sections.flatMap((section) => section.rows.map((r) => r.key));
    expect(left).toEqual(["MMSI", "POSITION"]);
  });

  test("a section left with no rows is dropped", () => {
    const only: Selection = {
      ...base,
      sections: [
        { label: "T", rows: [{ key: "SPEED", value: "1", confidence: "REP" }] },
      ],
    };
    expect(splitKeyFacts(only).sections).toEqual([]);
  });

  test("a kind with no key facts is left alone", () => {
    const other = { ...base, kind: "Anything" };
    expect(splitKeyFacts(other)).toEqual({
      facts: [],
      sections: base.sections,
    });
  });

  test("an earthquake shows magnitude, depth and origin as its key facts", () => {
    const selection = quakeSelection(
      QUAKE_DETAIL,
      Date.parse("2026-10-14T06:05:00Z"),
    );
    const { facts } = splitKeyFacts(selection);
    expect(facts.map((row) => row.key)).toEqual([
      "MAGNITUDE",
      "DEPTH",
      "ORIGIN",
    ]);
  });
});
