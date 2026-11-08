import { describe, expect, it } from "vitest";
import type { EntityRow } from "@/api/client";
import { entityImportance } from "@/modules/importance";
import { SHIP_TYPES } from "@/modules/vessels/refine";
import { slotImportance } from "./importance-columns";
import { Mirror } from "./mirror";
import { frameOf, type TestRow } from "./test-frames";

function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function asRow(row: TestRow, attrs: Record<string, unknown>): EntityRow {
  return {
    id: `id-${row.slot}`,
    kind: "aircraft",
    name: "x",
    lon: 0,
    lat: 0,
    t: "2026-11-02T00:00:00Z",
    sog: null,
    cog: null,
    heading: null,
    alt: row.alt === null || row.alt === undefined ? null : Math.round(row.alt),
    confidence: "observed",
    attrs,
  } as EntityRow;
}

const same = (a: number, b: number) =>
  Number.isNaN(a) ? Number.isNaN(b) : a === b;

describe("column importance parity with the row measures", () => {
  const random = lcg(11);

  it("agrees for aircraft altitude, on the ground or unknown", () => {
    const rows: TestRow[] = [];
    const entities: EntityRow[] = [];
    for (let slot = 0; slot < 2000; slot++) {
      const row: TestRow = {
        slot,
        alt: random() < 0.1 ? null : Math.round(random() * 14_000 - 100),
        onGround: random() < 0.15,
      };
      rows.push(row);
      entities.push(asRow(row, { on_ground: row.onGround === true }));
    }
    const mirror = new Mirror();
    mirror.apply(frameOf({ version: 1, rows }));
    const read = slotImportance("aircraft", mirror);
    expect(read).not.toBeNull();
    for (let i = 0; i < rows.length; i++) {
      expect(same(read?.(i) ?? 0, entityImportance.aircraft(entities[i]))).toBe(
        true,
      );
    }
  });

  it("agrees for vessel size class, including unknown types", () => {
    const rows: TestRow[] = [];
    const entities: EntityRow[] = [];
    for (let slot = 0; slot < 2000; slot++) {
      const cls = Math.floor(random() * 10);
      const row: TestRow = { slot, cls };
      rows.push(row);
      const shipType =
        cls === 0 ? undefined : (SHIP_TYPES[cls - 1]?.value ?? "other");
      entities.push(
        asRow(row, shipType === undefined ? {} : { ship_type: shipType }),
      );
    }
    const mirror = new Mirror();
    mirror.apply(frameOf({ version: 1, rows }));
    const read = slotImportance("vessels", mirror);
    for (let i = 0; i < rows.length; i++) {
      expect(read?.(i)).toBe(entityImportance.vessels(entities[i]));
    }
  });

  it("has no measure for modules the worker does not rank", () => {
    expect(slotImportance("synthetic", new Mirror())).toBeNull();
  });
});
