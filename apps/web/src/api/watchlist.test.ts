import { describe, expect, test } from "vitest";
import type { Watchlist } from "./client";
import { type StarTarget, withStar } from "./watchlist";

const NOW = "2026-10-15T06:00:00Z";

const TARGET: StarTarget = {
  id: "a",
  moduleId: "ports",
  name: "Karachi",
  kind: "facility",
  position: { lon: 66.9, lat: 24.8 },
  lastSeen: "2026-10-14T00:00:00Z",
};

const LIST: Watchlist = {
  writable: true,
  items: [
    {
      entity_id: "b",
      name: "B",
      kind: "vessel",
      module_id: "vessels",
      added_at: NOW,
      last_seen: NOW,
      position: null,
    },
  ],
};

describe("withStar", () => {
  test("adds the entity first and keeps the rest", () => {
    const next = withStar(LIST, TARGET, true, NOW);
    expect(next.items.map((item) => item.entity_id)).toEqual(["a", "b"]);
    expect(next.items[0]).toMatchObject({
      module_id: "ports",
      name: "Karachi",
      kind: "facility",
      added_at: NOW,
      last_seen: "2026-10-14T00:00:00Z",
    });
    expect(next.writable).toBe(true);
  });

  test("does not add the same entity twice", () => {
    const once = withStar(LIST, TARGET, true, NOW);
    const twice = withStar(once, TARGET, true, NOW);
    expect(twice.items.filter((item) => item.entity_id === "a")).toHaveLength(
      1,
    );
  });

  test("removes the entity", () => {
    const next = withStar(
      withStar(LIST, TARGET, true, NOW),
      TARGET,
      false,
      NOW,
    );
    expect(next.items.map((item) => item.entity_id)).toEqual(["b"]);
  });

  test("falls back to the time of the click when last seen is unknown", () => {
    const next = withStar(LIST, { ...TARGET, lastSeen: null }, true, NOW);
    expect(next.items[0].last_seen).toBe(NOW);
  });

  test("never changes the list it was given", () => {
    withStar(LIST, TARGET, true, NOW);
    expect(LIST.items).toHaveLength(1);
  });
});
