import type { ColumnarStyle, SlotRows } from "@/components/console/layer-state";
import type { Marker } from "@/components/console/markers";
import type { SlotDictionary } from "./dictionary";

/**
 * The rows of one layer as the overlay sees them: slot numbers, with ids and
 * names looked up in the dictionary when something (a click, a label) asks.
 */
export class ColumnarRows implements SlotRows {
  readonly slots: Uint32Array;
  private readonly dictionary: SlotDictionary;
  private readonly lon: Float64Array;
  private readonly lat: Float64Array;
  private readonly rotation: Float32Array;
  private readonly style: ColumnarStyle;
  private readonly starred: ReadonlySet<number>;

  constructor(options: {
    slots: Uint32Array;
    dictionary: SlotDictionary;
    lon: Float64Array;
    lat: Float64Array;
    rotation: Float32Array;
    style: ColumnarStyle;
    starred: ReadonlySet<number>;
  }) {
    this.slots = options.slots;
    this.dictionary = options.dictionary;
    this.lon = options.lon;
    this.lat = options.lat;
    this.rotation = options.rotation;
    this.style = options.style;
    this.starred = options.starred;
  }

  get count(): number {
    return this.slots.length;
  }

  idAt(index: number): string {
    return this.dictionary.idOf(this.slots[index]) ?? "";
  }

  markerAt(index: number): Marker {
    const starred = this.starred.has(index);
    return {
      id: this.idAt(index),
      lon: this.lon[index],
      lat: this.lat[index],
      glyph: this.style.glyph,
      size: this.style.size,
      tone: starred ? "accent" : "default",
      label: this.dictionary.nameOf(this.slots[index]) ?? "",
      entity: true,
      adaptive: this.style.adaptive,
      rotation: this.rotation[index],
      persistentLabel: starred,
    };
  }

  indexOf(id: string | null): number {
    if (id === null) return -1;
    const slot = this.dictionary.slotOf(id);
    return slot === undefined ? -1 : this.rowOfSlot(slot);
  }

  /** Row holding `slot`, or -1; the slots are in ascending order. */
  rowOfSlot(slot: number): number {
    const { slots } = this;
    let low = 0;
    let high = slots.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      const found = slots[mid];
      if (found === slot) return mid;
      if (found < slot) low = mid + 1;
      else high = mid - 1;
    }
    return -1;
  }
}
