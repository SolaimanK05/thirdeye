import { describe, expect, test } from "vitest";
import { GEO_OMM, ISS_EPOCH_MS, ISS_OMM } from "./fixtures";
import { type Omm, parseOmm } from "./omm";
import { elementAgeMs, orbitClass, orbitShape } from "./orbit";

function omm(fields: Record<string, unknown>): Omm {
  const parsed = parseOmm({ ...ISS_OMM, ...fields }, null);
  if (parsed === null) throw new Error("fixture is not a valid element set");
  return parsed;
}

describe("orbitShape", () => {
  test("gives the space station a 93 minute orbit about 410 km up", () => {
    const shape = orbitShape(omm({}));
    expect(shape.periodMinutes).toBeCloseTo(92.91, 1);
    expect(shape.perigeeKm).toBeGreaterThan(400);
    expect(shape.perigeeKm).toBeLessThan(420);
    expect(shape.apogeeKm).toBeGreaterThan(shape.perigeeKm);
    expect(shape.inclinationDeg).toBeCloseTo(51.6416, 4);
  });

  test("puts a geostationary satellite near 35,786 km", () => {
    const shape = orbitShape(omm(GEO_OMM));
    expect(shape.periodMinutes).toBeCloseTo(1436.1, 0);
    expect(shape.perigeeKm).toBeGreaterThan(35_700);
    expect(shape.perigeeKm).toBeLessThan(35_900);
  });
});

describe("orbitClass", () => {
  test.each([
    ["the space station", {}, "Low Earth orbit"],
    [
      "a navigation satellite",
      { MEAN_MOTION: 2.0057, ECCENTRICITY: 0.005, INCLINATION: 55 },
      "Medium Earth orbit",
    ],
    ["a weather satellite on the equator", GEO_OMM, "Geostationary orbit"],
    [
      "a tilted geosynchronous satellite",
      { ...GEO_OMM, INCLINATION: 28 },
      "Geosynchronous orbit",
    ],
    [
      "a Molniya satellite",
      { MEAN_MOTION: 2.006, ECCENTRICITY: 0.7, INCLINATION: 63.4 },
      "Highly elliptical orbit",
    ],
    ["a graveyard orbit", { ...GEO_OMM, MEAN_MOTION: 0.9 }, "High orbit"],
  ])("calls %s %s", (_label, fields, expected) => {
    expect(orbitClass(orbitShape(omm(fields)))).toBe(expected);
  });
});

describe("elementAgeMs", () => {
  test("counts from the epoch", () => {
    expect(elementAgeMs(omm({}), ISS_EPOCH_MS + 90_000)).toBe(90_000);
  });
});
