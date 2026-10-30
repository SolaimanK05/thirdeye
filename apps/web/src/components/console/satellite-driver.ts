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
import { segmentLonLat } from "./gpu/segment-math";
import {
  type OverlayPort,
  SEGMENT_FADED,
  SEGMENT_H0,
  SEGMENT_H1,
  SEGMENT_LAT0,
  SEGMENT_LAT1,
  SEGMENT_LON0,
  SEGMENT_LON1,
  SEGMENT_STRIDE,
  SEGMENT_T0,
  SEGMENT_T1,
} from "./markers";

export const SATELLITES_ID = "satellites";
export const TICK_MS = 1000;
export const FOLLOW_TICK_MS = 250;
export const DISPLAY_DELAY_MS = 1000;
export const MAX_SEGMENT_MS = 3000;

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
  private previous: Float64Array = new Float64Array(0);
  private latestAtMs = Number.NaN;
  private previousAtMs = Number.NaN;
  private segmentData: Float64Array = new Float64Array(0);
  private span: { from: number; to: number } | null = null;
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
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    const span = this.span;
    if (span !== null && this.segmented()) {
      const startLon = this.previous[from];
      const startLat = this.previous[from + 1];
      if (Number.isFinite(startLon) && Number.isFinite(startLat)) {
        const found = { lon, lat };
        segmentLonLat(
          startLon,
          startLat,
          lon,
          lat,
          span.from,
          span.to,
          this.now() / 1000,
          found,
        );
        return { lat: found.lat, lon: found.lon };
      }
    }
    return { lat, lon };
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
    if (this.latest.length < used) {
      this.latest = new Float64Array(used);
      this.previous = new Float64Array(used);
      this.latestAtMs = Number.NaN;
      this.previousAtMs = Number.NaN;
    }
    const swap = this.previous;
    this.previous = this.latest;
    this.latest = swap;
    this.previousAtMs = this.latestAtMs;
    this.latest.set(message.positions.subarray(0, used));
    this.latestAtMs = message.atMs;
    this.client.release(message.positions);
    if (message.ids !== null) {
      this.ids = message.ids;
      this.index = new Map(message.ids.map((id, i) => [id, i]));
      this.previousAtMs = Number.NaN;
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

  private segmented(): boolean {
    return (
      this.overlay.setSegments !== undefined &&
      this.overlay.segmentMotion?.() === true
    );
  }

  private place(): void {
    if (this.segmented()) {
      this.placeSegments();
      return;
    }
    this.span = null;
    if (this.order === null) {
      this.overlay.setPositions(SATELLITES_ID, this.latest);
      return;
    }
    this.scratch = compact(this.latest, this.order, this.scratch);
    this.overlay.setPositions(SATELLITES_ID, this.scratch);
  }

  private placeSegments(): void {
    const order = this.order;
    const count = order === null ? this.ids.length : order.length;
    const size = count * SEGMENT_STRIDE;
    if (this.segmentData.length < size) {
      this.segmentData = new Float64Array(size);
    }
    const data = this.segmentData;
    const gap = this.latestAtMs - this.previousAtMs;
    const continuous = gap > 0 && gap <= MAX_SEGMENT_MS;
    const end = this.latestAtMs + DISPLAY_DELAY_MS;
    const start = continuous ? this.previousAtMs + DISPLAY_DELAY_MS : end;
    this.span = { from: start / 1000, to: end / 1000 };
    for (let i = 0; i < count; i++) {
      const source = (order === null ? i : order[i]) * POSITION_STRIDE;
      const at = i * SEGMENT_STRIDE;
      const lon = this.latest[source];
      const lat = this.latest[source + 1];
      data[at + SEGMENT_LON1] = lon;
      data[at + SEGMENT_LAT1] = lat;
      data[at + SEGMENT_LON0] = continuous ? this.previous[source] : lon;
      data[at + SEGMENT_LAT0] = continuous ? this.previous[source + 1] : lat;
      data[at + SEGMENT_T0] = this.span.from;
      data[at + SEGMENT_T1] = this.span.to;
      data[at + SEGMENT_H0] = Number.NaN;
      data[at + SEGMENT_H1] = Number.NaN;
      data[at + SEGMENT_FADED] = this.latest[source + 3];
    }
    this.overlay.setSegments?.(SATELLITES_ID, { data, rows: null, count });
  }
}
