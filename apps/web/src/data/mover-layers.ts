import type { ColumnarStyle } from "@/components/console/layer-state";
import type {
  ColumnarLayer,
  MarkerOverlay,
} from "@/components/console/marker-overlay";
import type { LayerOptions, LayerSizing } from "@/components/console/markers";
import type { MotionMode } from "@/state/motion";
import { ColumnarRows } from "./columnar-rows";
import type { DataHub } from "./hub";
import type { FromWorker } from "./protocol";

/** What the overlay port of `MarkerOverlay` has to offer to the data layers. */
export type LayerSurface = Pick<
  MarkerOverlay,
  "setColumnarLayer" | "removeLayer" | "setSegments" | "setPositions"
>;

export type LayerSinks = {
  setStat: (
    moduleId: string,
    stat: { kept: number; total: number } | null,
  ) => void;
  setMode: (moduleId: string, mode: MotionMode | null) => void;
};

export type LayerConfig = {
  style: ColumnarStyle;
  stale: boolean;
  sizing?: LayerSizing;
  options?: LayerOptions;
  starred: ReadonlySet<string>;
};

type Layer = Extract<FromWorker, { type: "layer" }>;

type Entry = {
  config: LayerConfig | null;
  layer: Layer | null;
  keep: {
    ids: ReadonlySet<string>;
    starred: ReadonlySet<string>;
    onlyStarred: boolean;
  } | null;
  sentKeep: string;
};

/**
 * Applies what the data worker sends to the overlay as it arrives. Layers go
 * in synchronously, in message order, so a segment patch always meets the
 * layer it was built for.
 */
export class MoverLayers {
  private readonly hub: DataHub;
  private readonly surface: LayerSurface;
  private readonly sinks: LayerSinks;
  private readonly entries = new Map<string, Entry>();
  /** Modules whose layer was dropped here; the worker must send theirs again. */
  private readonly dropped = new Set<string>();
  private readonly unsubscribe: () => void;

  constructor(hub: DataHub, surface: LayerSurface, sinks: LayerSinks) {
    this.hub = hub;
    this.surface = surface;
    this.sinks = sinks;
    this.unsubscribe = hub.subscribe((message) => this.receive(message));
  }

  /** Style, staleness and starred ids for a module; redraws what it already has. */
  configure(moduleId: string, config: LayerConfig): void {
    const entry = this.entry(moduleId);
    entry.config = config;
    if (entry.layer) {
      this.apply(moduleId, entry);
    } else if (this.dropped.delete(moduleId)) {
      // The module came back after `remove` (React remounts effects), and the
      // worker will not repeat a layer it already sent.
      this.hub.announce(moduleId);
    }
  }

  /**
   * Tell the worker which rows must never be filtered out (starred and the
   * selected one) and whether only the starred ones are wanted.
   */
  setKeep(
    moduleId: string,
    ids: ReadonlySet<string>,
    onlyStarred: boolean,
    starred: ReadonlySet<string>,
  ): void {
    const entry = this.entry(moduleId);
    entry.keep = { ids, starred, onlyStarred };
    this.sendKeep(moduleId, entry);
  }

  remove(moduleId: string): void {
    this.surface.removeLayer(moduleId);
    this.sinks.setStat(moduleId, null);
    this.sinks.setMode(moduleId, null);
    this.entries.delete(moduleId);
    this.dropped.add(moduleId);
  }

  destroy(): void {
    this.unsubscribe();
    for (const moduleId of [...this.entries.keys()]) this.remove(moduleId);
  }

  private entry(moduleId: string): Entry {
    let entry = this.entries.get(moduleId);
    if (!entry) {
      entry = { config: null, layer: null, keep: null, sentKeep: "" };
      this.entries.set(moduleId, entry);
    }
    return entry;
  }

  private receive(message: FromWorker): void {
    switch (message.type) {
      case "dictionary": {
        const entry = this.entries.get(message.moduleId);
        if (entry?.keep) this.sendKeep(message.moduleId, entry);
        break;
      }
      case "layer": {
        const entry = this.entry(message.moduleId);
        this.dropped.delete(message.moduleId);
        entry.layer = message;
        this.sinks.setStat(message.moduleId, {
          kept: message.kept,
          total: message.total,
        });
        if (entry.config) this.apply(message.moduleId, entry);
        break;
      }
      case "segments": {
        const entry = this.entries.get(message.moduleId);
        if (entry?.layer?.seq !== message.seq) break;
        this.surface.setSegments(message.moduleId, {
          data: message.data,
          rows: message.rows,
          count:
            message.rows === null
              ? entry.layer.slots.length
              : message.rows.length,
          packed: message.rows !== null,
        });
        break;
      }
      case "positions": {
        const entry = this.entries.get(message.moduleId);
        if (entry?.layer?.seq !== message.seq) break;
        this.surface.setPositions(message.moduleId, message.data);
        break;
      }
      case "mode":
        this.sinks.setMode(message.moduleId, message.mode);
        break;
      default:
        break;
    }
  }

  private apply(moduleId: string, entry: Entry): void {
    const { layer, config } = entry;
    if (!layer || !config) return;
    const dictionary = this.hub.dictionaryOf(moduleId);
    const starredRows = new Set<number>();
    const rows = new ColumnarRows({
      slots: layer.slots,
      dictionary,
      lon: layer.lon,
      lat: layer.lat,
      rotation: layer.rotation,
      style: config.style,
      starred: starredRows,
    });
    if (config.starred.size > 0) {
      for (const id of config.starred) {
        const slot = dictionary.slotOf(id);
        if (slot === undefined) continue;
        const row = rows.rowOfSlot(slot);
        if (row >= 0) starredRows.add(row);
      }
    }
    const columnar: ColumnarLayer = {
      rows,
      lon: layer.lon,
      lat: layer.lat,
      rotation: layer.rotation,
      style: config.style,
      starred: Uint32Array.from([...starredRows].sort((a, b) => a - b)),
    };
    this.surface.setColumnarLayer(
      moduleId,
      columnar,
      config.stale,
      config.sizing,
      config.options,
    );
  }

  private sendKeep(moduleId: string, entry: Entry): void {
    const { keep } = entry;
    if (!keep) return;
    const dictionary = this.hub.dictionaryOf(moduleId);
    const resolve = (ids: ReadonlySet<string>): Uint32Array => {
      const slots: number[] = [];
      if (ids.size > 0) {
        for (const id of ids) {
          const slot = dictionary.slotOf(id);
          if (slot !== undefined) slots.push(slot);
        }
      }
      return Uint32Array.from(slots.sort((a, b) => a - b));
    };
    const keepSlots = resolve(keep.ids);
    const starredSlots = resolve(keep.starred);
    const key = `${keep.onlyStarred}|${keepSlots.join(",")}|${starredSlots.join(",")}|${dictionary.epoch}`;
    if (key === entry.sentKeep) return;
    entry.sentKeep = key;
    this.hub.setKeep(moduleId, keepSlots, starredSlots, keep.onlyStarred);
  }
}
