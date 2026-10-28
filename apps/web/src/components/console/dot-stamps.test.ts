import { describe, expect, test } from "vitest";
import { DotStamper, packColour, type StampMask } from "./dot-stamps";

const MASK: StampMask = {
  side: 4,
  alpha: Uint8Array.from([
    0, 128, 128, 0, 128, 255, 255, 128, 128, 255, 255, 128, 0, 128, 128, 0,
  ]),
};
const GREEN = packColour(0, 255, 0);

function pixel(stamper: DotStamper, x: number, y: number): number {
  const { width } = stamper.size;
  return new Uint32Array(stamper.buffer)[y * width + x];
}

describe("DotStamper", () => {
  test("packs a colour as little-endian RGBA bytes", () => {
    expect(packColour(1, 2, 3)).toBe(0x00030201);
  });

  test("writes the mask around the rounded centre", () => {
    const stamper = new DotStamper();
    stamper.begin(20, 20);
    stamper.stamp(10.4, 10.6, MASK, GREEN, 1);
    expect(pixel(stamper, 9, 10) >>> 24).toBe(255);
    expect(pixel(stamper, 9, 10) & 0x00ffffff).toBe(GREEN);
    expect(pixel(stamper, 8, 9)).toBe(0);
    expect(pixel(stamper, 9, 9) >>> 24).toBe(128);
  });

  test("scales coverage by the opacity", () => {
    const stamper = new DotStamper();
    stamper.begin(20, 20);
    stamper.stamp(10, 10, MASK, GREEN, 0.5);
    expect(pixel(stamper, 9, 9) >>> 24).toBe(128);
    expect(pixel(stamper, 9, 8) >>> 24).toBe(64);
  });

  test("overlapping dots keep the stronger coverage rather than adding up", () => {
    const stamper = new DotStamper();
    stamper.begin(20, 20);
    stamper.stamp(10, 10, MASK, GREEN, 1);
    stamper.stamp(11, 10, MASK, GREEN, 1);
    expect(pixel(stamper, 10, 10) >>> 24).toBe(255);
    expect(pixel(stamper, 9, 9) >>> 24).toBe(255);
  });

  test("a faint dot never dims a strong one underneath", () => {
    const stamper = new DotStamper();
    stamper.begin(20, 20);
    stamper.stamp(10, 10, MASK, GREEN, 1);
    stamper.stamp(10, 10, MASK, packColour(255, 0, 0), 0.25);
    expect(pixel(stamper, 9, 9) & 0x00ffffff).toBe(GREEN);
  });

  test("clips at every edge without throwing", () => {
    const stamper = new DotStamper();
    stamper.begin(6, 6);
    for (const [x, y] of [
      [0, 0],
      [6, 0],
      [0, 6],
      [6, 6],
      [-10, 3],
      [3, 40],
    ]) {
      stamper.stamp(x, y, MASK, GREEN, 1);
    }
    expect(pixel(stamper, 0, 0) >>> 24).toBeGreaterThan(0);
    expect(pixel(stamper, 5, 5) >>> 24).toBeGreaterThan(0);
  });

  test("reports the area that was touched, and nothing before a stamp", () => {
    const stamper = new DotStamper();
    stamper.begin(30, 30);
    expect(stamper.bounds).toBeNull();
    stamper.stamp(10, 12, MASK, GREEN, 1);
    stamper.stamp(20, 5, MASK, GREEN, 1);
    expect(stamper.bounds).toEqual({ left: 8, top: 3, right: 22, bottom: 14 });
  });

  test("begin clears the previous frame and keeps the buffer when the size holds", () => {
    const stamper = new DotStamper();
    stamper.begin(20, 20);
    stamper.stamp(10, 10, MASK, GREEN, 1);
    const buffer = stamper.buffer;
    stamper.begin(20, 20);
    expect(stamper.buffer).toBe(buffer);
    expect(pixel(stamper, 9, 9)).toBe(0);
    expect(stamper.bounds).toBeNull();
    stamper.begin(10, 10);
    expect(stamper.buffer).not.toBe(buffer);
  });

  test("a mask that misses the canvas touches nothing", () => {
    const stamper = new DotStamper();
    stamper.begin(10, 10);
    stamper.stamp(-50, -50, MASK, GREEN, 1);
    expect(stamper.bounds).toBeNull();
  });
});
