import { describe, expect, test } from "vitest";
import type { EntityRow } from "@/api/client";
import type { Marker } from "@/components/console/markers";
import { MotionEngine, type MotionTarget } from "./engine";
import { distanceMetres, METRES_PER_KNOT, signedDelta } from "./sphere";

const T0 = Date.parse("2026-10-26T10:00:00Z");
const DELAY = 105;
const STEP_MS = 1000 / 12;
const SPEED_KN = 486;
const METRES_PER_DEGREE = 111_194.9266;

type Flight = { startLon: number; reportedKn: number; polls: number[] };

function lonAt(startLon: number, seconds: number): number {
  const lon =
    startLon + (SPEED_KN * METRES_PER_KNOT * seconds) / METRES_PER_DEGREE;
  return ((lon + 540) % 360) - 180;
}

function rowAt(flight: Flight, seconds: number, lagSeconds: number): EntityRow {
  const measured = seconds - lagSeconds;
  return {
    id: "a",
    kind: "aircraft",
    name: "A",
    lon: lonAt(flight.startLon, measured),
    lat: 0,
    t: new Date(T0 + measured * 1000).toISOString(),
    sog: flight.reportedKn,
    cog: 90,
    heading: 90,
    alt: null,
    confidence: "observed",
    attrs: {},
  };
}

const MARKER: Marker = {
  id: "a",
  lon: 0,
  lat: 0,
  glyph: "plane",
  size: 10,
  tone: "default",
  label: "A",
  entity: true,
};

function fly(flight: Flight, until: number) {
  let now = T0;
  const positions: {
    at: number;
    lon: number;
    stale: boolean;
    arrival: boolean;
  }[] = [];
  let arrival = false;
  const target: MotionTarget = {
    markers: () => [MARKER],
    isVisible: () => true,
    setPositions: (_id, data) => {
      positions.push({ at: now, lon: data[0], stale: data[3] === 1, arrival });
    },
    invalidate: () => {},
  };
  const engine = new MotionEngine({ target, clock: () => now });
  engine.setMovers(new Map([["aircraft", DELAY]]));
  const pending = [...flight.polls];
  for (let seconds = 0; seconds <= until; seconds += STEP_MS / 1000) {
    now = T0 + seconds * 1000;
    arrival = false;
    while (pending.length > 0 && pending[0] <= seconds) {
      const poll = pending.shift() as number;
      engine.ingest({
        moduleId: "aircraft",
        upserts: [rowAt(flight, poll, 3 + (poll % 9))],
        removes: [],
        reset: false,
      });
      arrival = true;
    }
    engine.step();
  }
  return positions;
}

function steady(startLon: number, reportedKn = SPEED_KN): Flight {
  const polls: number[] = [];
  for (let at = 0; at <= 700; at += 91 + (polls.length % 3) * 2) polls.push(at);
  return { startLon, reportedKn, polls };
}

function steps(positions: { lon: number }[]): number[] {
  return positions
    .slice(1)
    .map((p, i) => signedDelta(positions[i].lon, p.lon) * METRES_PER_DEGREE);
}

const NOMINAL = (SPEED_KN * METRES_PER_KNOT) / 12;

describe("a flight watched for ten minutes", () => {
  const positions = fly(steady(10), 600);
  const moved = steps(positions);

  test("is drawn on every step", () => {
    expect(positions.length).toBeGreaterThan(7000);
  });

  test("never goes backwards", () => {
    expect(moved.every((metres) => metres >= 0)).toBe(true);
  });

  test("never jumps further than a step's worth of travel", () => {
    expect(Math.max(...moved)).toBeLessThan(NOMINAL * 1.2);
    expect(Math.min(...moved.slice(1))).toBeGreaterThan(NOMINAL * 0.8);
  });

  test("does not jump when a new fix arrives", () => {
    const arrivals = positions
      .map((p, i) => ({ p, i }))
      .filter(({ p, i }) => p.arrival && i > 0);
    expect(arrivals.length).toBeGreaterThan(4);
    for (const { i } of arrivals) {
      expect(Math.abs(moved[i - 1] - NOMINAL)).toBeLessThan(NOMINAL * 0.2);
    }
  });

  test("is never faded while fixes keep arriving", () => {
    expect(positions.every((p) => !p.stale)).toBe(true);
  });

  test("travels the distance the aircraft actually flew, 105 seconds late", () => {
    const last = positions[positions.length - 1];
    const seconds = (last.at - T0) / 1000;
    const expected = lonAt(10, seconds - DELAY - 3);
    expect(
      Math.abs(signedDelta(last.lon, expected)) * METRES_PER_DEGREE,
    ).toBeLessThan(4000);
  });
});

describe("a flight that misreports its speed", () => {
  test("still moves smoothly, with only a gentle change of pace", () => {
    const positions = fly(steady(10, SPEED_KN * 1.05), 600);
    const moved = steps(positions);
    expect(moved.every((metres) => metres >= 0)).toBe(true);
    expect(Math.max(...moved)).toBeLessThan(NOMINAL * 1.3);
    let worst = 0;
    for (let i = 1; i < moved.length; i++) {
      worst = Math.max(worst, Math.abs(moved[i] - moved[i - 1]));
    }
    expect(worst).toBeLessThan(NOMINAL * 0.15);
  });
});

describe("a flight across the dateline", () => {
  const positions = fly(steady(179.2), 600);
  const moved = steps(positions);

  test("keeps moving the same way as it crosses", () => {
    expect(positions.some((p) => p.lon < 0)).toBe(true);
    expect(positions.some((p) => p.lon > 179)).toBe(true);
    expect(moved.every((metres) => metres >= 0)).toBe(true);
    expect(Math.max(...moved)).toBeLessThan(NOMINAL * 1.2);
  });

  test("is never drawn on the wrong side of the world", () => {
    for (const { lon } of positions) {
      expect(Math.abs(lon) > 170 || Math.abs(lon) < 180).toBe(true);
      expect(distanceMetres(lon, 0, 179.2, 0)).toBeLessThan(2_000_000);
    }
  });
});

describe("a feed that goes quiet", () => {
  const flight: Flight = {
    startLon: 10,
    reportedKn: SPEED_KN,
    polls: [0, 91, 182],
  };
  const positions = fly(flight, 900);

  test("carries on at the last known speed, then fades and holds", () => {
    const fadedAt = positions.findIndex((p) => p.stale);
    expect(fadedAt).toBeGreaterThan(0);
    const before = positions[fadedAt - 1].lon;
    expect(positions[fadedAt].lon).toBeCloseTo(before, 2);
    const last = positions[positions.length - 1];
    expect(last.stale).toBe(true);
    expect(last.lon).toBeCloseTo(positions[fadedAt].lon, 6);
  });

  test("stops being redrawn once it has faded and holds still", () => {
    const fadedAt = positions.findIndex((p) => p.stale);
    expect(positions.length - fadedAt).toBeLessThanOrEqual(2);
  });

  test("keeps advancing until it fades", () => {
    const fadedAt = positions.findIndex((p) => p.stale);
    const moved = steps(positions.slice(0, fadedAt));
    expect(moved.every((metres) => metres >= 0)).toBe(true);
  });
});
