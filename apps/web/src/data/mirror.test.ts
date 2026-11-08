import { describe, expect, it } from "vitest";
import { FrameGapError, Mirror } from "./mirror";
import { frameOf } from "./test-frames";

describe("Mirror", () => {
  it("holds a snapshot as dequantised columns", () => {
    const mirror = new Mirror();
    const applied = mirror.apply(
      frameOf({
        version: 4,
        rows: [
          {
            slot: 2,
            lon: -122.4194,
            lat: 37.7749,
            t: 1_800_000_010,
            sog: 12.3,
            cog: 45.67,
            heading: null,
            alt: 10_500,
            onGround: true,
            cls: 3,
          },
        ],
      }),
    );
    expect(applied.reset).toBe(true);
    expect([...applied.changed]).toEqual([2]);
    expect(mirror.count).toBe(1);
    expect(mirror.extent).toBe(3);
    expect(mirror.alive[2]).toBe(1);
    expect(mirror.lon[2]).toBeCloseTo(-122.4194, 6);
    expect(mirror.lat[2]).toBeCloseTo(37.7749, 6);
    expect(mirror.t[2]).toBe(1_800_000_010_000);
    expect(mirror.sog[2]).toBeCloseTo(12.3, 6);
    expect(mirror.cog[2]).toBeCloseTo(45.67, 6);
    expect(Number.isNaN(mirror.heading[2])).toBe(true);
    expect(mirror.alt[2]).toBe(10_500);
    expect(mirror.onGround(2)).toBe(true);
    expect(mirror.cls[2]).toBe(3);
    expect(mirror.version).toBe(4);
  });

  it("applies removes before upserts so a reused slot ends up alive", () => {
    const mirror = new Mirror();
    mirror.apply(
      frameOf({ version: 1, rows: [{ slot: 0 }, { slot: 1 }, { slot: 2 }] }),
    );
    const applied = mirror.apply(
      frameOf({
        kind: "delta",
        version: 2,
        rows: [{ slot: 1, lon: 5 }],
        removes: [1, 2],
      }),
    );
    expect([...applied.removed]).toEqual([1, 2]);
    expect(mirror.count).toBe(2);
    expect(mirror.alive[1]).toBe(1);
    expect(mirror.alive[2]).toBe(0);
    expect(mirror.lon[1]).toBeCloseTo(5, 6);
  });

  it("ignores removes of slots it never held", () => {
    const mirror = new Mirror();
    mirror.apply(frameOf({ version: 1, rows: [{ slot: 0 }] }));
    const applied = mirror.apply(
      frameOf({ kind: "delta", version: 2, rows: [], removes: [7, 0] }),
    );
    expect([...applied.removed]).toEqual([0]);
    expect(mirror.count).toBe(0);
  });

  it("refuses deltas from the wrong version or epoch and keeps its state", () => {
    const mirror = new Mirror();
    mirror.apply(frameOf({ version: 3, rows: [{ slot: 0, lon: 1 }] }));
    expect(() =>
      mirror.apply(
        frameOf({
          kind: "delta",
          version: 9,
          base: 8,
          rows: [{ slot: 0, lon: 2 }],
        }),
      ),
    ).toThrow(FrameGapError);
    expect(() =>
      mirror.apply(frameOf({ kind: "delta", version: 4, epoch: 2, rows: [] })),
    ).toThrow(FrameGapError);
    expect(mirror.lon[0]).toBeCloseTo(1, 6);
    expect(mirror.version).toBe(3);
  });

  it("grows past its first allocation without losing rows", () => {
    const mirror = new Mirror();
    mirror.apply(frameOf({ version: 1, rows: [{ slot: 0, lon: 1 }] }));
    const rows = Array.from({ length: 5000 }, (_, i) => ({
      slot: i + 1,
      lon: i / 100,
    }));
    mirror.apply(frameOf({ kind: "delta", version: 2, rows }));
    expect(mirror.count).toBe(5001);
    expect(mirror.lon[0]).toBeCloseTo(1, 6);
    expect(mirror.lon[5000]).toBeCloseTo(49.99, 5);
  });

  it("replaces everything on a snapshot, even with a new epoch", () => {
    const mirror = new Mirror();
    mirror.apply(frameOf({ version: 1, rows: [{ slot: 0 }, { slot: 1 }] }));
    mirror.apply(frameOf({ version: 7, epoch: 2, rows: [{ slot: 0 }] }));
    expect(mirror.count).toBe(1);
    expect(mirror.alive[1]).toBe(0);
    expect(mirror.epoch).toBe(2);
  });
});
