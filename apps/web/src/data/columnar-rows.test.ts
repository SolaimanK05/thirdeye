import { describe, expect, it } from "vitest";
import { ColumnarRows } from "./columnar-rows";
import { SlotDictionary } from "./dictionary";

function rows(starred: number[] = []) {
  const dictionary = new SlotDictionary();
  dictionary.reset(1);
  const enc = new TextEncoder();
  const ids = ["id-2", "id-5", "id-9"].map((text) => enc.encode(text));
  const names = ["TWO", "FIVE", "NINE"].map((text) => enc.encode(text));
  const offsets = (parts: Uint8Array[]) => {
    const list = [0];
    for (const part of parts) list.push(list[list.length - 1] + part.length);
    return Uint32Array.from(list);
  };
  const bytes = (parts: Uint8Array[]) =>
    Uint8Array.from(parts.flatMap((p) => [...p]));
  dictionary.append({
    slots: Uint32Array.of(2, 5, 9),
    idOffsets: offsets(ids),
    idBytes: bytes(ids),
    nameOffsets: offsets(names),
    nameBytes: bytes(names),
  });
  return new ColumnarRows({
    slots: Uint32Array.of(2, 5, 9),
    dictionary,
    lon: Float64Array.of(10, 20, 30),
    lat: Float64Array.of(1, 2, 3),
    rotation: Float32Array.of(90, 180, 270),
    style: { glyph: "plane", size: 22, adaptive: true },
    starred: new Set(starred),
  });
}

describe("ColumnarRows", () => {
  it("describes a row as a marker only when asked", () => {
    const marker = rows().markerAt(1);
    expect(marker).toMatchObject({
      id: "id-5",
      label: "FIVE",
      lon: 20,
      lat: 2,
      glyph: "plane",
      size: 22,
      tone: "default",
      entity: true,
      adaptive: true,
      rotation: 180,
      persistentLabel: false,
    });
  });

  it("draws starred rows in the accent tone with a permanent label", () => {
    const marker = rows([2]).markerAt(2);
    expect(marker.tone).toBe("accent");
    expect(marker.persistentLabel).toBe(true);
  });

  it("finds the row of an id and of a slot, and says -1 when absent", () => {
    const source = rows();
    expect(source.indexOf("id-9")).toBe(2);
    expect(source.indexOf("id-2")).toBe(0);
    expect(source.indexOf("nope")).toBe(-1);
    expect(source.indexOf(null)).toBe(-1);
    expect(source.rowOfSlot(5)).toBe(1);
    expect(source.rowOfSlot(4)).toBe(-1);
    expect(source.count).toBe(3);
    expect(source.idAt(0)).toBe("id-2");
  });
});
