/**
 * Test-only TEF1 writer. It mirrors the Python encoder closely enough to build
 * large frames for decode benchmarks and property tests without a server.
 */

const enc = new TextEncoder();

type Column = {
  id: number;
  dtype: number;
  bytes: Uint8Array;
  shuffled?: boolean;
};

function shuffle(bytes: Uint8Array, width: number): Uint8Array {
  const out = new Uint8Array(bytes.length);
  const count = bytes.length / width;
  for (let plane = 0; plane < width; plane++) {
    for (let i = 0; i < count; i++)
      out[plane * count + i] = bytes[i * width + plane];
  }
  return out;
}

function column(
  id: number,
  dtype: number,
  values: ArrayBufferView,
  shuffled = false,
): Column {
  const raw = new Uint8Array(
    values.buffer,
    values.byteOffset,
    values.byteLength,
  );
  const width = [0, 1, 2, 2, 4, 4][dtype];
  return { id, dtype, bytes: shuffled ? shuffle(raw, width) : raw, shuffled };
}

function offsets(parts: Uint8Array[]): Uint32Array {
  const out = new Uint32Array(parts.length + 1);
  parts.forEach((part, i) => {
    out[i + 1] = out[i] + part.length;
  });
  return out;
}

export type FixtureRows = {
  slot: number[];
  lon: number[];
  lat: number[];
  t: number[];
  sog: number[];
  cog: number[];
  heading: number[];
  alt: number[];
  flags: number[];
  class: number[];
  confidence: number[];
};

export type FixtureFrame = {
  kind?: 1 | 2;
  version?: number;
  baseVersion?: number;
  slotEpoch?: number;
  fetchedMs?: number;
  rows: FixtureRows;
  removes?: number[];
  dictionary?: { slot: number; id: string; name: string }[];
};

export function encodeFixture(frame: FixtureFrame): Uint8Array<ArrayBuffer> {
  const { rows } = frame;
  const removes = frame.removes ?? [];
  const dictionary = frame.dictionary ?? [];
  const ids = dictionary.map((entry) => enc.encode(entry.id));
  const names = dictionary.map((entry) => enc.encode(entry.name));
  const columns: Column[] = [
    column(1, 4, Uint32Array.from(rows.slot), true),
    column(2, 5, Int32Array.from(rows.lon), true),
    column(3, 5, Int32Array.from(rows.lat), true),
    column(4, 4, Uint32Array.from(rows.t), true),
    column(5, 2, Uint16Array.from(rows.sog)),
    column(6, 2, Uint16Array.from(rows.cog)),
    column(7, 2, Uint16Array.from(rows.heading)),
    column(8, 3, Int16Array.from(rows.alt)),
    column(9, 1, Uint8Array.from(rows.flags)),
    column(10, 1, Uint8Array.from(rows.class)),
    column(11, 1, Uint8Array.from(rows.confidence)),
  ];
  if (removes.length) columns.push(column(16, 4, Uint32Array.from(removes)));
  if (dictionary.length) {
    columns.push(
      column(20, 4, Uint32Array.from(dictionary.map((entry) => entry.slot))),
      column(21, 4, offsets(ids)),
      { id: 22, dtype: 1, bytes: concat(ids) },
      column(23, 4, offsets(names)),
      { id: 24, dtype: 1, bytes: concat(names) },
    );
  }
  const align = (n: number) => (n + 7) & ~7;
  let cursor = align(40 + 12 * columns.length);
  const placed = columns.map((entry) => {
    const offset = cursor;
    cursor = align(cursor + entry.bytes.length);
    return { entry, offset };
  });
  const out = new Uint8Array(cursor);
  const view = new DataView(out.buffer);
  out.set([0x54, 0x45, 0x46, 0x31]);
  view.setUint8(4, frame.kind ?? 1);
  view.setUint16(6, columns.length, true);
  view.setUint32(8, frame.version ?? 1, true);
  view.setUint32(12, frame.baseVersion ?? 0, true);
  view.setUint32(16, frame.slotEpoch ?? 1, true);
  view.setUint32(20, rows.slot.length, true);
  view.setUint32(24, removes.length, true);
  view.setUint32(28, dictionary.length, true);
  view.setFloat64(32, frame.fetchedMs ?? 0, true);
  placed.forEach(({ entry, offset }, index) => {
    const at = 40 + 12 * index;
    view.setUint16(at, entry.id, true);
    view.setUint8(at + 2, entry.dtype);
    view.setUint8(at + 3, entry.shuffled ? 1 : 0);
    view.setUint32(at + 4, offset, true);
    view.setUint32(at + 8, entry.bytes.length, true);
    out.set(entry.bytes, offset);
  });
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function fleet(count: number, seed = 1): FixtureFrame {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
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
  for (let i = 0; i < count; i++) {
    rows.slot.push(i);
    rows.lon.push(Math.round((next() * 360 - 180) * 1e7));
    rows.lat.push(Math.round((next() * 150 - 75) * 1e7));
    rows.t.push(1_800_000_000 - Math.floor(next() * 30));
    rows.sog.push(Math.round(next() * 2500));
    rows.cog.push(Math.round(next() * 35999));
    rows.heading.push(Math.round(next() * 35999));
    rows.alt.push(Math.round(next() * 12000));
    rows.flags.push(0);
    rows.class.push(i % 9);
    rows.confidence.push(0);
    dictionary.push({
      slot: i,
      id: `fixture-${i.toString(16).padStart(8, "0")}`,
      name: `CALL${i}`,
    });
  }
  return { rows, dictionary };
}
