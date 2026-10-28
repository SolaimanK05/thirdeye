import type { SatelliteElement } from "@/api/client";
import { SatelliteClient, type WorkerPort } from "@/modules/satellites/client";
import { POSITION_STRIDE } from "@/modules/satellites/propagator";
import type { WorkerResponse } from "@/modules/satellites/protocol";
import {
  compact,
  satelliteMarkers,
  satelliteSizing,
} from "@/modules/satellites/render";
import { addPositionProbe } from "@/state/motion";
import { useOrbit } from "@/state/orbit";
import { serverNowMs } from "@/state/stream";
import type { LayerSizing, Marker } from "./markers";

export const SATELLITES_ID = "satellites";
export const TICK_MS = 1000;
export const FOLLOW_TICK_MS = 250;

export type OverlayPort = {
  setLayer: (
    moduleId: string,
    markers: readonly Marker[],
    stale: boolean,
    sizing?: LayerSizing,
  ) => void;
  removeLayer: (moduleId: string) => void;
  setPositions: (moduleId: string, data: Float64Array) => void;
  invalidate: () => void;
};

export type DriverOptions = {
  overlay: OverlayPort;
  port: WorkerPort;
  now?: () => number;
  onProblem?: (message: string) => void;
};

export class SatelliteDriver {
  private readonly overlay: OverlayPort;
  private readonly client: SatelliteClient;
  private readonly now: () => number;
  private readonly onProblem: ((message: string) => void) | undefined;
  private readonly removeProbe: () => void;
  private names: ReadonlyMap<string, string> = new Map();
  private ids: readonly string[] = [];
  private index = new Map<string, number>();
  private latest: Float64Array = new Float64Array(0);
  private scratch: Float64Array = new Float64Array(0);
  private order: Int32Array | null = null;
  private starred: ReadonlySet<string> = new Set();
  private onlyStarred = false;
  private stale = false;
  private selected: string | null = null;
  private active = false;
  private inScope = true;
  private following = false;
  private period = TICK_MS;
  private timer: ReturnType<typeof setInterval> | null = null;
  private haveElements = false;
  private readonly onVisibility = () => this.schedule();

  constructor({ overlay, port, now = serverNowMs, onProblem }: DriverOptions) {
    this.overlay = overlay;
    this.now = now;
    this.onProblem = onProblem;
    this.client = new SatelliteClient(port, (message) => this.receive(message));
    this.removeProbe = addPositionProbe((moduleId, id) =>
      moduleId === SATELLITES_ID ? this.positionOf(id) : null,
    );
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibility);
    }
  }

  setElements(elements: readonly SatelliteElement[] | undefined): void {
    if (elements === undefined) return;
    this.names = new Map(
      elements.flatMap((element) =>
        element.name ? ([[element.id, element.name]] as const) : [],
      ),
    );
    this.haveElements = true;
    this.client.load(elements.map(({ id, name, omm }) => ({ id, name, omm })));
    this.tick(true);
  }

  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    this.schedule();
    if (active) this.tick(true);
  }

  setSelected(id: string | null): void {
    if (id === this.selected) return;
    this.selected = id;
    if (id === null) useOrbit.getState().publish(null);
    this.schedule();
    this.tick(true);
    if (!this.inScope) this.rebuild();
  }

  setInScope(inScope: boolean): void {
    if (inScope === this.inScope) return;
    this.inScope = inScope;
    this.rebuild();
  }

  setFollowing(following: boolean): void {
    if (following === this.following) return;
    this.following = following;
    this.schedule();
  }

  setStars(starred: ReadonlySet<string>, onlyStarred: boolean): void {
    if (starred === this.starred && onlyStarred === this.onlyStarred) return;
    this.starred = starred;
    this.onlyStarred = onlyStarred;
    this.rebuild();
  }

  setStale(stale: boolean): void {
    if (stale === this.stale) return;
    this.stale = stale;
    this.rebuild();
  }

  positionOf(id: string): { lat: number; lon: number } | null {
    const at = this.index.get(id);
    if (at === undefined) return null;
    const from = at * POSITION_STRIDE;
    const lon = this.latest[from];
    const lat = this.latest[from + 1];
    return Number.isFinite(lon) && Number.isFinite(lat) ? { lat, lon } : null;
  }

  destroy(): void {
    this.stop();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    this.removeProbe();
    this.client.terminate();
    this.overlay.removeLayer(SATELLITES_ID);
    useOrbit.getState().publish(null);
  }

  private schedule(): void {
    const visible = typeof document === "undefined" || !document.hidden;
    if ((this.active || this.selected !== null) && visible) {
      const period = this.following ? FOLLOW_TICK_MS : TICK_MS;
      if (this.timer !== null && period !== this.period) this.stop();
      if (this.timer === null) {
        this.period = period;
        this.timer = setInterval(() => this.tick(), period);
        this.tick();
      }
    } else {
      this.stop();
    }
  }

  private stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(now = false): void {
    if (!this.haveElements || (this.timer === null && !now)) return;
    this.client.tick({
      atMs: this.now(),
      selected: this.selected,
    });
  }

  private receive(message: WorkerResponse): void {
    if (message.type === "failed") {
      this.onProblem?.(message.message);
      return;
    }
    if (message.type === "loaded") {
      if (message.loaded === 0 && message.rejected > 0) {
        this.onProblem?.("None of the element sets could be read.");
      }
      return;
    }
    const used = message.count * POSITION_STRIDE;
    if (this.latest.length < used) this.latest = new Float64Array(used);
    this.latest.set(message.positions.subarray(0, used));
    this.client.release(message.positions);
    if (message.ids !== null) {
      this.ids = message.ids;
      this.index = new Map(message.ids.map((id, i) => [id, i]));
      this.rebuild();
    } else if (this.active || this.spotlight()) {
      this.place();
    }
    useOrbit.getState().publish(message.sample);
    this.overlay.invalidate();
  }

  private rebuild(): void {
    if (this.ids.length === 0) {
      this.overlay.removeLayer(SATELLITES_ID);
      return;
    }
    const placement = satelliteMarkers(
      this.ids,
      this.names,
      this.latest,
      this.starred,
      this.only(),
    );
    this.order = placement.order;
    this.overlay.setLayer(
      SATELLITES_ID,
      placement.markers,
      this.stale,
      satelliteSizing,
    );
    this.place();
    this.overlay.invalidate();
  }

  private spotlight(): boolean {
    return !this.inScope && this.selected !== null;
  }

  private only(): ReadonlySet<string> | null {
    if (!this.inScope) {
      return new Set(this.selected === null ? [] : [this.selected]);
    }
    return this.onlyStarred ? this.starred : null;
  }

  private place(): void {
    if (this.order === null) {
      this.overlay.setPositions(SATELLITES_ID, this.latest);
      return;
    }
    this.scratch = compact(this.latest, this.order, this.scratch);
    this.overlay.setPositions(SATELLITES_ID, this.scratch);
  }
}
