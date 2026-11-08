import { describe, expect, test } from "vitest";
import type { EntityDetail } from "@/api/client";
import { localItems } from "./starred";

const DETAIL = {
  last_seen: "2026-10-15T05:00:00Z",
  last_observation: { position: { lon: 67, lat: 25 } },
} as EntityDetail;

const STARS = [
  { id: "a", moduleId: "ports", name: "Karachi" },
  { id: "b", moduleId: "ports", name: "Mongla" },
];

describe("localItems", () => {
  test("fills position and last seen from the lookup", () => {
    expect(localItems(STARS, [DETAIL, undefined])).toEqual([
      {
        entity_id: "a",
        module_id: "ports",
        name: "Karachi",
        position: { lon: 67, lat: 25 },
        last_seen: "2026-10-15T05:00:00Z",
      },
      {
        entity_id: "b",
        module_id: "ports",
        name: "Mongla",
        position: null,
        last_seen: null,
      },
    ]);
  });

  test("copes with an entity that has no fix", () => {
    const [item] = localItems(STARS.slice(0, 1), [
      { ...DETAIL, last_observation: null },
    ]);
    expect(item.position).toBeNull();
    expect(item.last_seen).toBe("2026-10-15T05:00:00Z");
  });
});
