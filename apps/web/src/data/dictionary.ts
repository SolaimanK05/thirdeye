/**
 * Ids and names of the movers in one module, kept as the raw UTF-8 the server
 * sent and decoded one string at a time, only when somebody asks. A click, a
 * label or a starred item needs a handful of strings; the other 50,000 stay
 * bytes.
 */
export type DictionaryPatch = {
  slots: Uint32Array;
  idOffsets: Uint32Array;
  idBytes: Uint8Array;
  nameOffsets: Uint32Array;
  nameBytes: Uint8Array;
};

class Arena {
  bytes = new Uint8Array(0);
  used = 0;

  append(source: Uint8Array): number {
    const at = this.used;
    if (at + source.length > this.bytes.length) {
      const grown = new Uint8Array(
        Math.max(at + source.length, this.bytes.length * 2, 4096),
      );
      grown.set(this.bytes.subarray(0, at));
      this.bytes = grown;
    }
    this.bytes.set(source, at);
    this.used = at + source.length;
    return at;
  }

  clear(): void {
    this.bytes = new Uint8Array(0);
    this.used = 0;
  }
}

function widen(
  old: Uint32Array<ArrayBuffer>,
  length: number,
): Uint32Array<ArrayBuffer> {
  if (length <= old.length) return old;
  const next = new Uint32Array(Math.max(length, old.length * 2, 1024));
  next.set(old);
  return next;
}

export class SlotDictionary {
  private readonly decoder = new TextDecoder();
  private readonly idArena = new Arena();
  private readonly nameArena = new Arena();
  // Start offset and length of each slot's id and name; length 0 means unknown.
  private idStart: Uint32Array<ArrayBuffer> = new Uint32Array(0);
  private idLength: Uint32Array<ArrayBuffer> = new Uint32Array(0);
  private nameStart: Uint32Array<ArrayBuffer> = new Uint32Array(0);
  private nameLength: Uint32Array<ArrayBuffer> = new Uint32Array(0);
  private slotsById: Map<string, number> | null = null;
  private revision = 0;
  epoch = -1;

  /** Changes whenever text was added or cleared. */
  get version(): number {
    return this.revision;
  }

  reset(epoch: number): void {
    this.epoch = epoch;
    this.idArena.clear();
    this.nameArena.clear();
    this.idStart = new Uint32Array(0);
    this.idLength = new Uint32Array(0);
    this.nameStart = new Uint32Array(0);
    this.nameLength = new Uint32Array(0);
    this.slotsById = null;
    this.revision += 1;
  }

  append(patch: DictionaryPatch): void {
    const { slots } = patch;
    if (slots.length === 0) return;
    let top = 0;
    for (const slot of slots) if (slot >= top) top = slot + 1;
    this.idStart = widen(this.idStart, top);
    this.idLength = widen(this.idLength, top);
    this.nameStart = widen(this.nameStart, top);
    this.nameLength = widen(this.nameLength, top);
    const idBase = this.idArena.append(patch.idBytes);
    const nameBase = this.nameArena.append(patch.nameBytes);
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      this.idStart[slot] = idBase + patch.idOffsets[i];
      this.idLength[slot] = patch.idOffsets[i + 1] - patch.idOffsets[i];
      this.nameStart[slot] = nameBase + patch.nameOffsets[i];
      this.nameLength[slot] = patch.nameOffsets[i + 1] - patch.nameOffsets[i];
      if (this.slotsById) {
        const id = this.idOf(slot);
        if (id !== undefined) this.slotsById.set(id, slot);
      }
    }
    this.revision += 1;
  }

  idOf(slot: number): string | undefined {
    const length = this.idLength[slot];
    if (!length) return undefined;
    const start = this.idStart[slot];
    return this.decoder.decode(
      this.idArena.bytes.subarray(start, start + length),
    );
  }

  nameOf(slot: number): string | undefined {
    const length = this.nameLength[slot];
    if (!length) return undefined;
    const start = this.nameStart[slot];
    return this.decoder.decode(
      this.nameArena.bytes.subarray(start, start + length),
    );
  }

  /** Slot for an id. The first call decodes every id once; later calls are lookups. */
  slotOf(id: string): number | undefined {
    if (this.slotsById === null) {
      const map = new Map<string, number>();
      for (let slot = 0; slot < this.idLength.length; slot++) {
        const text = this.idOf(slot);
        if (text !== undefined) map.set(text, slot);
      }
      this.slotsById = map;
    }
    return this.slotsById.get(id);
  }
}
