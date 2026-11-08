import { describe, expect, test } from "vitest";
import { type Marker, withStars } from "./markers";

const marker = (id: string): Marker => ({
  id,
  lon: 0,
  lat: 0,
  glyph: "square",
  size: 9,
  tone: "default",
  label: id,
  entity: true,
});

describe("withStars", () => {
  const markers = [marker("a"), marker("b"), marker("c")];

  test("draws starred markers in the accent colour with a name", () => {
    const [a, b] = withStars(markers, new Set(["a"]), false);
    expect(a).toMatchObject({ id: "a", tone: "accent", persistentLabel: true });
    expect(b).toMatchObject({ id: "b", tone: "default" });
    expect(b.persistentLabel).toBeUndefined();
  });

  test("keeps only starred markers when asked", () => {
    const shown = withStars(markers, new Set(["b", "zzz"]), true);
    expect(shown.map((m) => m.id)).toEqual(["b"]);
  });

  test("shows nothing in starred-only mode when nothing is starred", () => {
    expect(withStars(markers, new Set(), true)).toEqual([]);
  });

  test("leaves everything as it was when nothing is starred", () => {
    expect(withStars(markers, new Set(), false)).toEqual(markers);
  });

  test("does not change the markers it was given", () => {
    withStars(markers, new Set(["a"]), false);
    expect(markers[0].tone).toBe("default");
  });
});
