export type StampMask = {
  side: number;
  alpha: Uint8Array;
};

export type StampBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export function packColour(red: number, green: number, blue: number): number {
  return ((blue << 16) | (green << 8) | red) >>> 0;
}

export class DotStamper {
  private pixels = new Uint32Array(0);
  private width = 0;
  private height = 0;
  private left = 0;
  private top = 0;
  private right = 0;
  private bottom = 0;

  begin(width: number, height: number): void {
    if (width !== this.width || height !== this.height) {
      this.pixels = new Uint32Array(width * height);
      this.width = width;
      this.height = height;
    } else {
      this.pixels.fill(0);
    }
    this.left = width;
    this.top = height;
    this.right = 0;
    this.bottom = 0;
  }

  get buffer(): ArrayBuffer {
    return this.pixels.buffer as ArrayBuffer;
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  get bounds(): StampBounds | null {
    if (this.right <= this.left || this.bottom <= this.top) return null;
    return {
      left: this.left,
      top: this.top,
      right: this.right,
      bottom: this.bottom,
    };
  }

  stamp(
    centreX: number,
    centreY: number,
    mask: StampMask,
    colour: number,
    opacity: number,
  ): void {
    const half = mask.side >> 1;
    const x0 = Math.round(centreX) - half;
    const y0 = Math.round(centreY) - half;
    const from = Math.max(0, -x0);
    const to = Math.min(mask.side, this.width - x0);
    const rowFrom = Math.max(0, -y0);
    const rowTo = Math.min(mask.side, this.height - y0);
    if (from >= to || rowFrom >= rowTo) return;
    const { alpha } = mask;
    const { pixels } = this;
    for (let row = rowFrom; row < rowTo; row++) {
      const source = row * mask.side;
      const target = (y0 + row) * this.width + x0;
      for (let column = from; column < to; column++) {
        const coverage = alpha[source + column];
        if (coverage === 0) continue;
        const value = (coverage * opacity + 0.5) | 0;
        if (value === 0) continue;
        const at = target + column;
        if (value > pixels[at] >>> 24) {
          pixels[at] = ((value << 24) | colour) >>> 0;
        }
      }
    }
    if (x0 + from < this.left) this.left = x0 + from;
    if (y0 + rowFrom < this.top) this.top = y0 + rowFrom;
    if (x0 + to > this.right) this.right = x0 + to;
    if (y0 + rowTo > this.bottom) this.bottom = y0 + rowTo;
  }
}
