import { DotStamper, packColour, type StampMask } from "./dot-stamps";
import { GLYPH_ORDER, glyphIndex, glyphPath, LINE_WIDTH } from "./glyphs";
import { WGS84_RADII } from "./gpu/encode";
import { type FrameUniforms, STALE_ALPHA } from "./gpu/frame";
import { HIT_RADIUS_PX } from "./markers";
import { ScreenProjection } from "./projection";
import type {
  DrawOutcome,
  MarkerPalette,
  MarkerRenderer,
  PickResult,
  RenderLayer,
} from "./renderer";

const EDGE_MARGIN = 30;
export const STAMP_FROM = 400;
const STAMP_MAX_SIZE = 12;
const MASK_MARGIN = 4;
const DOT = glyphIndex("dot");
const TONES = [0, 1, 2] as const;

type Screen = {
  x: Float32Array;
  y: Float32Array;
  visible: Uint8Array;
};

export class CanvasRenderer implements MarkerRenderer {
  readonly kind = "canvas" as const;
  private readonly canvas: HTMLCanvasElement;
  private readonly palette: MarkerPalette;
  private readonly projection = new ScreenProjection();
  private readonly screens = new Map<number, Screen>();
  private readonly stamper = new DotStamper();
  private stampCanvas: HTMLCanvasElement | null = null;
  private stampImage: ImageData | null = null;
  private readonly masks = new Map<string, StampMask | null>();
  private readonly colours = new Map<string, number>();
  private ratio = 1;
  private readonly point = { x: 0, y: 0 };

  constructor(canvas: HTMLCanvasElement, palette: MarkerPalette) {
    this.canvas = canvas;
    this.palette = palette;
  }

  resize(_cssWidth: number, _cssHeight: number, ratio: number): void {
    this.ratio = ratio;
  }

  syncLayer(layer: RenderLayer): void {
    const known = this.screens.get(layer.slot);
    if (known && known.visible.length === layer.count) return;
    this.screens.set(layer.slot, {
      x: new Float32Array(layer.count),
      y: new Float32Array(layer.count),
      visible: new Uint8Array(layer.count),
    });
  }

  updatePositions(): void {}

  removeLayer(slot: number): void {
    this.screens.delete(slot);
  }

  draw(
    frame: FrameUniforms,
    layers: readonly RenderLayer[],
  ): DrawOutcome | null {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return null;
    this.projection.update(frame.cpuViewProjection, frame.width, frame.height);
    const counts = new Map<number, number>();
    const masks = new Map<number, Uint8Array>();
    const [wx, wy, wz] = [
      frame.cpuEyeScaled[0] / WGS84_RADII[0],
      frame.cpuEyeScaled[1] / WGS84_RADII[1],
      frame.cpuEyeScaled[2] / WGS84_RADII[2],
    ];
    for (const layer of layers) {
      this.syncLayer(layer);
      const screen = this.screens.get(layer.slot);
      if (!screen) continue;
      screen.visible.fill(0);
      let inView = 0;
      const { ecef } = layer;
      const point = this.point;
      for (let i = 0; i < layer.count; i++) {
        const at = i * 3;
        const x = ecef[at];
        const y = ecef[at + 1];
        const z = ecef[at + 2];
        if (x * wx + y * wy + z * wz <= 1) continue;
        if (
          !this.projection.project(x, y, z, point) ||
          point.x < -EDGE_MARGIN ||
          point.y < -EDGE_MARGIN ||
          point.x > frame.width + EDGE_MARGIN ||
          point.y > frame.height + EDGE_MARGIN
        ) {
          continue;
        }
        screen.visible[i] = 1;
        screen.x[i] = point.x;
        screen.y[i] = point.y;
        inView++;
      }
      counts.set(layer.slot, inView);
      masks.set(layer.slot, screen.visible);
      const sized = layer.sizing?.(inView);
      if (sized) {
        layer.sizedGlyph = glyphIndex(sized.glyph);
        layer.sizedSize = sized.size;
      }
      const stamp = this.crowded(layer, screen);
      if (stamp) this.stamper.begin(this.canvas.width, this.canvas.height);
      for (const tone of TONES) this.drawTone(ctx, layer, screen, tone, stamp);
      if (stamp) this.flushStamps(ctx);
    }
    return { counts, masks };
  }

  pick(
    cssX: number,
    cssY: number,
    _frame: FrameUniforms,
    layers: readonly RenderLayer[],
  ): PickResult | null {
    let best: PickResult | null = null;
    let bestDistance = HIT_RADIUS_PX * HIT_RADIUS_PX;
    for (const layer of layers) {
      if (!layer.pickable) continue;
      const screen = this.screens.get(layer.slot);
      if (!screen) continue;
      for (let i = 0; i < layer.count; i++) {
        if (!screen.visible[i]) continue;
        const dx = screen.x[i] - cssX;
        const dy = screen.y[i] - cssY;
        const distance = dx * dx + dy * dy;
        if (distance <= bestDistance) {
          bestDistance = distance;
          best = { slot: layer.slot, marker: i };
        }
      }
    }
    return best;
  }

  destroy(): void {
    this.screens.clear();
    this.masks.clear();
    this.colours.clear();
  }

  private glyphOf(
    layer: RenderLayer,
    i: number,
  ): { glyph: number; size: number } {
    return layer.adaptive[i] && layer.sizedGlyph >= 0
      ? { glyph: layer.sizedGlyph, size: layer.sizedSize }
      : { glyph: layer.glyph[i], size: layer.size[i] };
  }

  private crowded(layer: RenderLayer, screen: Screen): boolean {
    let dots = 0;
    for (let i = 0; i < layer.count; i++) {
      if (
        screen.visible[i] === 1 &&
        this.glyphOf(layer, i).glyph === DOT &&
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

  private toneColour(tone: number): string {
    if (tone === 1) return this.palette.notable;
    if (tone === 2) return this.palette.accent;
    return this.palette.default;
  }

  private drawTone(
    ctx: CanvasRenderingContext2D,
    layer: RenderLayer,
    screen: Screen,
    tone: number,
    stamp: boolean,
  ) {
    const css = this.toneColour(tone);
    const stampColour = stamp ? this.colourOf(css) : 0;
    ctx.strokeStyle = css;
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineJoin = "round";
    const split = layer.fadedCount > 0 && !layer.stale;
    for (let pass = 0; pass < (split ? 2 : 1); pass++) {
      const alpha = layer.stale || pass === 1 ? STALE_ALPHA : 1;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      for (let i = 0; i < layer.count; i++) {
        if (!screen.visible[i] || layer.tone[i] !== tone) continue;
        if (split && layer.faded[i] !== pass) continue;
        const { glyph, size } = this.glyphOf(layer, i);
        if (stamp && glyph === DOT) {
          const mask = this.ringMask(size);
          if (mask) {
            this.stamper.stamp(
              screen.x[i] * this.ratio,
              screen.y[i] * this.ratio,
              mask,
              stampColour,
              alpha,
            );
            continue;
          }
        }
        glyphPath(
          ctx,
          GLYPH_ORDER[glyph],
          size,
          layer.rotationDeg[i],
          screen.x[i],
          screen.y[i],
        );
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}
