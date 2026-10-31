import type { RefineValues } from "@/modules/refine";
import { SlotDictionary } from "./dictionary";
import type { FromWorker, MotionFeed, MoverSpec, ToWorker } from "./protocol";
import { type HubStats, StatsTracker } from "./stats";

export type WorkerPort = {
  postMessage: (message: ToWorker, transfer: Transferable[]) => void;
  terminate: () => void;
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<FromWorker>) => void,
  ) => void;
  removeEventListener: (
    type: "message",
    listener: (event: MessageEvent<FromWorker>) => void,
  ) => void;
};

export type HubListener = (message: FromWorker) => void;

/**
 * The page's end of the data worker: sends it commands, keeps the per-module
 * dictionaries, and passes everything it sends back to whoever is listening.
 */
export class DataHub {
  private readonly port: WorkerPort;
  private readonly listener: (event: MessageEvent<FromWorker>) => void;
  private readonly listeners = new Set<HubListener>();
  private readonly dictionaries = new Map<string, SlotDictionary>();
  private readonly tracker = new StatsTracker();
  private readonly wallClock: () => number;
  private readonly busyClock: () => number;
  private closed = false;

  constructor(
    port: WorkerPort,
    wallClock: () => number = () => performance.timeOrigin + performance.now(),
    busyClock: () => number = () => performance.now(),
  ) {
    this.port = port;
    this.wallClock = wallClock;
    this.busyClock = busyClock;
    this.listener = (event) => this.receive(event.data);
    port.addEventListener("message", this.listener);
  }

  get stats(): HubStats {
    return this.tracker.view;
  }

  dictionaryOf(moduleId: string): SlotDictionary {
    let dictionary = this.dictionaries.get(moduleId);
    if (!dictionary) {
      dictionary = new SlotDictionary();
      this.dictionaries.set(moduleId, dictionary);
    }
    return dictionary;
  }

  subscribe(listener: HubListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(options: {
    apiUrl: string;
    movers: MoverSpec[];
    clockOffsetMs: number;
    feed: MotionFeed;
  }): void {
    this.send({ type: "init", ...options });
  }

  setMovers(movers: MoverSpec[]): void {
    this.send({ type: "movers", movers });
  }

  notice(moduleId: string, version: number): void {
    this.send({ type: "notice", moduleId, version });
  }

  resync(): void {
    this.send({ type: "resync" });
  }

  setClock(offsetMs: number): void {
    this.send({ type: "clock", offsetMs });
  }

  setFeed(feed: MotionFeed): void {
    this.send({ type: "feed", feed });
  }

  setRefine(moduleId: string, values: RefineValues): void {
    this.send({ type: "refine", moduleId, values });
  }

  setKeep(
    moduleId: string,
    keep: Uint32Array,
    starred: Uint32Array,
    onlyStarred: boolean,
  ): void {
    this.send({ type: "keep", moduleId, keep, starred, onlyStarred });
  }

  setVisible(moduleId: string, visible: boolean): void {
    this.send({ type: "visible", moduleId, visible });
  }

  /** Ask for the module's layer again, for a page that lost what it had. */
  announce(moduleId: string): void {
    this.send({ type: "announce", moduleId });
  }

  destroy(): void {
    if (this.closed) return;
    this.send({ type: "stop" });
    this.closed = true;
    this.port.removeEventListener("message", this.listener);
    this.port.terminate();
    this.listeners.clear();
  }

  private send(message: ToWorker): void {
    if (this.closed) return;
    this.port.postMessage(message, []);
  }

  private receive(message: FromWorker): void {
    switch (message.type) {
      case "dictionary": {
        const dictionary = this.dictionaryOf(message.moduleId);
        if (message.reset) dictionary.reset(message.epoch);
        dictionary.append(message);
        break;
      }
      case "layer":
      case "segments":
      case "positions":
        this.tracker.transfer(this.wallClock() - message.sentAt);
        break;
      case "stats":
        // Timed where the worker made it, so a busy page cannot squash the interval.
        this.tracker.report(message.stats, message.sentAt);
        break;
      default:
        break;
    }
    const started = this.busyClock();
    for (const listener of this.listeners) listener(message);
    if (message.type !== "stats") {
      this.tracker.page(this.busyClock() - started);
    }
  }
}
