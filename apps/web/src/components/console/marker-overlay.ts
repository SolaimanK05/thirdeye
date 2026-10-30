import {
  Cartesian3,
  type CesiumWidget,
  Matrix4,
  PerspectiveFrustum,
  SceneMode,
} from "cesium";
import { perfMetrics } from "@/perf/metrics";
import { serverNowMs } from "@/state/stream";
import { CanvasRenderer } from "./canvas-renderer";
import { glyphIndex } from "./glyphs";
import { cssToRgba } from "./gpu/colour";
import { geodeticToEcef, MAX_LAYERS, WGS84_RADII } from "./gpu/encode";
import { createFrame, fillFrame, premultipliedTones } from "./gpu/frame";
import { evaluateSegmentEcef } from "./gpu/segment-math";
import { WebGlRenderer } from "./gpu/webgl-renderer";
import {
  applyPositions,
  applySegments,
  buildLayer,
  dirtyRuns,
  findIndex,
  freezeAt,
  hasDirty,
  type LayerState,
  markClean,
} from "./layer-state";
import type {
  LayerOptions,
  LayerSizing,
  Marker,
  OverlayStats,
  SegmentUpdate,
} from "./markers";
import {
  type CrumbDot,
  LabelPainter,
  type NameLabel,
  type SelectedMark,
} from "./overlay-labels";
import { type ScreenPoint, ScreenProjection } from "./projection";
import type {
  DrawOutcome,
  MarkerPalette,
  MarkerRenderer,
  RenderLayer,
} from "./renderer";
import {
  SCAN_EDGE_MARGIN,
  type ScanLayer,
  VisibilityScan,
} from "./visibility-scan";

export type { MarkerPalette } from "./renderer";

export type OverlayChange = "layer" | "visibility" | "renderer";

export type InViewReport = (counts: Readonly<Record<string, number>>) => void;

export type OverlayCanvases = {
  gl: HTMLCanvasElement;
  labels: HTMLCanvasElement;
};

export type OverlayOptions = {
  renderer?: "auto" | "canvas";
  clock?: () => number;
  report?: InViewReport;
  warn?: (message: string) => void;
};

const COUNT_REPORT_MS = 1000;
const MOTION_FRAME_MS = 30;
const SWEEP_MOVING_MS = 1000;
const REBASE_SECONDS = 2 * 3600;
const SCAN_BUDGET_MS = 1.5;
const CRUMB_MIN_ALPHA = 0.4;

function sameCounts(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => a[key] === b[key])
  );
}

function defaultWarn(message: string): void {
  console.warn(`Third Eye markers: ${message}`);
}

export class MarkerOverlay {
  private readonly widget: CesiumWidget;
  private readonly canvases: OverlayCanvases;
  private readonly palette: MarkerPalette;
  private readonly layers = new Map<string, LayerState>();
  private readonly slots: (string | null)[] = [];
  private readonly hidden = new Set<string>();
  private readonly listeners = new Set<
    (moduleId: string, change: OverlayChange) => void
  >();
  private readonly removeListener: () => void;
  private readonly removePreUpdate: () => void;
  private readonly clock: () => number;
  private readonly frameListeners = new Set<(nowMs: number) => void>();
  private readonly report: InViewReport | undefined;
  private readonly warn: (message: string) => void;
  private readonly painter: LabelPainter;
  private readonly frame = createFrame();
  private readonly cpu = new ScreenProjection();
  private readonly scanProjection = new ScreenProjection();
  private readonly scan = new VisibilityScan({
    budgetMs: SCAN_BUDGET_MS,
    now: () => performance.now(),
  });
  private readonly view = new Matrix4();
  private readonly rotation = new Matrix4();
  private readonly viewProjectionRte = new Matrix4();
  private readonly viewProjection = new Matrix4();
  private readonly rteValues: number[] = new Array<number>(16).fill(0);
  private readonly fullValues: number[] = new Array<number>(16).fill(0);
  private readonly sweptMatrix = new Float64Array(16);
  private readonly tones: Float32Array;
  private readonly point: ScreenPoint = { x: 0, y: 0 };
  private readonly moved = new Float64Array(3);
  private renderer: MarkerRenderer;
  private epoch: number;
  private frameNowMs: number;
  private fullRate = false;
  private lastDrawAt = Number.NEGATIVE_INFINITY;
  private lastSweepAt = Number.NEGATIVE_INFINITY;
  private frameReady = false;
  private ratio = 1;
  private sweepDirty = true;
  private pickable: RenderLayer[] = [];
  private crumbs = new Float64Array(0);
  private selectedId: string | null = null;
  private counts: Readonly<Record<string, number>> = {};
  private latestCounts: Readonly<Record<string, number>> = {};
  private lastReportAt = Number.NEGATIVE_INFINITY;
  private reportTimer: ReturnType<typeof setTimeout> | null = null;
  private drawnTotal = 0;
  private reportedTotal = 0;

  constructor(
    widget: CesiumWidget,
    canvases: OverlayCanvases,
    palette: MarkerPalette,
    options: OverlayOptions = {},
  ) {
    this.widget = widget;
    this.canvases = canvases;
    this.palette = palette;
    this.report = options.report;
    this.clock = options.clock ?? (() => serverNowMs());
    this.frameNowMs = this.clock();
    this.epoch = Math.floor(this.frameNowMs / 1000);
    this.warn = options.warn ?? defaultWarn;
    this.painter = new LabelPainter(palette);
    this.tones = premultipliedTones([
      cssToRgba(palette.default),
      cssToRgba(palette.notable),
      cssToRgba(palette.accent),
    ]);
    this.renderer = this.chooseRenderer(options.renderer ?? "auto");
    this.removePreUpdate = widget.scene.preUpdate.addEventListener(() =>
      this.beforeFrame(),
    );
    this.removeListener = widget.scene.postRender.addEventListener(() =>
      this.draw(),
    );
  }

  get rendererKind(): "webgl2" | "canvas" {
    return this.renderer.kind;
  }

  setLayer(
    moduleId: string,
    markers: readonly Marker[],
    stale: boolean,
    sizing?: LayerSizing,
    options?: LayerOptions,
  ) {
    const previous = this.layers.get(moduleId);
    const slot = previous?.render.slot ?? this.allocateSlot(moduleId);
    this.layers.set(
      moduleId,
      buildLayer({
        moduleId,
        slot,
        markers,
        stale,
        sizing,
        options,
        previous,
        selectedId: this.selectedId,
        epoch: this.epoch,
      }),
    );
    this.sweepDirty = true;
    this.notify(moduleId, "layer");
    this.widget.scene.requestRender();
  }

  removeLayer(moduleId: string) {
    const state = this.layers.get(moduleId);
    if (!state) return;
    this.layers.delete(moduleId);
    this.slots[state.render.slot] = null;
    this.renderer.removeLayer(state.render.slot);
    this.sweepDirty = true;
    this.notify(moduleId, "layer");
    this.widget.scene.requestRender();
  }

  setVisible(moduleId: string, visible: boolean) {
    if (visible === !this.hidden.has(moduleId)) return;
    if (visible) this.hidden.delete(moduleId);
    else this.hidden.add(moduleId);
    this.sweepDirty = true;
    this.notify(moduleId, "visibility");
    this.widget.scene.requestRender();
  }

  onChange(
    listener: (moduleId: string, change: OverlayChange) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  markers(moduleId: string): readonly Marker[] | undefined {
    return this.layers.get(moduleId)?.markers;
  }

  isVisible(moduleId: string): boolean {
    return this.layers.has(moduleId) && !this.hidden.has(moduleId);
  }

  onScreen(moduleId: string): Uint8Array | undefined {
    const state = this.layers.get(moduleId);
    if (!state) return undefined;
    if (this.hidden.has(moduleId)) {
      if (state.zeros?.length !== state.render.count) {
        state.zeros = new Uint8Array(state.render.count);
      }
      return state.zeros;
    }
    return state.mask?.length === state.render.count ? state.mask : undefined;
  }

  invalidate() {
    this.widget.scene.requestRender();
  }

  stats(): OverlayStats {
    let markers = 0;
    for (const state of this.layers.values()) markers += state.render.count;
    return { layers: this.layers.size, markers };
  }

  project(lon: number, lat: number): ScreenPoint | null {
    const { width, height } = this.measure();
    if (!this.updateFrame(width, height, this.ratio)) return null;
    const ecef = new Float64Array(3);
    geodeticToEcef(lon, lat, ecef, 0);
    const found = { x: 0, y: 0 };
    return this.projectEcef(ecef[0], ecef[1], ecef[2], found) ? found : null;
  }

  setPositions(moduleId: string, data: Float64Array) {
    const state = this.layers.get(moduleId);
    if (!state) return;
    if (applyPositions(state, data)) this.sweepDirty = true;
  }

  setSegments(moduleId: string, update: SegmentUpdate) {
    const state = this.layers.get(moduleId);
    if (!state || this.renderer.kind !== "webgl2") return;
    if (!applySegments(state, update)) return;
    if (update.rows === null) this.sweepDirty = true;
    this.widget.scene.requestRender();
  }

  segmentMotion(): boolean {
    return this.renderer.kind === "webgl2";
  }

  onFrame(listener: (nowMs: number) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  setFullRate(on: boolean) {
    this.fullRate = on;
    if (on) this.widget.scene.requestRender();
  }

  setBreadcrumbs(points: readonly { lon: number; lat: number }[]) {
    const ecef = new Float64Array(points.length * 3);
    points.forEach(({ lon, lat }, index) => {
      geodeticToEcef(lon, lat, ecef, index * 3);
    });
    this.crumbs = ecef;
    this.widget.scene.requestRender();
  }

  setSelected(id: string | null) {
    if (id === this.selectedId) return;
    this.selectedId = id;
    for (const state of this.layers.values()) {
      state.selectedIndex = findIndex(state.markers, id);
    }
    this.widget.scene.requestRender();
  }

  hitTest(x: number, y: number): { moduleId: string; marker: Marker } | null {
    if (!this.frameReady) return null;
    const found = this.renderer.pick(x, y, this.frame, this.pickable);
    if (!found) return null;
    const moduleId = this.slots[found.slot];
    const state = moduleId ? this.layers.get(moduleId) : undefined;
    const marker = state?.markers[found.marker];
    return state && marker ? { moduleId: state.moduleId, marker } : null;
  }

  destroy() {
    this.removeListener();
    this.removePreUpdate();
    this.frameListeners.clear();
    this.listeners.clear();
    this.layers.clear();
    this.hidden.clear();
    this.painter.clear();
    this.renderer.destroy();
    if (this.reportTimer !== null) clearTimeout(this.reportTimer);
    this.reportTimer = null;
    this.counts = {};
    this.latestCounts = {};
    this.report?.({});
    const ctx = this.canvases.labels.getContext("2d");
    ctx?.clearRect(
      0,
      0,
      this.canvases.labels.width,
      this.canvases.labels.height,
    );
  }

  private chooseRenderer(choice: "auto" | "canvas"): MarkerRenderer {
    if (choice === "auto") {
      try {
        this.canvases.gl.hidden = false;
        return new WebGlRenderer(this.canvases.gl, {
          onRestore: () => {
            this.sweepDirty = true;
            for (const state of this.layers.values()) state.needsSync = true;
            this.widget.scene.requestRender();
          },
          onWarn: this.warn,
        });
      } catch (error) {
        this.warn(
          error instanceof Error
            ? `${error.message}, drawing on the 2D canvas`
            : "WebGL2 failed, drawing on the 2D canvas",
        );
      }
    } else {
      this.warn("renderer=canvas requested, drawing on the 2D canvas");
    }
    this.canvases.gl.hidden = true;
    return new CanvasRenderer(this.canvases.labels, this.palette);
  }

  private fallBack(error: unknown) {
    if (this.renderer.kind === "canvas") return;
    this.renderer.destroy();
    this.canvases.gl.hidden = true;
    this.renderer = new CanvasRenderer(this.canvases.labels, this.palette);
    const frozen: string[] = [];
    for (const state of this.layers.values()) {
      if (state.render.moving) {
        freezeAt(state, this.frameNowMs / 1000);
        frozen.push(state.moduleId);
      }
      state.needsSync = true;
      state.mask = null;
    }
    this.warn(
      error instanceof Error
        ? `${error.message}, drawing on the 2D canvas`
        : "WebGL2 failed, drawing on the 2D canvas",
    );
    for (const moduleId of frozen) this.notify(moduleId, "renderer");
    this.widget.scene.requestRender();
  }

  private beforeFrame() {
    const now = this.clock();
    this.frameNowMs = now;
    const seconds = now / 1000;
    if (seconds - this.epoch > REBASE_SECONDS) this.rebase(seconds);
    for (const listener of this.frameListeners) listener(now);
    if (
      this.motionLive(seconds) &&
      (this.fullRate || performance.now() - this.lastDrawAt >= MOTION_FRAME_MS)
    ) {
      this.widget.scene.requestRender();
    }
  }

  private rebase(seconds: number) {
    this.epoch = Math.floor(seconds);
    for (const state of this.layers.values()) {
      state.render.epoch = this.epoch;
      if (state.render.moving) state.needsSync = true;
    }
  }

  private motionLive(seconds: number): boolean {
    for (const state of this.layers.values()) {
      if (
        state.render.moving &&
        state.liveUntil > seconds &&
        !this.hidden.has(state.moduleId)
      ) {
        return true;
      }
    }
    return false;
  }

  private positionOf(state: LayerState, index: number, seconds: number) {
    const { render } = state;
    const out = this.moved;
    if (render.moving && render.delta && render.times) {
      evaluateSegmentEcef(
        render.ecef,
        render.delta,
        index * 3,
        render.times[index * 2],
        render.times[index * 2 + 1],
        seconds,
        out,
        0,
      );
    } else {
      out[0] = render.ecef[index * 3];
      out[1] = render.ecef[index * 3 + 1];
      out[2] = render.ecef[index * 3 + 2];
    }
    return out;
  }

  private allocateSlot(moduleId: string): number {
    const free = this.slots.indexOf(null);
    if (free >= 0) {
      this.slots[free] = moduleId;
      return free;
    }
    if (this.slots.length >= MAX_LAYERS) {
      throw new RangeError("the overlay supports at most 255 layers");
    }
    this.slots.push(moduleId);
    return this.slots.length - 1;
  }

  private notify(moduleId: string, change: OverlayChange) {
    for (const listener of this.listeners) listener(moduleId, change);
  }

  private queueReport(counts: Readonly<Record<string, number>>) {
    this.latestCounts = counts;
    if (sameCounts(counts, this.counts)) return;
    const wait = this.lastReportAt + COUNT_REPORT_MS - performance.now();
    if (wait <= 0) {
      this.flushReport();
    } else if (this.reportTimer === null) {
      this.reportTimer = setTimeout(() => this.flushReport(), wait);
    }
  }

  private flushReport() {
    if (this.reportTimer !== null) clearTimeout(this.reportTimer);
    this.reportTimer = null;
    if (sameCounts(this.latestCounts, this.counts)) return;
    this.counts = this.latestCounts;
    this.lastReportAt = performance.now();
    this.report?.(this.counts);
  }

  private measure(): { width: number; height: number } {
    return {
      width: this.canvases.labels.clientWidth,
      height: this.canvases.labels.clientHeight,
    };
  }

  private draw() {
    const started = performance.now();
    try {
      this.paint();
    } catch (error) {
      this.fallBack(error);
    }
    const finished = performance.now();
    this.lastDrawAt = finished;
    perfMetrics.sample("draw", finished - started);
  }

  private updateFrame(width: number, height: number, ratio: number): boolean {
    const { scene } = this.widget;
    const { camera } = scene;
    if (
      scene.mode !== SceneMode.SCENE3D ||
      !(camera.frustum instanceof PerspectiveFrustum)
    ) {
      this.frameReady = false;
      return false;
    }
    const projection = camera.frustum.projectionMatrix;
    Matrix4.clone(camera.viewMatrix, this.view);
    Matrix4.setTranslation(this.view, Cartesian3.ZERO, this.rotation);
    Matrix4.multiply(projection, this.rotation, this.viewProjectionRte);
    Matrix4.multiply(projection, camera.viewMatrix, this.viewProjection);
    Matrix4.toArray(this.viewProjectionRte, this.rteValues);
    Matrix4.toArray(this.viewProjection, this.fullValues);
    const eye = camera.positionWC;
    fillFrame(this.frame, {
      viewProjectionRte: this.rteValues,
      viewProjection: this.fullValues,
      eye: [eye.x, eye.y, eye.z],
      width,
      height,
      ratio,
      tones: this.tones,
      now: this.frameNowMs / 1000,
      epoch: this.epoch,
    });
    this.cpu.update(this.fullValues, width, height);
    this.frameReady = true;
    return true;
  }

  private projectEcef(
    x: number,
    y: number,
    z: number,
    out: ScreenPoint,
  ): boolean {
    const eye = this.frame.cpuEyeScaled;
    if (
      (x / WGS84_RADII[0]) * eye[0] +
        (y / WGS84_RADII[1]) * eye[1] +
        (z / WGS84_RADII[2]) * eye[2] <=
      1
    ) {
      return false;
    }
    return this.cpu.project(x, y, z, out);
  }

  private projectInView(
    x: number,
    y: number,
    z: number,
    out: ScreenPoint,
    width: number,
    height: number,
  ): boolean {
    return (
      this.projectEcef(x, y, z, out) &&
      out.x >= -SCAN_EDGE_MARGIN &&
      out.y >= -SCAN_EDGE_MARGIN &&
      out.x <= width + SCAN_EDGE_MARGIN &&
      out.y <= height + SCAN_EDGE_MARGIN
    );
  }

  private paint() {
    const labels = this.canvases.labels;
    const ctx = labels.getContext("2d");
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    this.ratio = ratio;
    const { width, height } = this.measure();
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (labels.width !== pixelWidth || labels.height !== pixelHeight) {
      labels.width = pixelWidth;
      labels.height = pixelHeight;
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!this.updateFrame(width, height, ratio)) return;

    const active: LayerState[] = [];
    for (const state of this.layers.values()) {
      if (!this.hidden.has(state.moduleId)) active.push(state);
    }
    this.renderer.resize(width, height, ratio);
    const renders: RenderLayer[] = [];
    for (const state of active) {
      if (state.needsSync) {
        this.renderer.syncLayer(state.render);
        markClean(state.render);
        state.needsSync = false;
      } else if (hasDirty(state.render)) {
        for (const [from, to] of dirtyRuns(state.render)) {
          this.renderer.updatePositions(state.render, from, to);
        }
        markClean(state.render);
      }
      renders.push(state.render);
    }
    this.pickable = renders;

    const dots = this.crumbDots();
    this.painter.begin(ctx);
    this.painter.drawCrumbs(ctx, dots);

    const outcome = this.renderer.draw(this.frame, renders);
    if (outcome) this.applyOutcome(active, outcome);
    else this.stepScan(active, width, height);

    this.drawLabels(ctx, active, width, height);
    this.publish();
  }

  private crumbDots(): CrumbDot[] {
    const count = this.crumbs.length / 3;
    const dots: CrumbDot[] = [];
    for (let i = 0; i < count; i++) {
      const point = this.point;
      if (
        !this.projectEcef(
          this.crumbs[i * 3],
          this.crumbs[i * 3 + 1],
          this.crumbs[i * 3 + 2],
          point,
        )
      ) {
        continue;
      }
      const newest = count === 1 ? 1 : i / (count - 1);
      dots.push({
        x: point.x,
        y: point.y,
        alpha: CRUMB_MIN_ALPHA + (1 - CRUMB_MIN_ALPHA) * newest,
      });
    }
    return dots;
  }

  private applyOutcome(active: readonly LayerState[], outcome: DrawOutcome) {
    for (const state of active) {
      const inView = outcome.counts.get(state.render.slot);
      state.inView = inView ?? null;
      state.mask = outcome.masks.get(state.render.slot) ?? null;
    }
  }

  private stepScan(
    active: readonly LayerState[],
    width: number,
    height: number,
  ) {
    const seconds = this.frameNowMs / 1000;
    const scanLayers: ScanLayer[] = active.map((state) => ({
      id: state.moduleId,
      count: state.render.count,
      ecef: state.render.ecef,
      delta: state.render.moving ? state.render.delta : null,
      times: state.render.moving ? state.render.times : null,
      active: true,
    }));
    const moved = this.cameraMoved();
    const tick = performance.now();
    const drifting =
      tick - this.lastSweepAt >= SWEEP_MOVING_MS && this.motionLive(seconds);
    if (!this.scan.sweeping && (this.sweepDirty || moved || drifting)) {
      this.lastSweepAt = tick;
      this.sweptMatrix.set(this.frame.cpuViewProjection);
      this.scanProjection.update(this.frame.cpuViewProjection, width, height);
      this.scan.begin(
        {
          width,
          height,
          eyeScaled: Float64Array.from(this.frame.cpuEyeScaled),
          now: seconds,
          project: (x, y, z, out) => this.scanProjection.project(x, y, z, out),
        },
        scanLayers,
      );
      this.sweepDirty = false;
    }
    if (!this.scan.sweeping) return;
    if (!this.scan.step(scanLayers)) {
      this.widget.scene.requestRender();
      return;
    }
    const result = this.scan.result();
    for (const state of active) {
      const found = result.get(state.moduleId);
      if (found && found.onScreen.length === state.render.count) {
        state.mask = found.onScreen;
        state.inView = found.inView;
      }
    }
    if (this.sweepDirty || this.cameraMoved()) {
      this.widget.scene.requestRender();
    }
  }

  private cameraMoved(): boolean {
    const now = this.frame.cpuViewProjection;
    for (let i = 0; i < 16; i++) {
      if (now[i] !== this.sweptMatrix[i]) return true;
    }
    return false;
  }

  private publish() {
    const counts: Record<string, number> = {};
    let drawn = 0;
    let reported = 0;
    let resized = false;
    for (const state of this.layers.values()) {
      if (this.hidden.has(state.moduleId) || state.inView === null) continue;
      drawn += state.inView;
      if (state.reported) {
        counts[state.moduleId] = state.inView;
        reported += state.inView;
      }
      const sized = state.render.sizing?.(state.inView);
      if (sized && this.renderer.kind === "webgl2") {
        const glyph = glyphIndex(sized.glyph);
        if (
          glyph !== state.render.sizedGlyph ||
          sized.size !== state.render.sizedSize
        ) {
          state.render.sizedGlyph = glyph;
          state.render.sizedSize = sized.size;
          resized = true;
        }
      }
    }
    this.drawnTotal = drawn;
    this.reportedTotal = reported;
    this.queueReport(counts);
    perfMetrics.markers(this.drawnTotal, this.reportedTotal);
    if (resized) this.widget.scene.requestRender();
  }

  private drawLabels(
    ctx: CanvasRenderingContext2D,
    active: readonly LayerState[],
    width: number,
    height: number,
  ) {
    const names: NameLabel[] = [];
    const seconds = this.frameNowMs / 1000;
    let selected: SelectedMark | null = null;
    for (const state of active) {
      const { render } = state;
      const indices: number[] = Array.from(state.special);
      if (state.selectedIndex >= 0) indices.push(state.selectedIndex);
      for (const i of indices) {
        const point = this.point;
        const at = this.positionOf(state, i, seconds);
        if (!this.projectInView(at[0], at[1], at[2], point, width, height)) {
          continue;
        }
        const marker = state.markers[i];
        const size =
          render.adaptive[i] && render.sizedGlyph >= 0
            ? render.sizedSize
            : render.size[i];
        if (i === state.selectedIndex) {
          selected = {
            x: point.x,
            y: point.y,
            size,
            label: marker.label,
          };
        } else {
          names.push(
            this.painter.nameLabel(
              ctx,
              marker.label,
              marker.tone,
              render.stale,
              size,
              point.x,
              point.y,
            ),
          );
        }
      }
    }
    this.painter.drawNames(ctx, names, selected);
    if (selected) this.painter.drawSelection(ctx, selected);
  }
}
