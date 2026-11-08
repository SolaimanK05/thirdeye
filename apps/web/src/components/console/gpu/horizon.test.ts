import { Cartesian3, Ellipsoid } from "cesium";
import { describe, expect, test } from "vitest";
import { geodeticToEcef } from "./encode";
import { behindHorizonPlane, occludedByGlobe } from "./horizon";

const ellipsoid = Ellipsoid.WGS84;

function eyeAbove(lon: number, lat: number, heightMetres: number) {
  const eye = Cartesian3.fromDegrees(lon, lat, heightMetres);
  const scaled = ellipsoid.transformPositionToScaledSpace(
    eye,
    new Cartesian3(),
  );
  return [scaled.x, scaled.y, scaled.z] as const;
}

function pointAt(lon: number, lat: number, heightMetres: number) {
  const out = new Float64Array(3);
  geodeticToEcef(lon, lat, out, 0, heightMetres);
  return out;
}

describe("occludedByGlobe", () => {
  const eye = eyeAbove(0, 0, 7_000_000);

  test("a surface point facing the eye is visible and one on the far side is hidden", () => {
    const near = pointAt(0, 0, 0);
    const far = pointAt(180, 0, 0);
    expect(occludedByGlobe(near[0], near[1], near[2], eye)).toBe(false);
    expect(occludedByGlobe(far[0], far[1], far[2], eye)).toBe(true);
  });

  test("agrees with the horizon plane for every point on the surface", () => {
    for (const height of [4_000_000, 7_000_000, 30_000_000]) {
      const view = eyeAbove(20, 35, height);
      for (let lon = -180; lon < 180; lon += 7) {
        for (let lat = -88; lat <= 88; lat += 11) {
          const p = pointAt(lon, lat, 0);
          const away = Math.abs(
            (p[0] / 6378137) * view[0] +
              (p[1] / 6378137) * view[1] +
              (p[2] / 6356752.314245179) * view[2] -
              1,
          );
          if (away < 1e-9) continue;
          expect(occludedByGlobe(p[0], p[1], p[2], view)).toBe(
            behindHorizonPlane(p[0], p[1], p[2], view),
          );
        }
      }
    }
  });

  test("a raised point just past the limb is visible, and sinks behind the globe as it comes down", () => {
    const lon = 84;
    const surface = pointAt(lon, 0, 0);
    expect(behindHorizonPlane(surface[0], surface[1], surface[2], eye)).toBe(
      true,
    );
    expect(occludedByGlobe(surface[0], surface[1], surface[2], eye)).toBe(true);
    const raised = pointAt(lon, 0, 800_000);
    expect(behindHorizonPlane(raised[0], raised[1], raised[2], eye)).toBe(true);
    expect(occludedByGlobe(raised[0], raised[1], raised[2], eye)).toBe(false);
    const low = pointAt(lon, 0, 20_000);
    expect(occludedByGlobe(low[0], low[1], low[2], eye)).toBe(true);
  });

  test("a raised point straight behind the globe stays hidden at any height", () => {
    for (const height of [500_000, 2_000_000, 6_000_000]) {
      const p = pointAt(180, 0, height);
      expect(occludedByGlobe(p[0], p[1], p[2], eye)).toBe(true);
    }
  });

  test("nothing is hidden when the eye is inside the globe", () => {
    const inside = [0.5, 0, 0] as const;
    const p = pointAt(180, 0, 0);
    expect(occludedByGlobe(p[0], p[1], p[2], inside)).toBe(false);
  });
});
