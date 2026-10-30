import { LINE_WIDTH } from "./glyphs";
import { STALE_ALPHA } from "./gpu/frame";
import { type LabelCandidate, placeLabels } from "./label-layout";
import type { MarkerTone } from "./markers";
import type { MarkerPalette } from "./renderer";

const CRUMB_RADIUS = 2.4;
const BRACKET_GAP = 6;
const BRACKET_ARM = 5;
const LABEL_FONT_PX = 11;
const LABEL_PAD_X = 5;
const LABEL_HEIGHT = 17;
const NAME_GAP = 4;
const NAME_PAD_X = 3;
const NAME_HEIGHT = 15;
const NAME_LIMIT = 120;
const NAME_WIDTH_CACHE_MAX = 5000;

export type NameLabel = LabelCandidate & {
  text: string;
  tone: MarkerTone;
  stale: boolean;
};

export type SelectedMark = {
  x: number;
  y: number;
  label: string;
  size: number;
};

export type CrumbDot = { x: number; y: number; alpha: number };

export class LabelPainter {
  private readonly palette: MarkerPalette;
  private readonly widths = new Map<string, number>();

  constructor(palette: MarkerPalette) {
    this.palette = palette;
  }

  begin(ctx: CanvasRenderingContext2D): void {
    ctx.font = `${LABEL_FONT_PX}px ${this.palette.font}`;
  }

  clear(): void {
    this.widths.clear();
  }

  nameLabel(
    ctx: CanvasRenderingContext2D,
    text: string,
    tone: MarkerTone,
    stale: boolean,
    size: number,
    x: number,
    y: number,
  ): NameLabel {
    return {
      x: x + size / 2 + NAME_GAP,
      y: y - NAME_HEIGHT / 2,
      width: this.width(ctx, text) + NAME_PAD_X * 2,
      height: NAME_HEIGHT,
      priority: (tone === "accent" ? 1000 : 0) + size,
      text,
      tone,
      stale,
    };
  }

  drawCrumbs(ctx: CanvasRenderingContext2D, dots: readonly CrumbDot[]): void {
    if (dots.length === 0) return;
    ctx.fillStyle = this.palette.accent;
    for (const dot of dots) {
      ctx.globalAlpha = dot.alpha;
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, CRUMB_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawNames(
    ctx: CanvasRenderingContext2D,
    names: readonly NameLabel[],
    selected: SelectedMark | null,
  ): void {
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

  drawSelection(ctx: CanvasRenderingContext2D, selected: SelectedMark): void {
    const { x, y, size, label } = selected;
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
    const textWidth = ctx.measureText(label).width;
    const left = x + reach + 6;
    const top = y - LABEL_HEIGHT / 2;
    ctx.fillStyle = this.palette.plate;
    ctx.fillRect(left, top, textWidth + LABEL_PAD_X * 2, LABEL_HEIGHT);
    ctx.strokeRect(left, top, textWidth + LABEL_PAD_X * 2, LABEL_HEIGHT);
    ctx.fillStyle = this.palette.accent;
    ctx.textBaseline = "middle";
    ctx.fillText(label, left + LABEL_PAD_X, y + 0.5);
  }

  private toneColour(tone: MarkerTone): string {
    if (tone === "notable") return this.palette.notable;
    if (tone === "accent") return this.palette.accent;
    return this.palette.default;
  }

  private width(ctx: CanvasRenderingContext2D, text: string): number {
    const known = this.widths.get(text);
    if (known !== undefined) return known;
    if (this.widths.size >= NAME_WIDTH_CACHE_MAX) this.widths.clear();
    const width = ctx.measureText(text).width;
    this.widths.set(text, width);
    return width;
  }
}
