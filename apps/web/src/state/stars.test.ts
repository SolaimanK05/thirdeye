import { beforeEach, describe, expect, test } from "vitest";
import { MAX_LOCAL_STARS, sanitiseStars, useStars } from "./stars";

const STAR = { id: "a", moduleId: "ports", name: "Karachi" };

beforeEach(() => {
  useStars.setState({ stars: {}, noteSeen: false, noteOpen: false });
});

describe("sanitiseStars", () => {
  test("keeps well-formed entries keyed by id", () => {
    expect(sanitiseStars({ x: STAR, y: { ...STAR, id: "b" } })).toEqual({
      a: STAR,
      b: { ...STAR, id: "b" },
    });
  });

  test("drops anything malformed", () => {
    expect(sanitiseStars(null)).toEqual({});
    expect(sanitiseStars([STAR])).toEqual({});
    expect(sanitiseStars("x")).toEqual({});
    expect(
      sanitiseStars({
        a: { id: "", moduleId: "ports", name: "x" },
        b: { id: "b", moduleId: 3, name: "x" },
        c: { id: "c", moduleId: "ports" },
        d: null,
        e: "text",
      }),
    ).toEqual({});
  });

  test("caps the number of entries and the length of names", () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_LOCAL_STARS + 20 }, (_, i) => [
        `k${i}`,
        { id: `k${i}`, moduleId: "ports", name: "x".repeat(500) },
      ]),
    );
    const clean = sanitiseStars(many);
    expect(Object.keys(clean)).toHaveLength(MAX_LOCAL_STARS);
    expect(clean.k0.name).toHaveLength(200);
  });
});

describe("useStars", () => {
  test("toggles a star on and off", () => {
    useStars.getState().toggle(STAR);
    expect(Object.keys(useStars.getState().stars)).toEqual(["a"]);
    useStars.getState().toggle(STAR);
    expect(useStars.getState().stars).toEqual({});
  });

  test("opens the note the first time only", () => {
    useStars.getState().toggle(STAR);
    expect(useStars.getState()).toMatchObject({
      noteSeen: true,
      noteOpen: true,
    });
    useStars.getState().dismissNote();
    expect(useStars.getState().noteOpen).toBe(false);
    useStars.getState().toggle(STAR);
    useStars.getState().toggle(STAR);
    expect(useStars.getState().noteOpen).toBe(false);
  });

  test("unstarring does not open the note", () => {
    useStars.setState({ stars: { a: STAR }, noteSeen: true });
    useStars.getState().toggle(STAR);
    expect(useStars.getState().noteOpen).toBe(false);
  });

  test("remove drops a star and ignores unknown ids", () => {
    useStars.setState({ stars: { a: STAR } });
    useStars.getState().remove("zzz");
    expect(Object.keys(useStars.getState().stars)).toEqual(["a"]);
    useStars.getState().remove("a");
    expect(useStars.getState().stars).toEqual({});
  });

  test("refuses to grow past the cap", () => {
    const full = Object.fromEntries(
      Array.from({ length: MAX_LOCAL_STARS }, (_, i) => [
        `k${i}`,
        { id: `k${i}`, moduleId: "ports", name: "x" },
      ]),
    );
    useStars.setState({ stars: full });
    useStars.getState().toggle(STAR);
    expect(useStars.getState().stars.a).toBeUndefined();
  });
});
