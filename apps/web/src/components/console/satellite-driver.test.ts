import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { SatelliteElement } from "@/api/client";
import { GEO_OMM, ISS_EPOCH_MS, ISS_OMM } from "@/modules/satellites/fixtures";
import { InProcessPort } from "@/modules/satellites/test-port";
import { renderedPosition } from "@/state/motion";
import { useOrbit } from "@/state/orbit";
import {
  type LayerSizing,
  type Marker,
  type OverlayPort,
  SEGMENT_LAT0,
  SEGMENT_LAT1,
  SEGMENT_LON0,
  SEGMENT_LON1,
  SEGMENT_STRIDE,
  SEGMENT_T0,
  SEGMENT_T1,
  type SegmentUpdate,
} from "./markers";
import {
  DISPLAY_DELAY_MS,
  FOLLOW_TICK_MS,
  MAX_SEGMENT_MS,
  SATELLITES_ID,
  SatelliteDriver,
  TICK_MS,
} from "./satellite-driver";

type Call =
  | {
      kind: "layer";
      markers: readonly Marker[];
      stale: boolean;
      sizing?: LayerSizing;
    }
  | { kind: "remove" }
  | { kind: "positions"; data: Float64Array }
  | { kind: "invalidate" };

function overlay() {
  const calls: Call[] = [];
  const port: OverlayPort = {
    setLayer: (_id, markers, stale, sizing) =>
      calls.push({ kind: "layer", markers, stale, sizing }),
    removeLayer: () => calls.push({ kind: "remove" }),
    setPositions: (_id, data) =>
      calls.push({ kind: "positions", data: data.slice() }),
    invalidate: () => calls.push({ kind: "invalidate" }),
  };
  const layers = () =>
    calls.flatMap((call) => (call.kind === "layer" ? [call] : []));
  const positions = () =>
    calls.flatMap((call) => (call.kind === "positions" ? [call.data] : []));
  return { port, calls, layers, positions };
}

function satellite(
  id: string,
  omm: Record<string, unknown>,
  name: string | null,
): SatelliteElement {
  return {
    id,
    norad_id: Number(omm.NORAD_CAT_ID),
    name,
    omm: omm as SatelliteElement["omm"],
  };
}

const ELEMENTS = [
  satellite("iss", ISS_OMM, "ISS (ZARYA)"),
  satellite("geo", GEO_OMM, "GOES 16"),
  satellite(
    "bare",
    { ...ISS_OMM, NORAD_CAT_ID: 270001, MEAN_ANOMALY: 40 },
    null,
  ),
];

const created: SatelliteDriver[] = [];

function rig() {
  const port = new InProcessPort();
  const view = overlay();
  const problems: string[] = [];
  let nowMs = ISS_EPOCH_MS;
  const driver = new SatelliteDriver({
    overlay: view.port,
    port,
    now: () => nowMs,
    onProblem: (message) => problems.push(message),
  });
  created.push(driver);
  return {
    driver,
    port,
    view,
    problems,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  useOrbit.setState({ sample: null });
});

afterEach(() => {
  for (const driver of created.splice(0)) driver.destroy();
  vi.useRealTimers();
});

describe("the satellite driver", () => {
  test("puts the satellites on the overlay as named dots as soon as the elements arrive", () => {
    const { driver, view } = rig();
    driver.setElements(ELEMENTS);
    const [layer] = view.layers();
    expect(layer.markers.map((m) => m.id)).toEqual(["iss", "geo", "bare"]);
    expect(layer.markers.map((m) => m.label)).toEqual([
      "ISS (ZARYA)",
      "GOES 16",
      "Unnamed satellite",
    ]);
    expect(layer.markers.every((m) => m.glyph === "dot" && m.entity)).toBe(
      true,
    );
    expect(layer.sizing?.(10).glyph).toBe("dot");
    expect(view.positions()[0].length).toBeGreaterThanOrEqual(12);
  });

  test("starts the markers where the satellites are", () => {
    const { driver, view } = rig();
    driver.setElements(ELEMENTS);
    const [iss] = view.layers()[0].markers;
    expect(iss.lon).toBeCloseTo(-103.1757, 3);
    expect(iss.lat).toBeCloseTo(-0.0525, 3);
  });

  test("does nothing until told to be active", () => {
    const { driver, view } = rig();
    driver.setElements(ELEMENTS);
    const before = view.positions().length;
    vi.advanceTimersByTime(5 * TICK_MS);
    expect(view.positions()).toHaveLength(before);
  });

  test("moves the satellites every second while active, without rebuilding the layer", () => {
    const { driver, view, advance } = rig();
    driver.setElements(ELEMENTS);
    driver.setActive(true);
    const first = view.positions().at(-1)?.slice(0, 2);
    advance(TICK_MS);
    vi.advanceTimersByTime(TICK_MS);
    advance(TICK_MS);
    vi.advanceTimersByTime(TICK_MS);
    expect(view.layers()).toHaveLength(1);
    const later = view.positions().at(-1)?.slice(0, 2);
    expect(later?.[0]).not.toBeCloseTo(first?.[0] ?? 0, 3);
    driver.destroy();
  });

  test("stops ticking when made inactive", () => {
    const { driver, view } = rig();
    driver.setElements(ELEMENTS);
    driver.setActive(true);
    driver.setActive(false);
    const count = view.positions().length;
    vi.advanceTimersByTime(10 * TICK_MS);
    expect(view.positions()).toHaveLength(count);
  });

  test("shows only the starred satellites when asked, with positions to match", () => {
    const { driver, view } = rig();
    driver.setElements(ELEMENTS);
    const everything = view.positions()[0];
    driver.setStars(new Set(["geo"]), true);
    const layer = view.layers().at(-1);
    expect(layer?.markers.map((m) => m.id)).toEqual(["geo"]);
    const data = view.positions().at(-1);
    expect(data?.[0]).toBeCloseTo(everything[4], 9);
    expect(data?.[1]).toBeCloseTo(everything[5], 9);
  });

  test("marks starred satellites with the accent and a name when all are shown", () => {
    const { driver, view } = rig();
    driver.setElements(ELEMENTS);
    driver.setStars(new Set(["geo"]), false);
    const markers = view.layers().at(-1)?.markers ?? [];
    expect(markers).toHaveLength(3);
    expect(markers.find((m) => m.id === "geo")).toMatchObject({
      tone: "accent",
      persistentLabel: true,
    });
    expect(markers.find((m) => m.id === "iss")?.tone).toBe("default");
  });

  test("shows only the selected satellite when out of scope, and everything again when back in", () => {
    const { driver, view } = rig();
    driver.setElements(ELEMENTS);
    driver.setInScope(false);
    expect(view.layers().at(-1)?.markers).toEqual([]);
    driver.setSelected("geo");
    const alone = view.layers().at(-1);
    expect(alone?.markers.map((m) => m.id)).toEqual(["geo"]);
    const data = view.positions().at(-1);
    expect(data?.[0]).toBeCloseTo(alone?.markers[0].lon ?? 0, 6);
    driver.setSelected("iss");
    expect(
      view
        .layers()
        .at(-1)
        ?.markers.map((m) => m.id),
    ).toEqual(["iss"]);
    driver.setInScope(true);
    expect(
      view
        .layers()
        .at(-1)
        ?.markers.map((m) => m.id),
    ).toEqual(["iss", "geo", "bare"]);
  });

  test("keeps moving the lone selected satellite while out of scope", () => {
    const { driver, view, advance } = rig();
    driver.setElements(ELEMENTS);
    driver.setInScope(false);
    driver.setSelected("iss");
    const before = view.positions().length;
    advance(TICK_MS);
    vi.advanceTimersByTime(TICK_MS);
    expect(view.positions().length).toBeGreaterThan(before);
    expect(useOrbit.getState().sample?.id).toBe("iss");
  });

  test("ticks four times a second while following, and once a second after", () => {
    const { driver, view, advance } = rig();
    driver.setElements(ELEMENTS);
    driver.setActive(true);
    driver.setFollowing(true);
    const base = view.positions().length;
    advance(TICK_MS);
    vi.advanceTimersByTime(TICK_MS);
    expect(view.positions().length - base).toBeGreaterThanOrEqual(
      TICK_MS / FOLLOW_TICK_MS,
    );
    driver.setFollowing(false);
    const slowBase = view.positions().length;
    advance(TICK_MS);
    vi.advanceTimersByTime(TICK_MS);
    expect(view.positions().length - slowBase).toBeLessThanOrEqual(2);
  });

  test("redraws the layer as stale when the module goes stale", () => {
    const { driver, view } = rig();
    driver.setElements(ELEMENTS);
    driver.setStale(true);
    expect(view.layers().at(-1)?.stale).toBe(true);
    driver.setStale(true);
    expect(view.layers()).toHaveLength(2);
  });

  test("knows where each satellite is, for search and centring", () => {
    const { driver } = rig();
    driver.setElements(ELEMENTS);
    expect(driver.positionOf("iss")?.lon).toBeCloseTo(-103.1757, 3);
    expect(driver.positionOf("nope")).toBeNull();
    expect(renderedPosition(SATELLITES_ID, "iss")?.lat).toBeCloseTo(-0.0525, 3);
    expect(renderedPosition("aircraft", "iss")).toBeNull();
  });

  test("publishes the orbit of the selected satellite and clears it afterwards", () => {
    const { driver } = rig();
    driver.setElements(ELEMENTS);
    driver.setSelected("iss");
    expect(useOrbit.getState().sample).toMatchObject({ id: "iss" });
    expect(useOrbit.getState().sample?.altKm).toBeCloseTo(417, 0);
    driver.setSelected(null);
    expect(useOrbit.getState().sample).toBeNull();
  });

  test("keeps the selected satellite's orbit current even when the layer is not shown", () => {
    const { driver, view, advance } = rig();
    driver.setElements(ELEMENTS);
    driver.setSelected("iss");
    const first = useOrbit.getState().sample;
    const drawn = view.positions().length;
    advance(TICK_MS);
    vi.advanceTimersByTime(TICK_MS);
    expect(useOrbit.getState().sample?.atMs).toBe((first?.atMs ?? 0) + TICK_MS);
    expect(view.positions()).toHaveLength(drawn);
    driver.setSelected(null);
    const count = view.calls.length;
    vi.advanceTimersByTime(5 * TICK_MS);
    expect(view.calls).toHaveLength(count);
  });

  test("tells the caller when no element set can be read", () => {
    const { driver, problems } = rig();
    driver.setElements([
      satellite("x", { ...ISS_OMM, MEAN_MOTION: "fast" }, null),
    ]);
    expect(problems).toEqual(["None of the element sets could be read."]);
  });

  test("ignores a response that has not loaded yet", () => {
    const { driver, view } = rig();
    driver.setElements(undefined);
    driver.setActive(true);
    vi.advanceTimersByTime(3 * TICK_MS);
    expect(view.calls).toEqual([]);
  });

  test("cleans up completely", () => {
    const { driver, view, port } = rig();
    driver.setElements(ELEMENTS);
    driver.setActive(true);
    driver.setSelected("iss");
    driver.destroy();
    expect(view.calls.at(-1)).toEqual({ kind: "remove" });
    expect(port.terminated).toBe(true);
    expect(useOrbit.getState().sample).toBeNull();
    expect(renderedPosition(SATELLITES_ID, "iss")).toBeNull();
    const count = view.calls.length;
    vi.advanceTimersByTime(5 * TICK_MS);
    expect(view.calls).toHaveLength(count);
  });
});

function segmentOverlay(enabled = true) {
  const base = overlay();
  const segments: {
    data: Float64Array;
    rows: Uint32Array | null;
    count: number;
  }[] = [];
  const port: OverlayPort = {
    ...base.port,
    setSegments: (_id, update: SegmentUpdate) => {
      segments.push({
        data: update.data.slice(0, update.count * SEGMENT_STRIDE),
        rows: update.rows,
        count: update.count,
      });
    },
    segmentMotion: () => enabled,
  };
  return { ...base, port, segments };
}

function segmentRig(enabled = true) {
  const port = new InProcessPort();
  const view = segmentOverlay(enabled);
  let nowMs = ISS_EPOCH_MS;
  const driver = new SatelliteDriver({
    overlay: view.port,
    port,
    now: () => nowMs,
  });
  created.push(driver);
  return {
    driver,
    view,
    advance: (ms: number) => {
      nowMs += ms;
    },
    now: () => nowMs,
  };
}

function cell(
  update: { data: Float64Array },
  satellite: number,
  column: number,
): number {
  return update.data[satellite * SEGMENT_STRIDE + column];
}

describe("the satellite driver in segment mode", () => {
  test("writes segments instead of positions", () => {
    const { driver, view } = segmentRig();
    driver.setElements(ELEMENTS);
    expect(view.segments).toHaveLength(1);
    expect(view.positions()).toHaveLength(0);
    expect(view.segments[0].rows).toBeNull();
    expect(view.segments[0].count).toBe(3);
  });

  test("the first frame is a standing segment shown one display delay late", () => {
    const { driver, view, now } = segmentRig();
    driver.setElements(ELEMENTS);
    const [first] = view.segments;
    const at = (now() + DISPLAY_DELAY_MS) / 1000;
    expect(cell(first, 0, SEGMENT_T0)).toBe(at);
    expect(cell(first, 0, SEGMENT_T1)).toBe(at);
    expect(cell(first, 0, SEGMENT_LON0)).toBe(cell(first, 0, SEGMENT_LON1));
    expect(cell(first, 0, SEGMENT_LAT0)).toBe(cell(first, 0, SEGMENT_LAT1));
  });

  test("the next frame runs from the last positions to the new ones over one tick", () => {
    const { driver, view, advance, now } = segmentRig();
    driver.setElements(ELEMENTS);
    driver.setActive(true);
    const [first] = view.segments;
    const start = now();
    advance(TICK_MS);
    vi.advanceTimersByTime(TICK_MS);
    const latest = view.segments.at(-1);
    expect(latest).not.toBe(first);
    if (!latest) return;
    expect(cell(latest, 0, SEGMENT_T0)).toBe((start + DISPLAY_DELAY_MS) / 1000);
    expect(cell(latest, 0, SEGMENT_T1)).toBe(
      (start + TICK_MS + DISPLAY_DELAY_MS) / 1000,
    );
    expect(cell(latest, 0, SEGMENT_LON0)).toBeCloseTo(
      cell(first, 0, SEGMENT_LON1),
      9,
    );
    expect(cell(latest, 0, SEGMENT_LON1)).not.toBeCloseTo(
      cell(latest, 0, SEGMENT_LON0),
      3,
    );
    expect(cell(latest, 0, SEGMENT_LAT0)).toBeCloseTo(
      cell(first, 0, SEGMENT_LAT1),
      9,
    );
  });

  test("following shortens the span to the quicker tick", () => {
    const { driver, view, advance } = segmentRig();
    driver.setElements(ELEMENTS);
    driver.setActive(true);
    driver.setFollowing(true);
    advance(FOLLOW_TICK_MS);
    vi.advanceTimersByTime(FOLLOW_TICK_MS);
    const latest = view.segments.at(-1);
    if (!latest) throw new Error("no segment written");
    const span = cell(latest, 0, SEGMENT_T1) - cell(latest, 0, SEGMENT_T0);
    expect(span * 1000).toBeLessThanOrEqual(FOLLOW_TICK_MS + 1);
    expect(span).toBeGreaterThan(0);
  });

  test("a long gap between frames makes a standing segment instead of a long chord", () => {
    const { driver, view, advance } = segmentRig();
    driver.setElements(ELEMENTS);
    driver.setActive(true);
    advance(MAX_SEGMENT_MS + 1000);
    vi.advanceTimersByTime(TICK_MS);
    const latest = view.segments.at(-1);
    if (!latest) throw new Error("no segment written");
    expect(cell(latest, 0, SEGMENT_T0)).toBe(cell(latest, 0, SEGMENT_T1));
    expect(cell(latest, 0, SEGMENT_LON0)).toBe(cell(latest, 0, SEGMENT_LON1));
  });

  test("a new set of satellites starts from standing segments", () => {
    const { driver, view, advance } = segmentRig();
    driver.setElements(ELEMENTS);
    driver.setActive(true);
    advance(TICK_MS);
    vi.advanceTimersByTime(TICK_MS);
    driver.setElements(ELEMENTS.slice(0, 2));
    const latest = view.segments.at(-1);
    if (!latest) throw new Error("no segment written");
    expect(latest.count).toBe(2);
    expect(cell(latest, 0, SEGMENT_T0)).toBe(cell(latest, 0, SEGMENT_T1));
  });

  test("the position handed to the camera moves along the segment with the clock", () => {
    const { driver, advance } = segmentRig();
    driver.setElements(ELEMENTS);
    driver.setActive(true);
    advance(TICK_MS);
    vi.advanceTimersByTime(TICK_MS);
    const early = driver.positionOf("iss");
    advance(TICK_MS / 2);
    const middle = driver.positionOf("iss");
    advance(TICK_MS);
    const late = driver.positionOf("iss");
    expect(early && middle && late).toBeTruthy();
    if (!early || !middle || !late) return;
    const toMiddle = Math.hypot(middle.lon - early.lon, middle.lat - early.lat);
    const toLate = Math.hypot(late.lon - early.lon, late.lat - early.lat);
    expect(toMiddle).toBeGreaterThan(0);
    expect(toLate).toBeGreaterThan(toMiddle);
    expect(renderedPosition(SATELLITES_ID, "iss")?.lon).toBeCloseTo(
      late.lon,
      9,
    );
  });

  test("works on only the starred satellites with the segments to match", () => {
    const { driver, view } = segmentRig();
    driver.setElements(ELEMENTS);
    driver.setStars(new Set(["geo"]), true);
    const latest = view.segments.at(-1);
    if (!latest) throw new Error("no segment written");
    expect(latest.count).toBe(1);
    expect(
      view
        .layers()
        .at(-1)
        ?.markers.map((m) => m.id),
    ).toEqual(["geo"]);
  });

  test("keeps moving the lone selected satellite while out of scope", () => {
    const { driver, view, advance } = segmentRig();
    driver.setElements(ELEMENTS);
    driver.setInScope(false);
    driver.setSelected("iss");
    const before = view.segments.length;
    advance(TICK_MS);
    vi.advanceTimersByTime(TICK_MS);
    expect(view.segments.length).toBeGreaterThan(before);
    expect(useOrbit.getState().sample?.id).toBe("iss");
  });

  test("falls back to positions when the overlay stops doing segments", () => {
    const { driver, view } = segmentRig(false);
    driver.setElements(ELEMENTS);
    expect(view.segments).toHaveLength(0);
    expect(view.positions().length).toBeGreaterThan(0);
  });
});
