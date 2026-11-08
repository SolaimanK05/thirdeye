import type { Selection, SelectionRow } from "./types";

/** The few rows each kind of thing shows as large numbers on OVERVIEW. */
export const KEY_FACTS: Readonly<Record<string, readonly string[]>> = {
  Aircraft: ["GROUND SPEED", "ALTITUDE", "TRACK"],
  Vessel: ["SPEED", "COURSE", "STATUS"],
  Satellite: ["ALTITUDE", "SPEED", "PERIOD"],
  Earthquake: ["MAGNITUDE", "DEPTH", "ORIGIN"],
  Wildfire: ["POWER", "CERTAINTY", "DETECTED"],
  Port: ["HARBOUR SIZE", "HARBOUR TYPE", "COUNTRY"],
};

export type SplitFacts = {
  facts: readonly SelectionRow[];
  sections: Selection["sections"];
};

/** The key rows, in their order, and the sections without them. */
export function splitKeyFacts(selection: Selection): SplitFacts {
  const wanted = KEY_FACTS[selection.kind] ?? [];
  const found = new Map<string, SelectionRow>();
  for (const section of selection.sections) {
    for (const row of section.rows) {
      if (wanted.includes(row.key) && !found.has(row.key)) {
        found.set(row.key, row);
      }
    }
  }
  const facts = wanted.flatMap((key) => found.get(key) ?? []);
  if (facts.length === 0) return { facts, sections: selection.sections };
  const taken = new Set(facts);
  const sections = selection.sections
    .map((section) => ({
      ...section,
      rows: section.rows.filter((row) => !taken.has(row)),
    }))
    .filter((section) => section.rows.length > 0);
  return { facts, sections };
}
