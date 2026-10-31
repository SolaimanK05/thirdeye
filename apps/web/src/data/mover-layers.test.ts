import { describe, expect, it } from "vitest";
import type { ColumnarLayer } from "@/components/console/marker-overlay";
import type { SegmentUpdate } from "@/components/console/markers";
import { DataHub, type WorkerPort } from "./hub";
import { type LayerSurface, MoverLayers } from "./mover-layers";
import type { FromWorker, ToWorker } from "./protocol";

function setup() {
  const posted: ToWorker[] = [];
  const listeners = new Set<(event: MessageEvent<FromWorker>) => void>();
  const port: WorkerPort = {
    postMessage: (message) => {
      posted.push(message);
    },
    terminate: () => {},
    addEventListener: (_t, l) => {
      listeners.add(l);
    },
    removeEventListener: (_t, l) => {
      listeners.delete(l);
    },
  };
  const hub = new DataHub(port);
  const layers: { id: string; layer: ColumnarLayer; stale: boolean }[] = [];
  const segments: { id: string; update: SegmentUpdate }[] = [];
  const positions: string[] = [];
  const removed: string[] = [];
  const surface: LayerSurface = {
    setColumnarLayer: (id, layer, stale) => {
      layers.push({ id, layer, stale });
    },
    setSegments: (id, update) => {
      segments.push({ id, update });
    },
    setPositions: (id) => {
      positions.push(id);
    },
    removeLayer: (id) => {
      removed.push(id);
    },
  };
  const stats: [string, { kept: number; total: number } | null][] = [];
  const modes: [string, string | null][] = [];
  const bridge = new MoverLayers(hub, surface, {
    setStat: (id, stat) => stats.push([id, stat]),
    setMode: (id, mode) => modes.push([id, mode]),
  });
  const deliver = (message: FromWorker) => {
    for (const listener of listeners) {
      listener({ data: message } as MessageEvent<FromWorker>);
    }
  };
  return {
    hub,
    bridge,
    posted,
    layers,
    segments,
    positions,
    removed,
    stats,
    modes,
    deliver,
  };
}

const text = (entries: [number, string][]) => {
  const enc = new TextEncoder();
  const parts = entries.map(([, id]) => enc.encode(id));
  const offsetList = [0];
  for (const part of parts) {
    offsetList.push(offsetList[offsetList.length - 1] + part.length);
  }
  const offsets = Uint32Array.from(offsetList);
  const bytes = Uint8Array.from(parts.flatMap((p) => [...p]));
  return {
    type: "dictionary",
    moduleId: "aircraft",
    epoch: 1,
    reset: true,
    slots: Uint32Array.from(entries.map(([slot]) => slot)),
    idOffsets: offsets,
    idBytes: bytes,
    nameOffsets: offsets,
    nameBytes: bytes,
  } satisfies FromWorker;
};

const layerMessage = (seq: number, slots: number[]): FromWorker => ({
  type: "layer",
  moduleId: "aircraft",
  seq,
  epoch: 1,
  version: seq,
  slots: Uint32Array.from(slots),
  rotation: new Float32Array(slots.length),
  lon: new Float64Array(slots.length),
  lat: new Float64Array(slots.length),
  kept: slots.length,
  total: slots.length + 2,
  fetchedMs: 0,
  sentAt: 0,
});

const STYLE = { glyph: "plane", size: 20, adaptive: true } as const;
const config = (starred: string[] = [], stale = false) => ({
  style: STYLE,
  stale,
  starred: new Set(starred),
});

describe("MoverLayers", () => {
  it("draws a layer once it has both a layer message and a configuration", () => {
    const env = setup();
    env.deliver(
      text([
        [0, "a"],
        [3, "b"],
      ]),
    );
    env.deliver(layerMessage(1, [0, 3]));
    expect(env.layers).toHaveLength(0);
    env.bridge.configure("aircraft", config());
    expect(env.layers).toHaveLength(1);
    expect(env.layers[0].layer.rows.count).toBe(2);
    expect(env.layers[0].layer.rows.idAt(1)).toBe("b");
    expect(env.stats.at(-1)).toEqual(["aircraft", { kept: 2, total: 4 }]);
  });

  it("asks the worker for the layer again when a removed module comes back", () => {
    const env = setup();
    env.bridge.configure("aircraft", config());
    env.deliver(text([[0, "a"]]));
    env.deliver(layerMessage(1, [0]));
    // React runs effect cleanups and effects again on a remount.
    env.bridge.remove("aircraft");
    env.bridge.configure("aircraft", config());
    expect(env.posted.filter((m) => m.type === "announce")).toEqual([
      { type: "announce", moduleId: "aircraft" },
    ]);
    // The answer draws like the first layer did.
    env.deliver(text([[0, "a"]]));
    env.deliver(layerMessage(2, [0]));
    expect(env.layers).toHaveLength(2);
  });

  it("does not ask on the first configuration or when it still holds a layer", () => {
    const env = setup();
    env.bridge.configure("aircraft", config());
    env.deliver(text([[0, "a"]]));
    env.deliver(layerMessage(1, [0]));
    env.bridge.configure("aircraft", config([], true));
    expect(env.posted.filter((m) => m.type === "announce")).toEqual([]);
  });

  it("redraws with new staleness or style without waiting for the worker", () => {
    const env = setup();
    env.bridge.configure("aircraft", config());
    env.deliver(text([[0, "a"]]));
    env.deliver(layerMessage(1, [0]));
    env.bridge.configure("aircraft", config([], true));
    expect(env.layers.map((l) => l.stale)).toEqual([false, true]);
  });

  it("turns starred ids into row indices for the accent tone", () => {
    const env = setup();
    env.bridge.configure("aircraft", config(["b", "missing"]));
    env.deliver(
      text([
        [0, "a"],
        [3, "b"],
        [9, "c"],
      ]),
    );
    env.deliver(layerMessage(1, [0, 3, 9]));
    expect([...env.layers[0].layer.starred]).toEqual([1]);
    expect(env.layers[0].layer.rows.markerAt(1).tone).toBe("accent");
  });

  it("applies segments only to the layer they were built for", () => {
    const env = setup();
    env.bridge.configure("aircraft", config());
    env.deliver(
      text([
        [0, "a"],
        [1, "b"],
      ]),
    );
    env.deliver(layerMessage(2, [0, 1]));
    env.deliver({
      type: "segments",
      moduleId: "aircraft",
      seq: 1,
      rows: null,
      data: new Float64Array(18),
      sentAt: 0,
    });
    expect(env.segments).toHaveLength(0);
    env.deliver({
      type: "segments",
      moduleId: "aircraft",
      seq: 2,
      rows: null,
      data: new Float64Array(18),
      sentAt: 0,
    });
    env.deliver({
      type: "segments",
      moduleId: "aircraft",
      seq: 2,
      rows: Uint32Array.of(1),
      data: new Float64Array(9),
      sentAt: 0,
    });
    expect(env.segments.map((s) => [s.update.count, s.update.packed])).toEqual([
      [2, false],
      [1, true],
    ]);
  });

  it("passes positions through for the canvas renderer, and mode to its sink", () => {
    const env = setup();
    env.bridge.configure("aircraft", config());
    env.deliver(text([[0, "a"]]));
    env.deliver(layerMessage(1, [0]));
    env.deliver({
      type: "positions",
      moduleId: "aircraft",
      seq: 1,
      data: new Float64Array(4),
      sentAt: 0,
    });
    env.deliver({ type: "mode", moduleId: "aircraft", mode: "extrapolated" });
    expect(env.positions).toEqual(["aircraft"]);
    expect(env.modes).toEqual([["aircraft", "extrapolated"]]);
  });

  it("tells the worker which slots to keep, and resolves again as text arrives", () => {
    const env = setup();
    env.bridge.setKeep("aircraft", new Set(["b"]), false, new Set(["b"]));
    const keeps = () => env.posted.filter((m) => m.type === "keep");
    expect(keeps()).toHaveLength(1);
    env.deliver(
      text([
        [0, "a"],
        [3, "b"],
      ]),
    );
    const last = keeps().at(-1);
    expect(last?.type === "keep" && [...last.keep]).toEqual([3]);
    expect(last?.type === "keep" && [...last.starred]).toEqual([3]);
  });

  it("does not repeat a keep message that would say the same thing", () => {
    const env = setup();
    env.bridge.configure("aircraft", config(["b"]));
    env.deliver(
      text([
        [0, "a"],
        [3, "b"],
      ]),
    );
    env.bridge.setKeep("aircraft", new Set(["b"]), false, new Set(["b"]));
    const before = env.posted.length;
    env.bridge.setKeep("aircraft", new Set(["b"]), false, new Set(["b"]));
    env.deliver(layerMessage(1, [0, 3]));
    expect(env.posted.length).toBe(before);
  });

  it("removes the layer and its numbers", () => {
    const env = setup();
    env.bridge.remove("aircraft");
    expect(env.removed).toEqual(["aircraft"]);
    expect(env.stats.at(-1)).toEqual(["aircraft", null]);
    expect(env.modes.at(-1)).toEqual(["aircraft", null]);
  });
});
