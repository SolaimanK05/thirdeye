import { type DecodedFrame, decodeFrame } from "@/api/frames";
import { encodeFixture, type FixtureRows } from "@/api/frames-fixture";

/** Test-only: a readable way to build decoded frames for the data core. */
export type TestRow = {
  slot: number;
  lon?: number;
  lat?: number;
  t?: number;
  sog?: number | null;
  cog?: number | null;
  heading?: number | null;
  alt?: number | null;
  onGround?: boolean;
  cls?: number;
  id?: string;
  name?: string;
};

export type TestFrame = {
  kind?: "snapshot" | "delta";
  version: number;
  base?: number;
  epoch?: number;
  fetchedMs?: number;
  rows: TestRow[];
  removes?: number[];
  text?: boolean;
};

const NULL_U16 = 0xffff;
const NULL_I16 = -32768;

export function frameOf(spec: TestFrame): DecodedFrame {
  return decodeFrame(bytesOf(spec));
}

export function bytesOf(spec: TestFrame): Uint8Array<ArrayBuffer> {
  const rows: FixtureRows = {
    slot: [],
    lon: [],
    lat: [],
    t: [],
    sog: [],
    cog: [],
    heading: [],
    alt: [],
    flags: [],
    class: [],
    confidence: [],
  };
  const dictionary: { slot: number; id: string; name: string }[] = [];
  for (const row of spec.rows) {
    rows.slot.push(row.slot);
    rows.lon.push(Math.round((row.lon ?? 0) * 1e7));
    rows.lat.push(Math.round((row.lat ?? 0) * 1e7));
    rows.t.push(row.t ?? 1_800_000_000);
    rows.sog.push(row.sog == null ? NULL_U16 : Math.round(row.sog * 10));
    rows.cog.push(row.cog == null ? NULL_U16 : Math.round(row.cog * 100));
    rows.heading.push(
      row.heading == null ? NULL_U16 : Math.round(row.heading * 100),
    );
    rows.alt.push(row.alt == null ? NULL_I16 : Math.round(row.alt));
    rows.flags.push(row.onGround ? 1 : 0);
    rows.class.push(row.cls ?? 0);
    rows.confidence.push(0);
    if (spec.text ?? spec.kind !== "delta") {
      dictionary.push({
        slot: row.slot,
        id: row.id ?? `id-${row.slot}`,
        name: row.name ?? `NAME${row.slot}`,
      });
    }
  }
  return encodeFixture({
    kind: spec.kind === "delta" ? 2 : 1,
    version: spec.version,
    baseVersion: spec.base ?? (spec.kind === "delta" ? spec.version - 1 : 0),
    slotEpoch: spec.epoch ?? 1,
    fetchedMs: spec.fetchedMs ?? 1_800_000_000_000,
    rows,
    removes: spec.removes,
    dictionary,
  });
}
