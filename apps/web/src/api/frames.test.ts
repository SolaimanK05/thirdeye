import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeFrame, FrameError, unpack } from "./frames";
import { encodeFixture, fleet } from "./frames-fixture";

const GOLDEN = resolve(__dirname, "../../../../contracts/frames");

type Expected = {
  kind: number;
  version: number;
  baseVersion: number;
  slotEpoch: number;
  fetchedMs: number;
  rows: number;
  columns: Record<string, number[]>;
  removes: number[];
  dictionary: { slot: number; id: string; name: string }[];
};

function load(name: string): { frame: Uint8Array; expected: Expected } {
  const bin = readFileSync(resolve(GOLDEN, `${name}.bin`));
  const frame = new Uint8Array(bin.buffer, bin.byteOffset, bin.byteLength);
  const expected = JSON.parse(
    readFileSync(resolve(GOLDEN, `${name}.json`), "utf8"),
  );
  return { frame, expected };
}

const COLUMN_OF: Record<string, string> = {
  slot: "slot",
  lon: "lon",
  lat: "lat",
  t: "t",
  sog: "sog",
  cog: "cog",
  heading: "heading",
  alt: "alt",
  flags: "flags",
  class: "class",
  confidence: "confidence",
};

describe("golden vectors", () => {
  for (const name of [
    "snapshot-aircraft",
    "delta-aircraft",
    "delta-empty",
    "snapshot-vessels",
  ]) {
    it(`decodes ${name} to the values the Python encoder wrote`, () => {
      const { frame, expected } = load(name);
      const decoded = decodeFrame(frame);
      expect(decoded.kind).toBe(expected.kind === 1 ? "snapshot" : "delta");
      expect(decoded.version).toBe(expected.version);
      expect(decoded.baseVersion).toBe(expected.baseVersion);
      expect(decoded.slotEpoch).toBe(expected.slotEpoch);
      expect(decoded.fetchedMs).toBe(expected.fetchedMs);
      expect(decoded.rows).toBe(expected.rows);
      for (const [column, key] of Object.entries(COLUMN_OF)) {
        const values = decoded[
          key as keyof typeof decoded
        ] as ArrayLike<number>;
        expect(Array.from(values), column).toEqual(expected.columns[column]);
      }
      expect(Array.from(decoded.removes)).toEqual(expected.removes);
      expect(
        decoded.dictionary.ids.map((id, i) => ({
          slot: decoded.dictionary.slots[i],
          id,
          name: decoded.dictionary.names[i],
        })),
      ).toEqual(expected.dictionary);
    });
  }

  it("keeps non-ASCII names intact", () => {
    const { frame } = load("snapshot-aircraft");
    expect(decodeFrame(frame).dictionary.names).toContain("Ünïcode ✈");
  });

  it("decodes a frame whose bytes do not start on an aligned offset", () => {
    const { frame, expected } = load("snapshot-aircraft");
    const shifted = new Uint8Array(frame.length + 3);
    shifted.set(frame, 3);
    const decoded = decodeFrame(shifted.subarray(3));
    expect(Array.from(decoded.lon)).toEqual(expected.columns.lon);
    expect(Array.from(decoded.sog)).toEqual(expected.columns.sog);
  });

  it("accepts a plain ArrayBuffer", () => {
    const { frame } = load("delta-aircraft");
    const copy = frame.slice().buffer;
    expect(decodeFrame(copy).rows).toBe(3);
  });
});

describe("unpacking", () => {
  it("turns sentinels into null and scaled integers into units", () => {
    expect(unpack.degrees(900_000_000)).toBe(90);
    expect(unpack.speed(2305)).toBe(230.5);
    expect(unpack.speed(0xffff)).toBeNull();
    expect(unpack.angle(9125)).toBe(91.25);
    expect(unpack.angle(0xffff)).toBeNull();
    expect(unpack.altitude(-32768)).toBeNull();
    expect(unpack.altitude(10_000)).toBe(10_000);
  });
});

describe("corrupt frames", () => {
  const { frame } = load("snapshot-aircraft");

  it("refuses a short frame", () => {
    expect(() => decodeFrame(frame.subarray(0, 10))).toThrow(FrameError);
  });

  it("refuses the wrong magic", () => {
    const bad = frame.slice();
    bad[0] = 0x58;
    expect(() => decodeFrame(bad)).toThrow("not a TEF1 frame");
  });

  it("refuses a truncated directory", () => {
    expect(() => decodeFrame(frame.subarray(0, 44))).toThrow(FrameError);
  });

  it("refuses a column that runs past the end", () => {
    expect(() => decodeFrame(frame.subarray(0, frame.length - 40))).toThrow(
      FrameError,
    );
  });

  it("refuses an unknown frame kind", () => {
    const bad = frame.slice();
    bad[4] = 9;
    expect(() => decodeFrame(bad)).toThrow("unknown frame kind");
  });

  it("refuses a row count that disagrees with the columns", () => {
    const bad = frame.slice();
    new DataView(bad.buffer).setUint32(20, 99, true);
    expect(() => decodeFrame(bad)).toThrow(FrameError);
  });

  it("refuses a frame whose required column was renamed to an unknown id", () => {
    const grown = frame.slice();
    const at = 40 + 12 * 0;
    new DataView(grown.buffer).setUint16(at, 250, true);
    expect(() => decodeFrame(grown)).toThrow("column slot is missing");
  });
});

describe("round trips and speed", () => {
  it("round-trips a fixture through the decoder", () => {
    const source = fleet(1000, 4);
    const decoded = decodeFrame(encodeFixture(source));
    expect(Array.from(decoded.lon)).toEqual(source.rows.lon);
    expect(Array.from(decoded.alt)).toEqual(source.rows.alt);
    expect(decoded.dictionary.ids[999]).toBe(source.dictionary?.[999].id);
  });

  it("round-trips an empty frame and one with removals only", () => {
    const empty = fleet(0);
    expect(decodeFrame(encodeFixture(empty)).rows).toBe(0);
    const removing = decodeFrame(
      encodeFixture({ ...empty, kind: 2, removes: [3, 9] }),
    );
    expect(Array.from(removing.removes)).toEqual([3, 9]);
  });

  it("decodes 50,000 rows well inside the worker budget", () => {
    const frame = encodeFixture(fleet(50_000, 9));
    const copy = frame.slice().buffer;
    decodeFrame(copy);
    const started = performance.now();
    const decoded = decodeFrame(copy);
    const elapsed = performance.now() - started;
    expect(decoded.rows).toBe(50_000);
    expect(elapsed).toBeLessThan(150);
  });
});
