import { beforeEach, describe, expect, it } from "vitest";
import { SEGMENT_STRIDE } from "@/components/console/markers";
import { aircraftRefine } from "@/modules/aircraft/refine";
import { defaultValues } from "@/modules/refine";
import { DataCore } from "./core";
import { FrameGapError } from "./mirror";
import type { FromWorker } from "./protocol";
import { frameOf } from "./test-frames";

const T0 = 1_800_000_000;
const NOW_MS = () => (T0 + 30) * 1000;

function setup(options: { delay?: number } = {}) {
  const sent: FromWorker[] = [];
  let now = NOW_MS();
  const core = new DataCore({
    emit: (message) => {
      sent.push(message);
    },
    clock: () => now,
    now: () => 0,
  });
  core.setMovers([{ id: "aircraft", delaySeconds: options.delay ?? 5 }]);
  return {
    core,
    sent,
    advance: (ms: number) => {
      now += ms;
    },
    take: <T extends FromWorker["type"]>(type: T) =>
      sent.filter(
        (m): m is Extract<FromWorker, { type: T }> => m.type === type,
      ),
  };
}

function cruising(slot: number, lon: number, extra = {}) {
  return {
    slot,
    lon,
    lat: 10,
    t: T0 + 25,
    sog: 450,
    cog: 90,
    heading: 90,
    alt: 11_000,
    ...extra,
  };
}

function last<T>(items: T[]): T {
  const item = items.at(-1);
  if (item === undefined) throw new Error("nothing was sent");
  return item;
}

describe("DataCore frames", () => {
  let env: ReturnType<typeof setup>;
  beforeEach(() => {
    env = setup();
  });

  it("announces a snapshot as a dictionary, then a layer, then full segments", () => {
    const { core, sent, take } = env;
    core.applyFrame(
      "aircraft",
      frameOf({
        version: 1,
        rows: [cruising(0, 10), cruising(1, 20), cruising(2, 30)],
      }),
    );
    core.step();
    expect(sent.map((m) => m.type).filter((t) => t !== "mode")).toEqual([
      "dictionary",
      "layer",
      "segments",
    ]);
    const [dictionary] = take("dictionary");
    expect(dictionary.reset).toBe(true);
    expect([...dictionary.slots]).toEqual([0, 1, 2]);
    const [layer] = take("layer");
    expect([...layer.slots]).toEqual([0, 1, 2]);
    expect(layer.total).toBe(3);
    expect(layer.kept).toBe(3);
    expect(layer.lon[1]).toBeCloseTo(20, 6);
    expect(layer.rotation[0]).toBeCloseTo(90, 5);
    const [segments] = take("segments");
    expect(segments.rows).toBeNull();
    expect(segments.data.length).toBe(3 * SEGMENT_STRIDE);
    expect(segments.seq).toBe(layer.seq);
  });

  it("sends only the changed rows when positions move and no layer", () => {
    const { core, take, advance } = env;
    core.applyFrame(
      "aircraft",
      frameOf({
        version: 1,
        rows: [cruising(0, 10), cruising(1, 20), cruising(2, 30)],
      }),
    );
    core.step();
    const layers = take("layer").length;
    advance(1000);
    core.applyFrame(
      "aircraft",
      frameOf({
        kind: "delta",
        version: 2,
        rows: [cruising(1, 20.5, { t: T0 + 31 })],
      }),
    );
    core.step();
    expect(take("layer")).toHaveLength(layers);
    const partial = take("segments").at(-1);
    expect(partial?.rows).not.toBeNull();
    expect([...(partial?.rows ?? [])]).toEqual([1]);
    expect(partial?.data.length).toBe(SEGMENT_STRIDE);
  });

  it("announces a new layer when a slot appears or is removed", () => {
    const { core, take } = env;
    core.applyFrame(
      "aircraft",
      frameOf({ version: 1, rows: [cruising(0, 10), cruising(1, 20)] }),
    );
    core.applyFrame(
      "aircraft",
      frameOf({
        kind: "delta",
        version: 2,
        rows: [cruising(2, 30)],
        text: true,
      }),
    );
    core.applyFrame(
      "aircraft",
      frameOf({ kind: "delta", version: 3, rows: [], removes: [0] }),
    );
    const layers = take("layer");
    expect(layers.map((l) => [...l.slots])).toEqual([
      [0, 1],
      [0, 1, 2],
      [1, 2],
    ]);
    expect(layers.map((l) => l.seq)).toEqual([1, 2, 3]);
    const dictionaries = take("dictionary");
    expect(dictionaries.map((d) => d.reset)).toEqual([true, false]);
    expect([...dictionaries[1].slots]).toEqual([2]);
  });

  it("rejects a delta that does not follow the version it holds", () => {
    const { core } = env;
    core.applyFrame(
      "aircraft",
      frameOf({ version: 5, rows: [cruising(0, 10)] }),
    );
    expect(() =>
      core.applyFrame(
        "aircraft",
        frameOf({ kind: "delta", version: 8, base: 7, rows: [] }),
      ),
    ).toThrow(FrameGapError);
    expect(() =>
      core.applyFrame(
        "aircraft",
        frameOf({ kind: "delta", version: 6, epoch: 2, rows: [] }),
      ),
    ).toThrow(FrameGapError);
    expect(core.versionOf("aircraft")).toBe(5);
  });

  it("starts over on a new slot epoch", () => {
    const { core, take } = env;
    core.applyFrame(
      "aircraft",
      frameOf({ version: 3, rows: [cruising(0, 10), cruising(1, 20)] }),
    );
    core.applyFrame(
      "aircraft",
      frameOf({ version: 9, epoch: 2, rows: [cruising(0, 99)] }),
    );
    const layers = take("layer");
    expect([...(layers.at(-1)?.slots ?? [])]).toEqual([0]);
    expect(layers.at(-1)?.lon[0]).toBeCloseTo(99, 6);
    expect(core.epochOf("aircraft")).toBe(2);
  });

  it("ignores frames for modules it was not asked to follow", () => {
    const { core, sent } = env;
    core.applyFrame("vessels", frameOf({ version: 1, rows: [cruising(0, 1)] }));
    expect(sent).toHaveLength(0);
  });
});

describe("DataCore refine and keep", () => {
  const rows = [
    cruising(0, 1, { alt: 11_000 }),
    cruising(1, 2, { alt: 100 }),
    cruising(2, 3, { alt: 9_000 }),
    cruising(3, 4, { alt: null }),
    cruising(4, 5, { alt: 0, onGround: true }),
  ];

  it("keeps rows that pass the altitude floor and counts them", () => {
    const { core, take } = setup();
    core.applyFrame("aircraft", frameOf({ version: 1, rows }));
    const layer = last(take("layer"));
    expect([...layer.slots]).toEqual([0, 2]);
    expect(layer.kept).toBe(2);
    expect(layer.total).toBe(5);
  });

  it("brings rows back when the range is widened", () => {
    const { core, take } = setup();
    core.applyFrame("aircraft", frameOf({ version: 1, rows }));
    core.setRefine("aircraft", { altitude: [0, 60_000] });
    const layer = last(take("layer"));
    expect([...layer.slots]).toEqual([0, 1, 2, 3, 4]);
    expect(layer.kept).toBe(5);
  });

  it("always keeps selected and starred rows", () => {
    const { core, take } = setup();
    core.applyFrame("aircraft", frameOf({ version: 1, rows }));
    core.setKeep("aircraft", Uint32Array.of(1, 4), Uint32Array.of(4), false);
    const layer = last(take("layer"));
    expect([...layer.slots]).toEqual([0, 1, 2, 4]);
    expect(layer.kept).toBe(4);
  });

  it("shows only starred rows when asked, without changing the counts", () => {
    const { core, take } = setup();
    core.applyFrame("aircraft", frameOf({ version: 1, rows }));
    core.setKeep("aircraft", Uint32Array.of(4), Uint32Array.of(4), true);
    const layer = last(take("layer"));
    expect([...layer.slots]).toEqual([4]);
    expect(layer.kept).toBe(3);
    expect(layer.total).toBe(5);
  });

  it("does not re-announce when a refine change leaves the rows alone", () => {
    const { core, take } = setup();
    core.applyFrame("aircraft", frameOf({ version: 1, rows }));
    const before = take("layer").length;
    core.setRefine("aircraft", { altitude: [26_000, 60_000] });
    core.setRefine("aircraft", defaultValues(aircraftRefine.controls));
    expect(take("layer").length).toBeGreaterThanOrEqual(before);
    const after = take("layer").length;
    core.setRefine("aircraft", defaultValues(aircraftRefine.controls));
    expect(take("layer")).toHaveLength(after);
  });
});

describe("DataCore settings that arrive early", () => {
  it("applies refine, keep and visibility sent before the module existed", () => {
    const sent: FromWorker[] = [];
    const core = new DataCore({
      emit: (message) => {
        sent.push(message);
      },
      clock: NOW_MS,
      now: () => 0,
    });
    core.setRefine("aircraft", { altitude: [0, 60_000] });
    core.setKeep("aircraft", Uint32Array.of(1), Uint32Array.of(1), true);
    core.setMovers([{ id: "aircraft", delaySeconds: 5 }]);
    core.applyFrame(
      "aircraft",
      frameOf({
        version: 1,
        rows: [cruising(0, 1, { alt: 50 }), cruising(1, 2, { alt: 50 })],
      }),
    );
    const layer = sent.filter((m) => m.type === "layer").at(-1);
    expect(layer?.type === "layer" && [...layer.slots]).toEqual([1]);
    expect(layer?.type === "layer" && layer.kept).toBe(2);
  });
});

describe("DataCore visibility and feeds", () => {
  it("stays quiet while hidden and catches up when shown", () => {
    const { core, sent, take } = setup();
    core.setVisible("aircraft", false);
    core.applyFrame(
      "aircraft",
      frameOf({ version: 1, rows: [cruising(0, 10)] }),
    );
    core.step();
    expect(take("layer")).toHaveLength(0);
    expect(take("segments")).toHaveLength(0);
    core.setVisible("aircraft", true);
    core.step();
    expect(take("layer")).toHaveLength(1);
    expect(take("segments")).toHaveLength(1);
    expect(sent.some((m) => m.type === "mode")).toBe(true);
  });

  it("sends the layer and all segments again when the page asks", () => {
    const { core, take } = setup();
    core.applyFrame(
      "aircraft",
      frameOf({ version: 1, rows: [cruising(0, 10), cruising(1, 20)] }),
    );
    core.step();
    expect(take("layer")).toHaveLength(1);
    core.announce("aircraft");
    core.step();
    const layers = take("layer");
    expect(layers).toHaveLength(2);
    expect([...layers[1].slots]).toEqual([0, 1]);
    expect(layers[1].seq).toBeGreaterThan(layers[0].seq);
    const segments = take("segments");
    expect(segments.at(-1)?.rows).toBeNull();
    expect(segments.at(-1)?.seq).toBe(layers[1].seq);
  });

  it("has nothing to announce for a hidden or unknown module", () => {
    const { core, take } = setup();
    core.setVisible("aircraft", false);
    core.applyFrame(
      "aircraft",
      frameOf({ version: 1, rows: [cruising(0, 10)] }),
    );
    core.announce("aircraft");
    core.announce("unknown");
    expect(take("layer")).toHaveLength(0);
  });

  it("feeds positions to the canvas renderer instead of segments", () => {
    const { core, take } = setup();
    core.setFeed("positions");
    core.applyFrame(
      "aircraft",
      frameOf({ version: 1, rows: [cruising(0, 10), cruising(1, 20)] }),
    );
    core.step();
    expect(take("segments")).toHaveLength(0);
    const [positions] = take("positions");
    expect(positions.data).toHaveLength(8);
    expect(positions.data[0]).toBeGreaterThan(9.9);
    expect(positions.data[2]).toBeCloseTo(90, 3);
  });

  it("reports whether an interpolating or extrapolating pose is shown", () => {
    const { core, take } = setup({ delay: 0 });
    core.applyFrame(
      "aircraft",
      frameOf({ version: 1, rows: [cruising(0, 10)] }),
    );
    core.step();
    expect(take("mode").at(-1)?.mode).toBe("extrapolated");
  });
});
