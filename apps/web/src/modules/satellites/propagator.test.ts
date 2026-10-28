import { describe, expect, test } from "vitest";
import {
  element,
  FALLING_OMM,
  GEO_OMM,
  ISS_EPOCH_MS,
  ISS_OMM,
  MINUTE_MS,
} from "./fixtures";
import { POSITION_STRIDE, Propagator } from "./propagator";

const DAY_MS = 24 * 60 * MINUTE_MS;

function loaded(...elements: ReturnType<typeof element>[]): Propagator {
  const propagator = new Propagator();
  propagator.load(elements);
  return propagator;
}

describe("a fixed epoch", () => {
  const station = loaded(element("iss"));

  test("places the station where SGP4 puts it at the element epoch", () => {
    const sample = station.sample("iss", ISS_EPOCH_MS);
    expect(sample).not.toBeNull();
    expect(sample?.lon).toBeCloseTo(-103.17572, 4);
    expect(sample?.lat).toBeCloseTo(-0.05255, 4);
    expect(sample?.altKm).toBeCloseTo(417.032, 2);
    expect(sample?.speedKmS).toBeCloseTo(7.66257, 4);
  });

  test("moves it 30 minutes on", () => {
    const sample = station.sample("iss", ISS_EPOCH_MS + 30 * MINUTE_MS);
    expect(sample?.lon).toBeCloseTo(18.01029, 4);
    expect(sample?.lat).toBeCloseTo(44.73246, 4);
    expect(sample?.altKm).toBeCloseTo(418.153, 2);
  });

  test("is back near the equator after one orbit", () => {
    const sample = station.sample("iss", ISS_EPOCH_MS + 93 * MINUTE_MS);
    expect(Math.abs(sample?.lat ?? 90)).toBeLessThan(1);
    expect(sample?.altKm).toBeCloseTo(417, 0);
  });

  test("stays within a fraction of a degree of the latitudes the inclination allows", () => {
    for (let minute = 0; minute < 200; minute += 5) {
      const sample = station.sample("iss", ISS_EPOCH_MS + minute * MINUTE_MS);
      expect(Math.abs(sample?.lat ?? 90)).toBeLessThanOrEqual(52.2);
    }
  });

  test("gives the same answer for the same time", () => {
    expect(station.sample("iss", ISS_EPOCH_MS)).toEqual(
      station.sample("iss", ISS_EPOCH_MS),
    );
  });

  test("keeps a geostationary satellite almost still over a day", () => {
    const geo = loaded(element("geo", GEO_OMM));
    const first = geo.sample("geo", ISS_EPOCH_MS);
    const later = geo.sample("geo", ISS_EPOCH_MS + 6 * 60 * MINUTE_MS);
    expect(first?.altKm).toBeGreaterThan(35_700);
    expect(Math.abs((first?.lon ?? 0) - (later?.lon ?? 0))).toBeLessThan(1);
    expect(Math.abs(later?.lat ?? 90)).toBeLessThan(1);
  });
});

describe("filling a buffer", () => {
  test("writes longitude, latitude, no heading and not faded for each satellite", () => {
    const propagator = loaded(element("iss"), element("geo", GEO_OMM));
    const out = new Float64Array(2 * POSITION_STRIDE);
    const result = propagator.fill(ISS_EPOCH_MS, out);
    expect(result).toEqual({ written: 2, dropped: 0 });
    const station = propagator.sample("iss", ISS_EPOCH_MS);
    expect(out[0]).toBeCloseTo(station?.lon ?? 0, 9);
    expect(out[1]).toBeCloseTo(station?.lat ?? 0, 9);
    expect(Number.isNaN(out[2])).toBe(true);
    expect(out[3]).toBe(0);
    expect(propagator.idList).toEqual(["iss", "geo"]);
  });

  test("keeps every position finite and on the globe for a mixed set", () => {
    const propagator = loaded(
      element("iss"),
      element("geo", GEO_OMM),
      element("again", { ...ISS_OMM, MEAN_ANOMALY: 10 }),
    );
    const out = new Float64Array(3 * POSITION_STRIDE);
    const { written } = propagator.fill(ISS_EPOCH_MS + 3 * DAY_MS, out);
    for (let i = 0; i < written; i++) {
      expect(Math.abs(out[i * POSITION_STRIDE])).toBeLessThanOrEqual(180);
      expect(Math.abs(out[i * POSITION_STRIDE + 1])).toBeLessThanOrEqual(90);
    }
  });

  test("drops a satellite that has decayed and closes the gap", () => {
    const propagator = loaded(
      element("iss"),
      element("falling", FALLING_OMM),
      element("geo", GEO_OMM),
    );
    const out = new Float64Array(3 * POSITION_STRIDE);
    expect(propagator.fill(ISS_EPOCH_MS, out).dropped).toBe(0);
    const late = propagator.fill(ISS_EPOCH_MS + 400 * DAY_MS, out);
    expect(late.dropped).toBeGreaterThanOrEqual(1);
    expect(propagator.idList).not.toContain("falling");
    expect(propagator.idList).toContain("geo");
    expect(late.written).toBe(propagator.count);
    expect(propagator.sample("falling", ISS_EPOCH_MS)).toBeNull();
  });
});

describe("loading", () => {
  test("counts what it could not read and carries on", () => {
    const propagator = new Propagator();
    const result = propagator.load([
      element("iss"),
      { id: "bad", name: null, omm: { MEAN_MOTION: "fast" } },
      element("geo", GEO_OMM),
    ]);
    expect(result).toEqual({ loaded: 2, rejected: 1 });
    expect(propagator.count).toBe(2);
  });

  test("replaces the old set rather than adding to it", () => {
    const propagator = loaded(element("iss"));
    propagator.load([element("geo", GEO_OMM)]);
    expect(propagator.idList).toEqual(["geo"]);
    expect(propagator.sample("iss", ISS_EPOCH_MS)).toBeNull();
  });

  test("forgets everything on clear", () => {
    const propagator = loaded(element("iss"));
    propagator.clear();
    expect(propagator.count).toBe(0);
  });

  test("handles a few thousand satellites in well under a second", () => {
    const many = Array.from({ length: 5000 }, (_, i) =>
      element(`sat-${i}`, {
        ...ISS_OMM,
        NORAD_CAT_ID: 100000 + i,
        MEAN_ANOMALY: (i * 7) % 360,
        RA_OF_ASC_NODE: (i * 3) % 360,
      }),
    );
    const propagator = new Propagator();
    expect(propagator.load(many).loaded).toBe(5000);
    const out = new Float64Array(5000 * POSITION_STRIDE);
    const started = performance.now();
    const result = propagator.fill(ISS_EPOCH_MS + 60 * MINUTE_MS, out);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(result.written).toBe(5000);
  });
});
