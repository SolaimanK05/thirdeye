import { describe, expect, test } from "vitest";
import { formatCentre } from "./geo";
import { CESIUM_BASE_URL, GEO_BASE_URL } from "./globe-config";
import {
  FILL_WIDTH,
  hairline,
  isVectorStyle,
  LINE_LOOK,
  mapDetailFor,
} from "./globe-style";
import { altitudeKm, zoomForAltitudeKm } from "./zoom";

describe("formatCentre", () => {
  test("writes hemispheres instead of signs", () => {
    expect(formatCentre({ lat: 11, lon: 86 })).toBe("11.0°N 86.0°E");
    expect(formatCentre({ lat: -33.86, lon: 151.21 })).toBe("33.9°S 151.2°E");
    expect(formatCentre({ lat: 40.71, lon: -74.01 })).toBe("40.7°N 74.0°W");
  });

  test("wraps longitudes outside -180 to 180", () => {
    expect(formatCentre({ lat: 0, lon: 190 })).toBe("0.0°N 170.0°W");
    expect(formatCentre({ lat: 0, lon: -190 })).toBe("0.0°N 170.0°E");
  });
});

describe("camera height and zoom percent", () => {
  test("round-trip through the camera height", () => {
    for (const percent of [25, 60, 100, 200, 400, 1000, 5000]) {
      expect(zoomForAltitudeKm(altitudeKm(percent))).toBe(percent);
    }
  });

  test("heights beyond the limits clamp", () => {
    expect(zoomForAltitudeKm(100_000)).toBe(25);
    expect(zoomForAltitudeKm(10)).toBe(5000);
  });
});

describe("globe styles", () => {
  test("GREEN and BLACK draw the vector map, NATURAL keeps the imagery", () => {
    expect(isVectorStyle("GREEN")).toBe(true);
    expect(isVectorStyle("BLACK")).toBe(true);
    expect(isVectorStyle("NATURAL")).toBe(false);
  });

  test("the land fill is smaller at the overview detail", () => {
    expect(FILL_WIDTH["110m"]).toBe(2048);
    expect(FILL_WIDTH["50m"]).toBe(4096);
  });

  test("map detail switches from 110m to 50m past GLOBAL", () => {
    expect(mapDetailFor(25)).toBe("110m");
    expect(mapDetailFor(100)).toBe("110m");
    expect(mapDetailFor(199)).toBe("110m");
    expect(mapDetailFor(200)).toBe("50m");
    expect(mapDetailFor(5000)).toBe("50m");
  });

  test("design hairlines become 1px lines with the same ink", () => {
    const thin = hairline(0.7, 0.6);
    expect(thin.width).toBe(1);
    expect(thin.alpha).toBeCloseTo(0.6 * 0.7 * 0.732, 9);
    const thick = hairline(2, 1);
    expect(thick.width).toBeCloseTo(2 * 0.732, 9);
    expect(thick.alpha).toBe(1);
    expect(LINE_LOOK.coast.width).toBe(1);
    expect(LINE_LOOK.border.alpha).toBeLessThan(LINE_LOOK.coast.alpha);
  });

  test("Cesium assets and map data are served locally", () => {
    expect(CESIUM_BASE_URL).toBe("/cesium/");
    expect(GEO_BASE_URL).toBe("/geo/");
  });
});
