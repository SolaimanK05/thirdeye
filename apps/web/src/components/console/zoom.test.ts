import { describe, expect, test } from "vitest";
import {
  altitudeKm,
  cameraHeightKm,
  cesiumFov,
  clampZoom,
  EARTH_RADIUS_KM,
  formatKm,
  HORIZON_FILL,
  levelBounds,
  parseZoom,
  scaleBar,
  VIEW_FOV_DEGREES,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomForCameraHeightKm,
  zoomIn,
  zoomLevelFor,
  zoomOut,
} from "./zoom";

describe("zoom percentage to camera altitude", () => {
  test("100% is the global view", () => {
    expect(altitudeKm(100)).toBe(7240);
    expect(formatKm(altitudeKm(100))).toBe("7,240 km");
  });

  test("doubling the zoom halves the altitude", () => {
    expect(altitudeKm(200)).toBe(3620);
    expect(altitudeKm(400)).toBe(1810);
    expect(altitudeKm(50)).toBe(14480);
  });

  test("the limits are 25% (orbit) and 5000% (local)", () => {
    expect(formatKm(altitudeKm(ZOOM_MIN))).toBe("28,960 km");
    expect(formatKm(altitudeKm(ZOOM_MAX))).toBe("145 km");
    expect(altitudeKm(1)).toBe(altitudeKm(ZOOM_MIN));
    expect(altitudeKm(99_999)).toBe(altitudeKm(ZOOM_MAX));
  });
});

describe("zoom levels", () => {
  test("percentages fall into the four module levels", () => {
    expect(zoomLevelFor(25)).toEqual({ level: 1, name: "ORBIT" });
    expect(zoomLevelFor(59)).toEqual({ level: 1, name: "ORBIT" });
    expect(zoomLevelFor(60)).toEqual({ level: 2, name: "GLOBAL" });
    expect(zoomLevelFor(199)).toEqual({ level: 2, name: "GLOBAL" });
    expect(zoomLevelFor(200)).toEqual({ level: 3, name: "REGIONAL" });
    expect(zoomLevelFor(999)).toEqual({ level: 3, name: "REGIONAL" });
    expect(zoomLevelFor(1000)).toEqual({ level: 4, name: "LOCAL" });
    expect(zoomLevelFor(5000)).toEqual({ level: 4, name: "LOCAL" });
  });

  test("each level knows its percentage range", () => {
    expect(levelBounds(1)).toEqual({ from: 25, to: 59 });
    expect(levelBounds(2)).toEqual({ from: 60, to: 199 });
    expect(levelBounds(3)).toEqual({ from: 200, to: 999 });
    expect(levelBounds(4)).toEqual({ from: 1000, to: 5000 });
  });
});

describe("zoom buttons and input", () => {
  test("buttons double and halve, inside the limits", () => {
    expect(zoomIn(100)).toBe(200);
    expect(zoomOut(100)).toBe(50);
    expect(zoomIn(4000)).toBe(ZOOM_MAX);
    expect(zoomOut(30)).toBe(ZOOM_MIN);
    expect(zoomOut(75)).toBe(38);
  });

  test("typed values are parsed and clamped", () => {
    expect(parseZoom("250", 100)).toBe(250);
    expect(parseZoom(" 250% ", 100)).toBe(250);
    expect(parseZoom("12.6", 100)).toBe(ZOOM_MIN);
    expect(parseZoom("9000", 100)).toBe(ZOOM_MAX);
    expect(parseZoom("33.4", 100)).toBe(33);
  });

  test("anything else keeps the current zoom", () => {
    expect(parseZoom("", 150)).toBe(150);
    expect(parseZoom("abc", 150)).toBe(150);
    expect(parseZoom("-20", 150)).toBe(150);
    expect(parseZoom("1e3", 150)).toBe(150);
  });

  test("clampZoom rounds to whole percent", () => {
    expect(clampZoom(100.4)).toBe(100);
    expect(clampZoom(100.5)).toBe(101);
  });
});

describe("camera", () => {
  test("at 100% the horizon fills the view like the design globe", () => {
    const distance = EARTH_RADIUS_KM + cameraHeightKm(100);
    const horizon = Math.asin(EARTH_RADIUS_KM / distance);
    const halfFov = (VIEW_FOV_DEGREES * Math.PI) / 360;
    expect(Math.tan(horizon) / Math.tan(halfFov)).toBeCloseTo(HORIZON_FILL, 6);
  });

  test("camera height and zoom round-trip and clamp", () => {
    for (const percent of [25, 60, 100, 200, 400, 1000, 5000]) {
      expect(zoomForCameraHeightKm(cameraHeightKm(percent))).toBe(percent);
    }
    expect(cameraHeightKm(200)).toBeCloseTo(cameraHeightKm(100) / 2, 6);
    expect(zoomForCameraHeightKm(10_000_000)).toBe(ZOOM_MIN);
    expect(zoomForCameraHeightKm(1)).toBe(ZOOM_MAX);
  });

  test("the field of view is fixed on the shorter side", () => {
    const vertical = (VIEW_FOV_DEGREES * Math.PI) / 180;
    expect(cesiumFov(0.5)).toBeCloseTo(vertical, 9);
    expect(cesiumFov(1)).toBeCloseTo(vertical, 9);
    const wide = cesiumFov(2);
    expect(Math.tan(wide / 2) / 2).toBeCloseTo(Math.tan(vertical / 2), 9);
  });
});

describe("scale bar", () => {
  test("at 100% a round 1,000 km fits inside the bar", () => {
    expect(scaleBar(100)).toEqual({ label: "1,000 km", widthPx: 58 });
  });

  test("picks a round distance and sizes the bar to it", () => {
    expect(scaleBar(400)).toEqual({ label: "200 km", widthPx: 46 });
    expect(scaleBar(25)).toEqual({ label: "5,000 km", widthPx: 73 });
    expect(scaleBar(5000)).toEqual({ label: "20 km", widthPx: 58 });
    expect(scaleBar(300)).toEqual({ label: "500 km", widthPx: 87 });
  });
});
