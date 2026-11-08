/**
 * Decoder for TEF1 binary frames (see the Phase 16 spec, section 3).
 *
 * Pure and dependency free so it runs unchanged in a worker. Plain columns are
 * zero-copy views over the received buffer; byte-shuffled columns are
 * un-shuffled into fresh typed arrays.
 */

export const FRAME_KIND_SNAPSHOT = 1;
export const FRAME_KIND_DELTA = 2;

export const COORD_SCALE = 1e7;
export const SPEED_SCALE = 10;
export const ANGLE_SCALE = 100;
export const NULL_U16 = 0xffff;
export const NULL_I16 = -32768;
export const FLAG_ON_GROUND = 1;

const HEADER_BYTES = 40;
const ENTRY_BYTES = 12;
const ALIGN = 8;
const MAGIC = [0x54, 0x45, 0x46, 0x31] as const;

const COL = {
  slot: 1,
  lon: 2,
  lat: 3,
  t: 4,
  sog: 5,
  cog: 6,
  heading: 7,
  alt: 8,
  flags: 9,
  class: 10,
  confidence: 11,
  removes: 16,
  dictSlot: 20,
  dictIdOffsets: 21,
  dictId: 22,
  dictNameOffsets: 23,
  dictName: 24,
} as const;

const DTYPE = { u8: 1, u16: 2, i16: 3, u32: 4, i32: 5 } as const;
const WIDTH: Record<number, number> = { 1: 1, 2: 2, 3: 2, 4: 4, 5: 4 };

export class FrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrameError";
  }
}

/**
 * Text for the slots that are new or renamed in a frame. The raw offsets and
 * bytes are what the data worker forwards untouched; `ids` and `names` decode
 * to strings on first use, so a consumer that never reads them pays nothing.
 */
export type FrameDictionary = {
  slots: Uint32Array;
  idOffsets: Uint32Array;
  idBytes: Uint8Array;
  nameOffsets: Uint32Array;
  nameBytes: Uint8Array;
  readonly ids: string[];
  readonly names: string[];
};

export type DecodedFrame = {
  kind: "snapshot" | "delta";
  version: number;
  baseVersion: number;
  slotEpoch: number;
  fetchedMs: number;
  rows: number;
  slot: Uint32Array;
  lon: Int32Array;
  lat: Int32Array;
  t: Uint32Array;
  sog: Uint16Array;
  cog: Uint16Array;
  heading: Uint16Array;
  alt: Int16Array;
  flags: Uint8Array;
  class: Uint8Array;
  confidence: Uint8Array;
  removes: Uint32Array;
  dictionary: FrameDictionary;
};

type RawColumn = { dtype: number; bytes: Uint8Array };

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

function unshuffle(bytes: Uint8Array, width: number): Uint8Array {
  const out = new Uint8Array(bytes.length);
  const count = bytes.length / width;
  for (let plane = 0; plane < width; plane++) {
    const base = plane * count;
    for (let i = 0; i < count; i++) out[i * width + plane] = bytes[base + i];
  }
  return out;
}

function view<T extends ArrayBufferView>(
  column: RawColumn | undefined,
  name: string,
  dtype: number,
  make: (buffer: ArrayBuffer, offset: number, length: number) => T,
  expected: number | null,
): T {
  if (column === undefined) throw new FrameError(`column ${name} is missing`);
  if (column.dtype !== dtype)
    throw new FrameError(`column ${name} has the wrong type`);
  const width = WIDTH[dtype];
  const length = column.bytes.length / width;
  if (expected !== null && length !== expected) {
    throw new FrameError(
      `column ${name} has ${length} values, expected ${expected}`,
    );
  }
  const { buffer, byteOffset } = column.bytes;
  if (byteOffset % width === 0 && buffer instanceof ArrayBuffer) {
    return make(buffer, byteOffset, length);
  }
  const copy = column.bytes.slice();
  return make(copy.buffer as ArrayBuffer, 0, length);
}

function emptyView<T extends ArrayBufferView>(
  column: RawColumn | undefined,
  name: string,
  dtype: number,
  make: (buffer: ArrayBuffer, offset: number, length: number) => T,
  expected: number,
): T {
  if (expected === 0 && column === undefined)
    return make(new ArrayBuffer(0), 0, 0);
  return view(column, name, dtype, make, expected);
}

const decoder = new TextDecoder("utf-8", { fatal: true });

function checkOffsets(
  offsets: Uint32Array,
  length: number,
  count: number,
  name: string,
): void {
  if (offsets[0] !== 0) {
    throw new FrameError(`dictionary ${name} offsets do not start at zero`);
  }
  for (let i = 0; i < count; i++) {
    if (offsets[i + 1] < offsets[i] || offsets[i + 1] > length) {
      throw new FrameError(`dictionary ${name} offsets are out of range`);
    }
  }
}

function readText(
  offsets: Uint32Array,
  bytes: Uint8Array,
  count: number,
  name: string,
): string[] {
  const out = new Array<string>(count);
  for (let i = 0; i < count; i++) {
    const start = offsets[i];
    const end = offsets[i + 1];
    if (end < start || end > bytes.length) {
      throw new FrameError(`dictionary ${name} offsets are out of range`);
    }
    out[i] = decoder.decode(bytes.subarray(start, end));
  }
  return out;
}

export function decodeFrame(input: ArrayBuffer | Uint8Array): DecodedFrame {
  if (!LITTLE_ENDIAN)
    throw new FrameError("big-endian hosts are not supported");
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < HEADER_BYTES)
    throw new FrameError("frame is shorter than its header");
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC[i]) throw new FrameError("not a TEF1 frame");
  }
  const head = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kindCode = head.getUint8(4);
  if (kindCode !== FRAME_KIND_SNAPSHOT && kindCode !== FRAME_KIND_DELTA) {
    throw new FrameError(`unknown frame kind ${kindCode}`);
  }
  const columnCount = head.getUint16(6, true);
  const version = head.getUint32(8, true);
  const baseVersion = head.getUint32(12, true);
  const slotEpoch = head.getUint32(16, true);
  const rows = head.getUint32(20, true);
  const removes = head.getUint32(24, true);
  const dictionary = head.getUint32(28, true);
  const fetchedMs = head.getFloat64(32, true);
  if (bytes.length < HEADER_BYTES + ENTRY_BYTES * columnCount) {
    throw new FrameError("frame ends inside its column directory");
  }
  const columns = new Map<number, RawColumn>();
  for (let index = 0; index < columnCount; index++) {
    const at = HEADER_BYTES + ENTRY_BYTES * index;
    const id = head.getUint16(at, true);
    const dtype = head.getUint8(at + 2);
    const encoding = head.getUint8(at + 3);
    const offset = head.getUint32(at + 4, true);
    const length = head.getUint32(at + 8, true);
    const width = WIDTH[dtype];
    if (width === undefined || encoding > 1) continue;
    if (offset % ALIGN !== 0 || offset + length > bytes.length) {
      throw new FrameError(`column ${id} lies outside the frame`);
    }
    if (length % width !== 0)
      throw new FrameError(`column ${id} has a ragged length`);
    const body = bytes.subarray(offset, offset + length);
    columns.set(id, {
      dtype,
      bytes: encoding === 1 ? unshuffle(body, width) : body,
    });
  }

  const get = (id: number) => columns.get(id);
  const text = readDictionary(columns, dictionary);
  return {
    kind: kindCode === FRAME_KIND_SNAPSHOT ? "snapshot" : "delta",
    version,
    baseVersion,
    slotEpoch,
    fetchedMs,
    rows,
    slot: view(
      get(COL.slot),
      "slot",
      DTYPE.u32,
      (b, o, n) => new Uint32Array(b, o, n),
      rows,
    ),
    lon: view(
      get(COL.lon),
      "lon",
      DTYPE.i32,
      (b, o, n) => new Int32Array(b, o, n),
      rows,
    ),
    lat: view(
      get(COL.lat),
      "lat",
      DTYPE.i32,
      (b, o, n) => new Int32Array(b, o, n),
      rows,
    ),
    t: view(
      get(COL.t),
      "t",
      DTYPE.u32,
      (b, o, n) => new Uint32Array(b, o, n),
      rows,
    ),
    sog: view(
      get(COL.sog),
      "sog",
      DTYPE.u16,
      (b, o, n) => new Uint16Array(b, o, n),
      rows,
    ),
    cog: view(
      get(COL.cog),
      "cog",
      DTYPE.u16,
      (b, o, n) => new Uint16Array(b, o, n),
      rows,
    ),
    heading: view(
      get(COL.heading),
      "heading",
      DTYPE.u16,
      (b, o, n) => new Uint16Array(b, o, n),
      rows,
    ),
    alt: view(
      get(COL.alt),
      "alt",
      DTYPE.i16,
      (b, o, n) => new Int16Array(b, o, n),
      rows,
    ),
    flags: view(
      get(COL.flags),
      "flags",
      DTYPE.u8,
      (b, o, n) => new Uint8Array(b, o, n),
      rows,
    ),
    class: view(
      get(COL.class),
      "class",
      DTYPE.u8,
      (b, o, n) => new Uint8Array(b, o, n),
      rows,
    ),
    confidence: view(
      get(COL.confidence),
      "confidence",
      DTYPE.u8,
      (b, o, n) => new Uint8Array(b, o, n),
      rows,
    ),
    removes: emptyView(
      get(COL.removes),
      "removes",
      DTYPE.u32,
      (b, o, n) => new Uint32Array(b, o, n),
      removes,
    ),
    dictionary: text,
  };
}

function readDictionary(
  columns: Map<number, RawColumn>,
  count: number,
): FrameDictionary {
  if (count === 0) return emptyDictionary();
  const slots = view(
    columns.get(COL.dictSlot),
    "dict_slot",
    DTYPE.u32,
    (b, o, n) => new Uint32Array(b, o, n),
    count,
  );
  const idOffsets = view(
    columns.get(COL.dictIdOffsets),
    "dict_id_off",
    DTYPE.u32,
    (b, o, n) => new Uint32Array(b, o, n),
    count + 1,
  );
  const nameOffsets = view(
    columns.get(COL.dictNameOffsets),
    "dict_name_off",
    DTYPE.u32,
    (b, o, n) => new Uint32Array(b, o, n),
    count + 1,
  );
  const idBytes = columns.get(COL.dictId);
  const nameBytes = columns.get(COL.dictName);
  if (idBytes === undefined || nameBytes === undefined) {
    throw new FrameError("dictionary text columns are missing");
  }
  checkOffsets(idOffsets, idBytes.bytes.length, count, "id");
  checkOffsets(nameOffsets, nameBytes.bytes.length, count, "name");
  let ids: string[] | null = null;
  let names: string[] | null = null;
  return {
    slots,
    idOffsets,
    idBytes: idBytes.bytes,
    nameOffsets,
    nameBytes: nameBytes.bytes,
    get ids() {
      ids ??= readText(idOffsets, idBytes.bytes, count, "id");
      return ids;
    },
    get names() {
      names ??= readText(nameOffsets, nameBytes.bytes, count, "name");
      return names;
    },
  };
}

function emptyDictionary(): FrameDictionary {
  return {
    slots: new Uint32Array(0),
    idOffsets: new Uint32Array(1),
    idBytes: new Uint8Array(0),
    nameOffsets: new Uint32Array(1),
    nameBytes: new Uint8Array(0),
    ids: [],
    names: [],
  };
}

export const unpack = {
  degrees: (value: number) => value / COORD_SCALE,
  speed: (value: number) => (value === NULL_U16 ? null : value / SPEED_SCALE),
  angle: (value: number) => (value === NULL_U16 ? null : value / ANGLE_SCALE),
  altitude: (value: number) => (value === NULL_I16 ? null : value),
};
