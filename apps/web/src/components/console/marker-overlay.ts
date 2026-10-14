import {
  Cartesian2,
  Cartesian3,
  type CesiumWidget,
  Ellipsoid,
  SceneTransforms,
} from "cesium";
import { HIT_RADIUS_PX, type Marker } from "./markers";

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
  placed: Placed[];
  stale: boolean;
  x: Float32Array;
  y: Float32Array;
  visible: Uint8Array;
};

const STALE_ALPHA = 0.5;
const LINE_WIDTH = 1.5;
const BRACKET_GAP = 6;
const BRACKET_ARM = 5;
const LABEL_FONT_PX = 11;
const LABEL_PAD_X = 5;
const LABEL_HEIGHT = 17;
const EDGE_MARGIN = 30;

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

export class MarkerOverlay {
  private readonly widget: CesiumWidget;
  private readonly canvas: HTMLCanvasElement;
  private readonly palette: MarkerPalette;
  private readonly layers = new Map<string, Layer>();
  private readonly scratch = new Cartesian2();
  private readonly camera = new Cartesian3();
  private readonly removeListener: () => void;
  private selectedId: string | null = null;

  constructor(
    widget: CesiumWidget,
    canvas: HTMLCanvasElement,
    palette: MarkerPalette,
  ) {
    this.widget = widget;
    this.canvas = canvas;
    this.palette = palette;
    this.removeListener = widget.scene.postRender.addEventListener(() =>
      this.draw(),
    );
  }

  setLayer(moduleId: string, markers: readonly Marker[], stale: boolean) {
    const previous = this.layers.get(moduleId);
    const placed = placeAll(markers, previous?.placed);
    this.layers.set(moduleId, {
      placed,
      stale,
      x: new Float32Array(placed.length),
      y: new Float32Array(placed.length),
      visible: new Uint8Array(placed.length),
    });
    this.widget.scene.requestRender();
  }

  removeLayer(moduleId: string) {
    if (this.layers.delete(moduleId)) this.widget.scene.requestRender();
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
    this.layers.clear();
    this.context()?.clearRect(0, 0, this.canvas.width, this.canvas.height);
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
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const { scene, camera } = this.widget;
    const eye = Ellipsoid.default.transformPositionToScaledSpace(
      camera.positionWC,
      this.camera,
    );
    let selected: { x: number; y: number; marker: Marker } | null = null;

    for (const layer of this.layers.values()) {
      for (let i = 0; i < layer.placed.length; i++) {
        const { marker, position, scaled } = layer.placed[i];
        layer.visible[i] = 0;
        if (Cartesian3.dot(scaled, eye) <= 1) continue;
        const screen = SceneTransforms.worldToWindowCoordinates(
          scene,
          position,
          this.scratch,
        );
        if (
          !screen ||
          screen.x < -EDGE_MARGIN ||
          screen.y < -EDGE_MARGIN ||
          screen.x > width + EDGE_MARGIN ||
          screen.y > height + EDGE_MARGIN
        ) {
          continue;
        }
        layer.visible[i] = 1;
        layer.x[i] = screen.x;
        layer.y[i] = screen.y;
        if (marker.id === this.selectedId) {
          selected = { x: screen.x, y: screen.y, marker };
        }
      }
      this.drawLayer(ctx, layer, "default");
      this.drawLayer(ctx, layer, "notable");
    }

    if (selected)
      this.drawSelection(ctx, selected.x, selected.y, selected.marker);
  }

  private drawLayer(
    ctx: CanvasRenderingContext2D,
    layer: Layer,
    tone: Marker["tone"],
  ) {
    ctx.globalAlpha = layer.stale ? STALE_ALPHA : 1;
    ctx.strokeStyle =
      tone === "notable" ? this.palette.notable : this.palette.default;
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 0; i < layer.placed.length; i++) {
      const { marker } = layer.placed[i];
      if (!layer.visible[i] || marker.tone !== tone) continue;
      trianglePath(ctx, layer.x[i], layer.y[i], marker.size);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawSelection(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    marker: Marker,
  ) {
    const reach = marker.size / 2 + BRACKET_GAP;
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
