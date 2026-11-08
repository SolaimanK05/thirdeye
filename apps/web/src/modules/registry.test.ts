import { describe, expect, test } from "vitest";
import { scopeOf } from "@/components/console/draw-rules";
import {
  ENTITY_VIEWS,
  MODULE_VIEWS,
  TYPE_LABEL,
  typeLabelOf,
  ZOOM_CAPS,
} from "./registry";

describe("the zoom data in the registry", () => {
  test("the only cap is the satellites' 300%", () => {
    expect(ZOOM_CAPS).toEqual({ satellites: 300 });
  });

  test("every cap belongs to a module the registry knows", () => {
    for (const id of Object.keys(ZOOM_CAPS)) {
      expect(ENTITY_VIEWS[id]).toBeDefined();
    }
  });

  test("earthquakes ask for M5 and up at ORBIT and nothing elsewhere", () => {
    expect(MODULE_VIEWS.earthquakes.minSeverityAt).toEqual({ 1: 5 });
    expect(MODULE_VIEWS.wildfires.minSeverityAt).toBeUndefined();
  });

  test("a quake module with that table draws all levels but thins ORBIT", () => {
    const module = {
      filter: "all" as const,
      usable: true,
      zoomRange: [1, 4] as const,
      minSeverityAt: MODULE_VIEWS.earthquakes.minSeverityAt,
    };
    expect(scopeOf(module, { level: 1, over: false })).toBe("all");
    expect(scopeOf(module, { level: 4, over: false })).toBe("all");
  });
});

describe("the type label of each module", () => {
  test("names all six modules with a singular noun", () => {
    expect(TYPE_LABEL).toEqual({
      aircraft: "Aircraft",
      vessels: "Vessel",
      ports: "Port",
      satellites: "Satellite",
      earthquakes: "Earthquake",
      wildfires: "Wildfire",
    });
  });

  test("every module the registry draws has a label", () => {
    for (const id of [
      ...Object.keys(ENTITY_VIEWS),
      ...Object.keys(MODULE_VIEWS),
    ]) {
      expect(TYPE_LABEL[id], id).toBeDefined();
    }
  });

  test("a module nobody named falls back to the given name, then its id", () => {
    expect(typeLabelOf("ports")).toBe("Port");
    expect(typeLabelOf("brand-new", "Brand New Feed")).toBe("Brand New Feed");
    expect(typeLabelOf("brand-new")).toBe("brand-new");
  });
});
