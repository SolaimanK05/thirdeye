import { describe, expect, it } from "vitest";
import type { EntityRow } from "@/api/client";
import { aircraftRefine } from "@/modules/aircraft/refine";
import { passes, type RefineValues } from "@/modules/refine";
import { SHIP_TYPES, vesselRefine } from "@/modules/vessels/refine";
import { Mirror } from "./mirror";
import { slotFilter } from "./refine-columns";
import { frameOf, type TestRow } from "./test-frames";

function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const NOW = 1_800_000_000_000;

function asRow(row: TestRow, attrs: Record<string, unknown>): EntityRow {
  return {
    id: `id-${row.slot}`,
    kind: "aircraft",
    name: "x",
    lon: 0,
    lat: 0,
    t: new Date(NOW).toISOString(),
    sog:
      row.sog === null || row.sog === undefined
        ? null
        : Math.round(row.sog * 10) / 10,
    cog: null,
    heading: null,
    alt: row.alt === null || row.alt === undefined ? null : Math.round(row.alt),
    confidence: "observed",
    attrs,
  } as EntityRow;
}

describe("column refine parity with the row readers", () => {
  const random = lcg(7);

  it("agrees for aircraft altitude over many rows and ranges", () => {
    const rows: TestRow[] = [];
    const entities: EntityRow[] = [];
    for (let slot = 0; slot < 3000; slot++) {
      const r = random();
      const row: TestRow = {
        slot,
        alt: r < 0.1 ? null : Math.round(random() * 14_000 - 100),
        onGround: random() < 0.15,
      };
      rows.push(row);
      entities.push(asRow(row, { on_ground: row.onGround === true }));
    }
    const mirror = new Mirror();
    mirror.apply(frameOf({ version: 1, rows }));
    const ranges: RefineValues[] = [
      { altitude: [0, 60_000] },
      { altitude: [25_000, 60_000] },
      { altitude: [5000, 20_000] },
      { altitude: [0, 1000] },
      { altitude: [60_000, 60_000] },
    ];
    for (const values of ranges) {
      const filter = slotFilter("aircraft", mirror, values, NOW);
      expect(filter).not.toBeNull();
      for (let i = 0; i < rows.length; i++) {
        expect(filter?.(i), `row ${i} ${JSON.stringify(values)}`).toBe(
          passes(aircraftRefine, values, entities[i], NOW),
        );
      }
    }
  });

  it("agrees for vessel type and speed, including unknown types", () => {
    const rows: TestRow[] = [];
    const entities: EntityRow[] = [];
    for (let slot = 0; slot < 3000; slot++) {
      const cls = Math.floor(random() * 9);
      const row: TestRow = {
        slot,
        cls,
        sog: random() < 0.1 ? null : Math.round(random() * 400) / 10,
      };
      rows.push(row);
      const shipType =
        cls === 0 ? undefined : (SHIP_TYPES[cls - 1]?.value ?? "other");
      entities.push(
        asRow(row, shipType === undefined ? {} : { ship_type: shipType }),
      );
    }
    const mirror = new Mirror();
    mirror.apply(frameOf({ version: 1, rows }));
    const sets: RefineValues[] = [
      { type: SHIP_TYPES.map((t) => t.value), speed: [0, 30] },
      { type: ["cargo", "tanker"], speed: [0, 30] },
      { type: ["other"], speed: [2, 12] },
      { type: [], speed: [0, 30] },
      { type: SHIP_TYPES.map((t) => t.value), speed: [5, 5] },
    ];
    for (const values of sets) {
      const filter = slotFilter("vessels", mirror, values, NOW);
      expect(filter).not.toBeNull();
      for (let i = 0; i < rows.length; i++) {
        expect(filter?.(i), `row ${i} ${JSON.stringify(values)}`).toBe(
          passes(vesselRefine, values, entities[i], NOW),
        );
      }
    }
  });

  it("has no filter for modules without refine controls", () => {
    expect(slotFilter("synthetic", new Mirror(), {}, NOW)).toBeNull();
  });
});
