import {
  Cartesian3,
  type CesiumWidget,
  Ellipsoid,
  Matrix4,
  PerspectiveFrustum,
  SceneMode,
  SceneTransforms,
} from "cesium";
import { DotStamper, packColour, type StampMask } from "./dot-stamps";
import { type LabelCandidate, placeLabels } from "./label-layout";
import {
  HIT_RADIUS_PX,
  type LayerSizing,
  type Marker,
  type MarkerGlyph,
  type MarkerSizing,
  POSITION_STRIDE,
} from "./markers";
import { type ScreenPoint, ScreenProjection } from "./projection";

export type MarkerPalette = {
  default: string;
  notable: string;
  accent: string;
  plate: string;
  font: string;
};

type Placed = {
  marker: Marker;
  position: Cartesian3;
  scaled: Cartesian3;
};

type Layer = {
  markers: readonly Marker[];
  placed: Placed[];
  stale: boolean;
  rotation: Float32Array;
  faded: Uint8Array;
  fadedCount: number;
  lon: Float64Array;
  lat: Float64Array;
  drawn: boolean;
  sizing: LayerSizing | undefined;
  sized: MarkerSizing | undefined;
  x: Float32Array;
  y: Float32Array;
  visible: Uint8Array;
};

const STALE_ALPHA = 0.5;
const CRUMB_RADIUS = 2.4;
const CRUMB_MIN_ALPHA = 0.4;
const LINE_WIDTH = 1.5;
const BRACKET_GAP = 6;
const BRACKET_ARM = 5;
const LABEL_FONT_PX = 11;
const LABEL_PAD_X = 5;
const LABEL_HEIGHT = 17;
const EDGE_MARGIN = 30;
const FLAME_HEIGHT = 1.3;
const FLAME_IN_RING = 0.62;
const TONES: readonly Marker["tone"][] = ["default", "notable", "accent"];
const NAME_GAP = 4;
const NAME_PAD_X = 3;
const NAME_HEIGHT = 15;
const NAME_LIMIT = 120;
const NAME_WIDTH_CACHE_MAX = 5000;
const COUNT_REPORT_MS = 1000;
export const STAMP_FROM = 400;
const STAMP_MAX_SIZE = 12;
const MASK_MARGIN = 4;

type NameLabel = LabelCandidate & {
  text: string;
  tone: Marker["tone"];
  stale: boolean;
};

function place(marker: Marker): Placed {
  const position = Cartesian3.fromDegrees(marker.lon, marker.lat);
  const scaled = Ellipsoid.default.transformPositionToScaledSpace(
    position,
    new Cartesian3(),
  );
  return { marker, position, scaled };
}

function placeAll(markers: readonly Marker[], previous?: Placed[]): Placed[] {
  const known = new Map(previous?.map((p) => [p.marker.id, p]));
  return markers.map((marker) => {
    const old = known.get(marker.id);
    return old && old.marker.lon === marker.lon && old.marker.lat === marker.lat
      ? { ...old, marker }
      : place(marker);
  });
}

function trianglePath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
) {
  const half = size / 2;
  const height = size * 0.866;
  ctx.moveTo(x, y - height * 0.6);
  ctx.lineTo(x + half, y + height * 0.4);
  ctx.lineTo(x - half, y + height * 0.4);
  ctx.closePath();
}

function flamePath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
) {
  const h = size * FLAME_HEIGHT;
  const px = (u: number) => x + u * h;
  const py = (v: number) => y + v * h;
  ctx.moveTo(px(0.04), py(-0.5));
  ctx.bezierCurveTo(px(0.1), py(-0.3), px(0.36), py(-0.12), px(0.32), py(0.16));
  ctx.bezierCurveTo(px(0.3), py(0.38), px(0.16), py(0.5), px(0), py(0.5));
  ctx.bezierCurveTo(
    px(-0.17),
    py(0.5),
    px(-0.32),
    py(0.38),
    px(-0.32),
    py(0.18),
  );
  ctx.bezierCurveTo(
    px(-0.32),
    py(0.02),
    px(-0.22),
    py(-0.08),
    px(-0.14),
    py(-0.18),
  );
  ctx.bezierCurveTo(
    px(-0.12),
    py(-0.08),
    px(-0.08),
    py(-0.02),
    px(-0.03),
    py(0),
  );
  ctx.bezierCurveTo(
    px(-0.06),
    py(-0.22),
    px(-0.04),
    py(-0.38),
    px(0.04),
    py(-0.5),
  );
  ctx.moveTo(px(0), py(0.5));
  ctx.bezierCurveTo(
    px(-0.12),
    py(0.5),
    px(-0.17),
    py(0.38),
    px(-0.1),
    py(0.28),
  );
  ctx.bezierCurveTo(px(-0.05), py(0.2), px(0), py(0.14), px(0), py(0.06));
  ctx.bezierCurveTo(px(0.1), py(0.16), px(0.16), py(0.26), px(0.14), py(0.34));
  ctx.bezierCurveTo(px(0.12), py(0.44), px(0.06), py(0.5), px(0), py(0.5));
}

function flameRingPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
) {
  const radius = size / 2;
  ctx.moveTo(x + radius, y);
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  flamePath(ctx, x, y, size * FLAME_IN_RING);
}

function squarePath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
) {
  ctx.rect(x - size / 2, y - size / 2, size, size);
}

const PLANE_OUTLINE: readonly (readonly [number, number])[] = [
  [0, -0.5],
  [0.07, -0.3],
  [0.07, -0.1],
  [0.5, 0.12],
  [0.5, 0.22],
  [0.07, 0.12],
  [0.07, 0.32],
  [0.2, 0.42],
  [0.2, 0.5],
  [0, 0.45],
  [-0.2, 0.5],
  [-0.2, 0.42],
  [-0.07, 0.32],
  [-0.07, 0.12],
  [-0.5, 0.22],
  [-0.5, 0.12],
  [-0.07, -0.1],
  [-0.07, -0.3],
];

function planePath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  rotation: number,
) {
  const angle = (rotation * Math.PI) / 180;
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  PLANE_OUTLINE.forEach(([px, py], index) => {
    const dx = px * size;
    const dy = py * size;
    const sx = x + dx * cos - dy * sin;
    const sy = y + dx * sin + dy * cos;
    if (index === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
  ctx.closePath();
}

const SHIP_OUTLINE: readonly (readonly [number, number])[] = [
  [0, -0.5],
  [0.2, -0.15],
  [0.2, 0.38],
  [0.12, 0.5],
  [-0.12, 0.5],
  [-0.2, 0.38],
  [-0.2, -0.15],
];

function shipPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  rotation: number,
) {
  const angle = (rotation * Math.PI) / 180;
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  SHIP_OUTLINE.forEach(([px, py], index) => {
    const dx = px * size;
    const dy = py * size;
    const sx = x + dx * cos - dy * sin;
    const sy = y + dx * sin + dy * cos;
    if (index === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
  ctx.closePath();
}

function dotPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
) {
  const radius = size / 2;
  ctx.moveTo(x + radius, y);
  ctx.arc(x, y, radius, 0, Math.PI * 2);
}

function drawnAs(layer: Layer, marker: Marker): MarkerSizing {
  return marker.adaptive && layer.sized
    ? layer.sized
    : { glyph: marker.glyph, size: marker.size };
}

function glyphPath(
  ctx: CanvasRenderingContext2D,
  glyph: MarkerGlyph,
  size: number,
  rotation: number,
  x: number,
  y: number,
) {
  if (glyph === "plane") planePath(ctx, x, y, size, rotation);
  else if (glyph === "ship") shipPath(ctx, x, y, size, rotation);
  else if (glyph === "dot") dotPath(ctx, x, y, size);
  else if (glyph === "flame") flamePath(ctx, x, y, size);
  else if (glyph === "flame-ring") flameRingPath(ctx, x, y, size);
  else if (glyph === "square") squarePath(ctx, x, y, size);
  else trianglePath(ctx, x, y, size);
}

export type OverlayChange = "layer" | "visibility";

export type InViewReport = (counts: Readonly<Record<string, number>>) => void;

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

export class MarkerOverlay {
  private readonly widget: CesiumWidget;
  private readonly canvas: HTMLCanvasElement;
  private readonly palette: MarkerPalette;
  private readonly layers = new Map<string, Layer>();
  private readonly screen: ScreenPoint = { x: 0, y: 0 };
  private readonly projection = new ScreenProjection();
  private readonly viewProjection = new Matrix4();
  private readonly viewProjectionValues: number[] = new Array<number>(16).fill(
    0,
  );
  private fastProjection = false;
  private readonly stamper = new DotStamper();
  private stampCanvas: HTMLCanvasElement | null = null;
  private stampImage: ImageData | null = null;
  private readonly masks = new Map<string, StampMask | null>();
  private readonly colours = new Map<string, number>();
  private ratio = 1;
  private crumbs: readonly { position: Cartesian3; scaled: Cartesian3 }[] = [];
  private readonly camera = new Cartesian3();
  private readonly removeListener: () => void;
  private readonly hidden = new Set<string>();
  private readonly report: InViewReport | undefined;
  private counts: Readonly<Record<string, number>> = {};
  private latestCounts: Readonly<Record<string, number>> = {};
  private lastReportAt = Number.NEGATIVE_INFINITY;
  private reportTimer: ReturnType<typeof setTimeout> | null = null;
  private selectedId: string | null = null;
  private readonly nameWidths = new Map<string, number>();
  private readonly listeners = new Set<
    (moduleId: string, change: OverlayChange) => void
  >();

  constructor(
    widget: CesiumWidget,
    canvas: HTMLCanvasElement,
    palette: MarkerPalette,
    report?: InViewReport,
  ) {
    this.widget = widget;
    this.canvas = canvas;
    this.palette = palette;
    this.report = report;
    this.removeListener = widget.scene.postRender.addEventListener(() =>
      this.draw(),
    );
  }

  setLayer(
    moduleId: string,
    markers: readonly Marker[],
    stale: boolean,
    sizing?: LayerSizing,
  ) {
    const previous = this.layers.get(moduleId);
    const placed = placeAll(markers, previous?.placed);
    this.layers.set(moduleId, {
      markers,
      placed,
      stale,
      rotation: new Float32Array(placed.length).fill(Number.NaN),
      faded: new Uint8Array(placed.length),
      fadedCount: 0,
      lon: Float64Array.from(placed, (p) => p.marker.lon),
      lat: Float64Array.from(placed, (p) => p.marker.lat),
      drawn: false,
      sizing,
      sized: previous?.sized,
      x: new Float32Array(placed.length),
      y: new Float32Array(placed.length),
      visible: new Uint8Array(placed.length),
    });
    this.notify(moduleId, "layer");
    this.widget.scene.requestRender();
  }

  removeLayer(moduleId: string) {
    if (!this.layers.delete(moduleId)) return;
    this.notify(moduleId, "layer");
    this.widget.scene.requestRender();
  }

  setVisible(moduleId: string, visible: boolean) {
    if (visible === !this.hidden.has(moduleId)) return;
    if (visible) this.hidden.delete(moduleId);
    else this.hidden.add(moduleId);
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
    const layer = this.layers.get(moduleId);
    return layer?.drawn ? layer.visible : undefined;
  }

  invalidate() {
    this.widget.scene.requestRender();
  }

  setPositions(moduleId: string, data: Float64Array) {
    const layer = this.layers.get(moduleId);
    if (!layer || data.length < layer.placed.length * POSITION_STRIDE) return;
    const ellipsoid = Ellipsoid.default;
    let faded = 0;
    for (let i = 0; i < layer.placed.length; i++) {
      const at = i * POSITION_STRIDE;
      const placed = layer.placed[i];
      let lon = data[at];
      let lat = data[at + 1];
      if (Number.isNaN(lon) || Number.isNaN(lat)) {
        lon = placed.marker.lon;
        lat = placed.marker.lat;
      }
      if (lon !== layer.lon[i] || lat !== layer.lat[i]) {
        layer.lon[i] = lon;
        layer.lat[i] = lat;
        Cartesian3.fromDegrees(lon, lat, 0, ellipsoid, placed.position);
        ellipsoid.transformPositionToScaledSpace(
          placed.position,
          placed.scaled,
        );
      }
      layer.rotation[i] = data[at + 2];
      const fade = data[at + 3] === 1 ? 1 : 0;
      layer.faded[i] = fade;
      faded += fade;
    }
    layer.fadedCount = faded;
  }

  setBreadcrumbs(points: readonly { lon: number; lat: number }[]) {
    const ellipsoid = Ellipsoid.default;
    this.crumbs = points.map(({ lon, lat }) => {
      const position = Cartesian3.fromDegrees(lon, lat, 0, ellipsoid);
      const scaled = ellipsoid.transformPositionToScaledSpace(
        position,
        new Cartesian3(),
      );
      return { position, scaled };
    });
    this.widget.scene.requestRender();
  }

  private notify(moduleId: string, change: OverlayChange) {
    for (const listener of this.listeners) listener(moduleId, change);
  }

  setSelected(id: string | null) {
    if (id === this.selectedId) return;
    this.selectedId = id;
    this.widget.scene.requestRender();
  }

  hitTest(x: number, y: number): { moduleId: string; marker: Marker } | null {
    let best: { moduleId: string; marker: Marker } | null = null;
    let bestDistance = HIT_RADIUS_PX * HIT_RADIUS_PX;
    for (const [moduleId, layer] of this.layers) {
      if (this.hidden.has(moduleId)) continue;
      for (let i = 0; i < layer.placed.length; i++) {
        if (!layer.visible[i]) continue;
        const dx = layer.x[i] - x;
        const dy = layer.y[i] - y;
        const distance = dx * dx + dy * dy;
        if (distance <= bestDistance) {
          bestDistance = distance;
          best = { moduleId, marker: layer.placed[i].marker };
        }
      }
    }
    return best;
  }

  destroy() {
    this.removeListener();
    this.listeners.clear();
    this.layers.clear();
    this.hidden.clear();
    this.nameWidths.clear();
    if (this.reportTimer !== null) clearTimeout(this.reportTimer);
    this.reportTimer = null;
    this.counts = {};
    this.latestCounts = {};
    this.report?.({});
    this.context()?.clearRect(0, 0, this.canvas.width, this.canvas.height);
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

  private context(): CanvasRenderingContext2D | null {
    return this.canvas.getContext("2d");
  }

  private resize(): number {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(this.canvas.clientWidth * ratio);
    const height = Math.round(this.canvas.clientHeight * ratio);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    return ratio;
  }

  private draw() {
    const ctx = this.context();
    if (!ctx) return;
    const ratio = this.resize();
    this.ratio = ratio;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const { camera } = this.widget;
    this.prepareProjection(width, height);
    const eye = Ellipsoid.default.transformPositionToScaledSpace(
      camera.positionWC,
      this.camera,
    );
    this.drawCrumbs(ctx, eye);
    let selected: {
      x: number;
      y: number;
      marker: Marker;
      size: number;
    } | null = null;
    const counts: Record<string, number> = {};
    const names: NameLabel[] = [];
    ctx.font = `${LABEL_FONT_PX}px ${this.palette.font}`;

    for (const [moduleId, layer] of this.layers) {
      layer.visible.fill(0);
      layer.drawn = true;
      if (this.hidden.has(moduleId)) continue;
      let inView = 0;
      const special: number[] = [];
      for (let i = 0; i < layer.placed.length; i++) {
        const { marker, position, scaled } = layer.placed[i];
        if (Cartesian3.dot(scaled, eye) <= 1) continue;
        const screen = this.screen;
        if (
          !this.projectPoint(position, screen) ||
          screen.x < -EDGE_MARGIN ||
          screen.y < -EDGE_MARGIN ||
          screen.x > width + EDGE_MARGIN ||
          screen.y > height + EDGE_MARGIN
        ) {
          continue;
        }
        layer.visible[i] = 1;
        inView++;
        layer.x[i] = screen.x;
        layer.y[i] = screen.y;
        if (marker.id === this.selectedId || marker.persistentLabel) {
          special.push(i);
        }
      }
      counts[moduleId] = inView;
      layer.sized = layer.sizing?.(inView);
      const stamp = this.crowded(layer);
      if (stamp) {
        this.stamper.begin(this.canvas.width, this.canvas.height);
      }
      for (const i of special) {
        const { marker } = layer.placed[i];
        const { size } = drawnAs(layer, marker);
        if (marker.id === this.selectedId) {
          selected = { x: layer.x[i], y: layer.y[i], marker, size };
        } else {
          names.push(
            this.nameLabel(ctx, marker, size, layer.x[i], layer.y[i], layer),
          );
        }
      }
      for (const tone of TONES) this.drawLayer(ctx, layer, tone, stamp);
      if (stamp) this.flushStamps(ctx);
    }

    this.drawNames(ctx, names, selected);

    this.queueReport(counts);

    if (selected)
      this.drawSelection(
        ctx,
        selected.x,
        selected.y,
        selected.marker,
        selected.size,
      );
  }

  private prepareProjection(width: number, height: number) {
    const { scene } = this.widget;
    const { camera } = scene;
    this.fastProjection =
      scene.mode === SceneMode.SCENE3D &&
      camera.frustum instanceof PerspectiveFrustum;
    if (!this.fastProjection) return;
    Matrix4.multiply(
      camera.frustum.projectionMatrix,
      camera.viewMatrix,
      this.viewProjection,
    );
    Matrix4.toArray(this.viewProjection, this.viewProjectionValues);
    this.projection.update(this.viewProjectionValues, width, height);
  }

  private projectPoint(position: Cartesian3, out: ScreenPoint): boolean {
    if (this.fastProjection) {
      return this.projection.project(position.x, position.y, position.z, out);
    }
    const found = SceneTransforms.worldToWindowCoordinates(
      this.widget.scene,
      position,
    );
    if (!found) return false;
    out.x = found.x;
    out.y = found.y;
    return true;
  }

  private drawCrumbs(ctx: CanvasRenderingContext2D, eye: Cartesian3) {
    const count = this.crumbs.length;
    if (count === 0) return;
    ctx.fillStyle = this.palette.accent;
    for (let i = 0; i < count; i++) {
      const { position, scaled } = this.crumbs[i];
      if (Cartesian3.dot(scaled, eye) <= 1) continue;
      const screen = this.screen;
      if (!this.projectPoint(position, screen)) continue;
      const newest = count === 1 ? 1 : i / (count - 1);
      ctx.globalAlpha = CRUMB_MIN_ALPHA + (1 - CRUMB_MIN_ALPHA) * newest;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, CRUMB_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private crowded(layer: Layer): boolean {
    let dots = 0;
    for (let i = 0; i < layer.placed.length; i++) {
      if (
        layer.visible[i] === 1 &&
        drawnAs(layer, layer.placed[i].marker).glyph === "dot" &&
        ++dots >= STAMP_FROM
      ) {
        return true;
      }
    }
    return false;
  }

  private ringMask(size: number): StampMask | null {
    const key = `${size}@${this.ratio}`;
    const known = this.masks.get(key);
    if (known !== undefined) return known;
    let mask: StampMask | null = null;
    if (size <= STAMP_MAX_SIZE) {
      const stroke = LINE_WIDTH * this.ratio;
      const diameter = size * this.ratio;
      let side = Math.ceil(diameter + stroke) + MASK_MARGIN;
      side += side % 2;
      const canvas = document.createElement("canvas");
      canvas.width = side;
      canvas.height = side;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context) {
        context.lineWidth = stroke;
        context.strokeStyle = "white";
        context.beginPath();
        context.arc(side / 2, side / 2, diameter / 2, 0, Math.PI * 2);
        context.stroke();
        const data = context.getImageData(0, 0, side, side).data;
        const alpha = new Uint8Array(side * side);
        for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
        mask = { side, alpha };
      }
    }
    this.masks.set(key, mask);
    return mask;
  }

  private colourOf(css: string): number {
    const known = this.colours.get(css);
    if (known !== undefined) return known;
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    let colour = packColour(255, 255, 255);
    if (context) {
      context.fillStyle = css;
      context.fillRect(0, 0, 1, 1);
      const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
      colour = packColour(red, green, blue);
    }
    this.colours.set(css, colour);
    return colour;
  }

  private flushStamps(ctx: CanvasRenderingContext2D) {
    const bounds = this.stamper.bounds;
    if (!bounds) return;
    const { width, height } = this.stamper.size;
    let canvas = this.stampCanvas;
    if (!canvas) {
      canvas = document.createElement("canvas");
      this.stampCanvas = canvas;
    }
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const target = canvas.getContext("2d");
    if (!target) return;
    let image = this.stampImage;
    if (
      !image ||
      image.width !== width ||
      image.height !== height ||
      image.data.buffer !== this.stamper.buffer
    ) {
      image = new ImageData(
        new Uint8ClampedArray(this.stamper.buffer),
        width,
        height,
      );
      this.stampImage = image;
    }
    const spanX = bounds.right - bounds.left;
    const spanY = bounds.bottom - bounds.top;
    target.putImageData(image, 0, 0, bounds.left, bounds.top, spanX, spanY);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(
      canvas,
      bounds.left,
      bounds.top,
      spanX,
      spanY,
      bounds.left,
      bounds.top,
      spanX,
      spanY,
    );
    ctx.restore();
  }

  private drawLayer(
    ctx: CanvasRenderingContext2D,
    layer: Layer,
    tone: Marker["tone"],
    stamp: boolean,
  ) {
    const css = this.toneColour(tone);
    const stampColour = stamp ? this.colourOf(css) : 0;
    ctx.strokeStyle = css;
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineJoin = "round";
    const split = layer.fadedCount > 0 && !layer.stale;
    for (let pass = 0; pass < (split ? 2 : 1); pass++) {
      ctx.globalAlpha = layer.stale || pass === 1 ? STALE_ALPHA : 1;
      ctx.beginPath();
      for (let i = 0; i < layer.placed.length; i++) {
        const { marker } = layer.placed[i];
        if (!layer.visible[i] || marker.tone !== tone) continue;
        if (split && layer.faded[i] !== pass) continue;
        const { glyph, size } = drawnAs(layer, marker);
        if (stamp && glyph === "dot") {
          const mask = this.ringMask(size);
          if (mask) {
            this.stamper.stamp(
              layer.x[i] * this.ratio,
              layer.y[i] * this.ratio,
              mask,
              stampColour,
              layer.stale || pass === 1 ? STALE_ALPHA : 1,
            );
            continue;
          }
        }
        const turned = layer.rotation[i];
        glyphPath(
          ctx,
          glyph,
          size,
          Number.isNaN(turned) ? (marker.rotation ?? 0) : turned,
          layer.x[i],
          layer.y[i],
        );
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private toneColour(tone: Marker["tone"]): string {
    if (tone === "notable") return this.palette.notable;
    if (tone === "accent") return this.palette.accent;
    return this.palette.default;
  }

  private nameWidth(ctx: CanvasRenderingContext2D, text: string): number {
    const known = this.nameWidths.get(text);
    if (known !== undefined) return known;
    if (this.nameWidths.size >= NAME_WIDTH_CACHE_MAX) this.nameWidths.clear();
    const width = ctx.measureText(text).width;
    this.nameWidths.set(text, width);
    return width;
  }

  private nameLabel(
    ctx: CanvasRenderingContext2D,
    marker: Marker,
    size: number,
    x: number,
    y: number,
    layer: Layer,
  ): NameLabel {
    return {
      x: x + size / 2 + NAME_GAP,
      y: y - NAME_HEIGHT / 2,
      width: this.nameWidth(ctx, marker.label) + NAME_PAD_X * 2,
      height: NAME_HEIGHT,
      priority: (marker.tone === "accent" ? 1000 : 0) + size,
      text: marker.label,
      tone: marker.tone,
      stale: layer.stale,
    };
  }

  private drawNames(
    ctx: CanvasRenderingContext2D,
    names: readonly NameLabel[],
    selected: { x: number; y: number; size: number } | null,
  ) {
    if (names.length === 0) return;
    const blocked = selected
      ? [
          {
            x: selected.x - selected.size,
            y: selected.y - NAME_HEIGHT,
            width: selected.size * 2 + 220,
            height: NAME_HEIGHT * 2,
          },
        ]
      : [];
    ctx.font = `${LABEL_FONT_PX}px ${this.palette.font}`;
    ctx.textBaseline = "middle";
    for (const label of placeLabels(names, NAME_LIMIT, blocked)) {
      ctx.globalAlpha = label.stale ? STALE_ALPHA : 1;
      ctx.fillStyle = this.palette.plate;
      ctx.fillRect(label.x, label.y, label.width, label.height);
      ctx.fillStyle = this.toneColour(label.tone);
      ctx.fillText(
        label.text,
        label.x + NAME_PAD_X,
        label.y + label.height / 2 + 0.5,
      );
    }
    ctx.globalAlpha = 1;
  }

  private drawSelection(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    marker: Marker,
    size: number,
  ) {
    const reach = size / 2 + BRACKET_GAP;
    ctx.strokeStyle = this.palette.accent;
    ctx.lineWidth = LINE_WIDTH;
    ctx.beginPath();
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      const cx = x + sx * reach;
      const cy = y + sy * reach;
      ctx.moveTo(cx - sx * BRACKET_ARM, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy - sy * BRACKET_ARM);
    }
    ctx.stroke();

    ctx.font = `${LABEL_FONT_PX}px ${this.palette.font}`;
    const textWidth = ctx.measureText(marker.label).width;
    const left = x + reach + 6;
    const top = y - LABEL_HEIGHT / 2;
    ctx.fillStyle = this.palette.plate;
    ctx.fillRect(left, top, textWidth + LABEL_PAD_X * 2, LABEL_HEIGHT);
    ctx.strokeRect(left, top, textWidth + LABEL_PAD_X * 2, LABEL_HEIGHT);
    ctx.fillStyle = this.palette.accent;
    ctx.textBaseline = "middle";
    ctx.fillText(marker.label, left + LABEL_PAD_X, y + 0.5);
  }
}
