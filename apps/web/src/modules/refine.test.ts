import { describe, expect, test } from "vitest";
import type { EntityRow, EventRow } from "@/api/client";
import { ALTITUDE_MAX_FT, aircraftRefine } from "./aircraft/refine";
import { quakeRefine } from "./earthquakes/refine";
import { portRefine } from "./ports/refine";
import {
  defaultValues,
  isDefault,
  passes,
  type RefineControl,
  type RefineSpec,
  refineRows,
  resolveValues,
  serverFloor,
  summarise,
} from "./refine";
import { controlsFor, ENTITY_VIEWS, MODULE_VIEWS } from "./registry";
import { fireRefine } from "./wildfires/refine";

const NOW = Date.parse("2026-10-26T12:00:00Z");
const FEET = 3.280839895;

const aircraft = (
  id: string,
  alt: number | null,
  attrs: Record<string, boolean> = {},
): EntityRow => ({
  id,
  kind: "aircraft",
  name: id,
  lon: 0,
  lat: 0,
  t: "2026-10-26T11:59:00Z",
  sog: null,
  cog: null,
  heading: null,
  alt,
  confidence: "observed",
  attrs,
});

const quake = (
  id: string,
  severity: number | null,
  minutesAgo: number,
): EventRow => ({
  id,
  category: "earthquake",
  lon: 0,
  lat: 0,
  t_start: new Date(NOW - minutesAgo * 60_000).toISOString(),
  t_end: null,
  severity,
  confidence: "observed",
  attrs: {},
});

const port = (id: string, size: string | null): EntityRow => ({
  ...aircraft(id, null),
  kind: "facility",
  attrs: size === null ? {} : { harbor_size: size },
});

describe("resolveValues", () => {
  const controls = aircraftRefine.controls;

  test("nothing stored gives the module defaults", () => {
    expect(resolveValues(controls, undefined)).toEqual({
      altitude: [25_000, 60_000],
    });
    expect(resolveValues(controls, undefined)).toEqual(defaultValues(controls));
  });

  test("a stored range is snapped to the step and clamped", () => {
    expect(resolveValues(controls, { altitude: [10_400, 99_999] })).toEqual({
      altitude: [10_000, 60_000],
    });
    expect(resolveValues(controls, { altitude: [-5, 3_000] })).toEqual({
      altitude: [0, 3_000],
    });
  });

  test("a reversed range is put in order", () => {
    expect(resolveValues(controls, { altitude: [30_000, 12_000] })).toEqual({
      altitude: [12_000, 30_000],
    });
  });

  test("tampered values fall back to the defaults", () => {
    for (const bad of ["x", null, [1], [1, "2"], [Number.NaN, 5], { a: 1 }]) {
      expect(resolveValues(controls, { altitude: bad })).toEqual({
        altitude: [25_000, 60_000],
      });
    }
    expect(resolveValues(controls, "oops")).toEqual({
      altitude: [25_000, 60_000],
    });
  });

  test("a level snaps to the nearest stop", () => {
    expect(resolveValues(fireRefine.controls, { power: 20 })).toEqual({
      power: 10,
    });
    expect(resolveValues(fireRefine.controls, { power: "high" })).toEqual({
      power: 0,
    });
  });

  test("a window must be one of its options", () => {
    expect(resolveValues(quakeRefine.controls, { age: 21_600 }).age).toBe(
      21_600,
    );
    expect(resolveValues(quakeRefine.controls, { age: 7 }).age).toBe(0);
  });

  test("choices keep only known options, in order", () => {
    expect(
      resolveValues(portRefine.controls, { harbour: ["V", "L", "X", "L"] }),
    ).toEqual({ harbour: ["L", "V"] });
    expect(resolveValues(portRefine.controls, { harbour: [] })).toEqual({
      harbour: [],
    });
    expect(resolveValues(portRefine.controls, { harbour: "L" })).toEqual({
      harbour: ["L", "M", "S", "V"],
    });
  });

  test("unknown control ids are ignored", () => {
    expect(
      resolveValues(controls, { altitude: [0, 60_000], other: 1 }),
    ).toEqual({
      altitude: [0, 60_000],
    });
  });
});

describe("isDefault", () => {
  test("is true only while every control is at its initial value", () => {
    const controls = quakeRefine.controls;
    expect(isDefault(controls, defaultValues(controls))).toBe(true);
    expect(isDefault(controls, { magnitude: 4, age: 0 })).toBe(false);
    expect(isDefault(portRefine.controls, { harbour: ["L"] })).toBe(false);
  });
});

describe("aircraft altitude", () => {
  const values = defaultValues(aircraftRefine.controls);
  const kept = (rows: EntityRow[], chosen = values) =>
    refineRows(rows, aircraftRefine, chosen, NOW).rows.map((row) => row.id);

  test("the default keeps cruising aircraft and drops low ones", () => {
    const rows = [
      aircraft("cruise", 11_000),
      aircraft("exactly-25k", 25_000 / FEET),
      aircraft("low", 3_000),
      aircraft("very-high", 20_000),
    ];
    expect(kept(rows)).toEqual(["cruise", "exactly-25k", "very-high"]);
  });

  test("the top of the slider has no upper limit", () => {
    expect(kept([aircraft("u2", 21_000)])).toEqual(["u2"]);
  });

  test("a capped range drops what is above it", () => {
    const rows = [
      aircraft("low", 1_000),
      aircraft("middle", 5_000),
      aircraft("high", 12_000),
    ];
    expect(kept(rows, { altitude: [5_000, 30_000] })).toEqual(["middle"]);
  });

  test("aircraft on the ground count as zero feet", () => {
    const ground = aircraft("g", 120, { on_ground: true });
    expect(kept([ground])).toEqual([]);
    expect(kept([ground], { altitude: [0, 60_000] })).toEqual(["g"]);
  });

  test("an unknown altitude shows only when the low end is open", () => {
    const unknown = aircraft("u", null);
    expect(kept([unknown])).toEqual([]);
    expect(kept([unknown], { altitude: [0, 20_000] })).toEqual(["u"]);
  });

  test("starred aircraft stay even when filtered out", () => {
    const rows = [aircraft("low", 500), aircraft("high", 11_000)];
    const result = refineRows(
      rows,
      aircraftRefine,
      values,
      NOW,
      new Set(["low"]),
    );
    expect(result.rows.map((row) => row.id)).toEqual(["low", "high"]);
    expect(result).toMatchObject({ kept: 2, total: 2 });
  });

  test("reports how many were kept out of how many", () => {
    const rows = [
      aircraft("a", 500),
      aircraft("b", 11_000),
      aircraft("c", 12_000),
    ];
    expect(refineRows(rows, aircraftRefine, values, NOW)).toMatchObject({
      kept: 2,
      total: 3,
    });
  });

  test("the summary reads in feet", () => {
    expect(summarise(aircraftRefine.controls, values)).toBe("ALT 25,000+ ft");
    expect(summarise(aircraftRefine.controls, { altitude: [0, 60_000] })).toBe(
      "ALT any",
    );
    expect(summarise(aircraftRefine.controls, { altitude: [0, 10_000] })).toBe(
      "ALT to 10,000 ft",
    );
    expect(
      summarise(aircraftRefine.controls, { altitude: [5_000, 30_000] }),
    ).toBe("ALT 5,000 to 30,000 ft");
  });

  test("a range of one value reads as that value", () => {
    expect(summarise(aircraftRefine.controls, { altitude: [0, 0] })).toBe(
      "ALT 0 ft",
    );
    expect(
      summarise(aircraftRefine.controls, { altitude: [30_000, 30_000] }),
    ).toBe("ALT 30,000 ft");
  });

  test("the slider reaches 60,000 ft", () => {
    expect(ALTITUDE_MAX_FT).toBe(60_000);
    expect(
      refineRows(
        [aircraft("high", 17_000)],
        aircraftRefine,
        defaultValues(aircraftRefine.controls),
        NOW,
      ).kept,
    ).toBe(1);
  });

  test("the second unit is metres", () => {
    const [control] = aircraftRefine.controls;
    expect(control.kind === "range" && control.secondary?.convert(25_000)).toBe(
      7620,
    );
    expect(control.kind === "range" && control.secondary?.unit).toBe("m");
  });
});

describe("earthquakes", () => {
  const rows = [
    quake("big-old", 6.1, 20 * 60),
    quake("big-new", 5.2, 10),
    quake("small-new", 1.4, 5),
    quake("unknown", null, 30),
  ];
  const ids = (chosen: Record<string, number>) =>
    refineRows(rows, quakeRefine, chosen, NOW).rows.map((row) => row.id);

  test("the default shows every quake, however old", () => {
    expect(ids({ magnitude: 0, age: 0 })).toEqual([
      "big-old",
      "big-new",
      "small-new",
      "unknown",
    ]);
  });

  test("a magnitude floor drops weaker and unknown quakes", () => {
    expect(ids({ magnitude: 5, age: 0 })).toEqual(["big-old", "big-new"]);
  });

  test("a day window drops quakes older than a day", () => {
    const stale = [...rows, quake("two-days", 6, 48 * 60)];
    expect(
      refineRows(
        stale,
        quakeRefine,
        { magnitude: 0, age: 86_400 },
        NOW,
      ).rows.map((row) => row.id),
    ).not.toContain("two-days");
  });

  test("the age window drops older quakes", () => {
    expect(ids({ magnitude: 0, age: 3_600 })).toEqual([
      "big-new",
      "small-new",
      "unknown",
    ]);
  });

  test("both apply together", () => {
    expect(ids({ magnitude: 4, age: 3_600 })).toEqual(["big-new"]);
  });

  test("the summary names both controls", () => {
    expect(summarise(quakeRefine.controls, { magnitude: 4, age: 21_600 })).toBe(
      "MAG M4+, AGE 6H",
    );
    expect(
      summarise(quakeRefine.controls, defaultValues(quakeRefine.controls)),
    ).toBe("MAG any, AGE ALL");
  });
});

describe("ports", () => {
  const rows = [
    port("a", "L"),
    port("b", "M"),
    port("c", "S"),
    port("d", "V"),
    port("e", null),
  ];
  const ids = (harbour: string[]) =>
    refineRows(rows, portRefine, { harbour }, NOW).rows.map((row) => row.id);

  test("all sizes shows every port, including those with no size", () => {
    expect(ids(["L", "M", "S", "V"])).toEqual(["a", "b", "c", "d", "e"]);
  });

  test("choosing sizes keeps only those", () => {
    expect(ids(["L", "M"])).toEqual(["a", "b"]);
  });

  test("choosing nothing shows nothing", () => {
    expect(ids([])).toEqual([]);
  });

  test("the summary lists the chosen sizes", () => {
    expect(summarise(portRefine.controls, { harbour: ["L", "M"] })).toBe(
      "SIZE LARGE MEDIUM",
    );
    expect(
      summarise(portRefine.controls, defaultValues(portRefine.controls)),
    ).toBe("SIZE all");
    expect(summarise(portRefine.controls, { harbour: [] })).toBe("SIZE none");
  });
});

describe("wildfires", () => {
  test("power is sent to the server, not applied in the browser", () => {
    const rows = [quake("a", 1, 1)];
    expect(refineRows(rows, fireRefine, { power: 100 }, NOW).rows).toHaveLength(
      1,
    );
    expect(serverFloor(fireRefine.controls, { power: 100 })).toBe(100);
    expect(serverFloor(fireRefine.controls, { power: 0 })).toBe(0);
    expect(serverFloor(aircraftRefine.controls, { altitude: [0, 1] })).toBe(0);
  });

  test("the summary names the floor", () => {
    expect(summarise(fireRefine.controls, { power: 30 })).toBe("FRP 30 MW+");
    expect(summarise(fireRefine.controls, { power: 0 })).toBe("FRP any");
  });
});

describe("passes", () => {
  test("a control with no reader is left to the server", () => {
    const spec: RefineSpec<EntityRow> = {
      controls: fireRefine.controls,
      read: {},
    };
    expect(passes(spec, { power: 300 }, aircraft("a", 1), NOW)).toBe(true);
  });
});

describe("registry", () => {
  test("a module with no filters has no controls", () => {
    expect(controlsFor("nope")).toBeUndefined();
    expect(controlsFor("aircraft")).toBe(aircraftRefine.controls);
  });

  test("every client-side control has a reader and a unique id", () => {
    const specs = [
      ...Object.values(ENTITY_VIEWS).map((view) => view.refine),
      ...Object.values(MODULE_VIEWS).map((view) => view.refine),
    ];
    for (const spec of specs) {
      if (!spec) continue;
      const ids = spec.controls.map((control: RefineControl) => control.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const control of spec.controls) {
        const server = control.kind === "level" && control.target === "server";
        expect(Boolean(spec.read[control.id]), control.id).toBe(!server);
      }
    }
  });

  test("every control starts at a value it would accept", () => {
    for (const view of [
      ...Object.values(ENTITY_VIEWS),
      ...Object.values(MODULE_VIEWS),
    ]) {
      const controls = view.refine?.controls ?? [];
      expect(resolveValues(controls, defaultValues(controls))).toEqual(
        defaultValues(controls),
      );
    }
  });
});
