import { describe, expect, it } from "vitest";
import { type Fix, HISTORY_SIZE, pushFix } from "@/motion/history";
import { Mirror } from "./mirror";
import { SlotHistory } from "./slot-history";
import { frameOf, type TestRow } from "./test-frames";

function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function load(history: SlotHistory, slot: number, row: Partial<TestRow>) {
  const mirror = new Mirror();
  mirror.apply(frameOf({ version: 1, rows: [{ slot, ...row }] }));
  history.record(mirror, slot);
}

describe("SlotHistory", () => {
  it("has nothing for a slot it never saw", () => {
    const history = new SlotHistory();
    expect(history.get(0)).toBeUndefined();
    expect(history.get(99_999)).toBeUndefined();
  });

  it("turns the mirror's reading into a fix, with missing values as null", () => {
    const history = new SlotHistory();
    load(history, 3, {
      lon: 5,
      lat: 6,
      t: 1000,
      sog: 12.5,
      cog: null,
      heading: 80,
    });
    expect(history.get(3)).toEqual([
      { t: 1_000_000, lon: 5, lat: 6, sog: 12.5, cog: null, track: 80 },
    ]);
  });

  it("uses the course as the track when there is no heading", () => {
    const history = new SlotHistory();
    load(history, 0, { t: 1000, cog: 45, heading: null });
    expect(history.get(0)?.[0].track).toBe(45);
    const none = new SlotHistory();
    load(none, 0, { t: 1000, cog: null, heading: null });
    expect(none.get(0)?.[0].track).toBeNull();
  });

  it("forgets a slot and starts again", () => {
    const history = new SlotHistory();
    load(history, 1, { t: 1000 });
    history.forget(1);
    expect(history.get(1)).toBeUndefined();
    load(history, 1, { t: 2000 });
    expect(history.get(1)).toHaveLength(1);
  });

  it("returns the same list until the slot changes", () => {
    const history = new SlotHistory();
    const mirror = new Mirror();
    mirror.apply(frameOf({ version: 1, rows: [{ slot: 0, t: 1000 }] }));
    history.record(mirror, 0);
    const first = history.get(0);
    expect(history.get(0)).toBe(first);
    history.record(mirror, 0);
    expect(history.get(0)).toBe(first);
  });

  it("behaves like pushFix for any order of arrivals", () => {
    const random = lcg(11);
    for (let round = 0; round < 200; round++) {
      const history = new SlotHistory();
      let expected: readonly Fix[] = [];
      const count = 1 + Math.floor(random() * 14);
      for (let i = 0; i < count; i++) {
        const row: TestRow = {
          slot: 0,
          lon: Math.round(random() * 3) * 10,
          lat: Math.round(random() * 3),
          t: 1000 + Math.floor(random() * 8),
          sog: random() < 0.2 ? null : Math.round(random() * 3),
          cog: random() < 0.2 ? null : Math.round(random() * 3) * 10,
          heading: random() < 0.5 ? null : Math.round(random() * 3) * 10,
        };
        const mirror = new Mirror();
        mirror.apply(frameOf({ version: 1, rows: [row] }));
        history.record(mirror, 0);
        expected = pushFix(expected, {
          t: mirror.t[0],
          lon: mirror.lon[0],
          lat: mirror.lat[0],
          sog: Number.isNaN(mirror.sog[0]) ? null : mirror.sog[0],
          cog: Number.isNaN(mirror.cog[0]) ? null : mirror.cog[0],
          track: !Number.isNaN(mirror.heading[0])
            ? mirror.heading[0]
            : Number.isNaN(mirror.cog[0])
              ? null
              : mirror.cog[0],
        });
        expect(history.get(0) ?? []).toEqual(expected);
        expect((history.get(0) ?? []).length).toBeLessThanOrEqual(HISTORY_SIZE);
      }
    }
  });

  it("keeps slots apart", () => {
    const history = new SlotHistory();
    const mirror = new Mirror();
    mirror.apply(
      frameOf({
        version: 1,
        rows: [
          { slot: 0, t: 1000, lon: 1 },
          { slot: 1, t: 1000, lon: 2 },
        ],
      }),
    );
    history.record(mirror, 0);
    history.record(mirror, 1);
    expect(history.get(0)?.[0].lon).toBe(1);
    expect(history.get(1)?.[0].lon).toBe(2);
  });
});
