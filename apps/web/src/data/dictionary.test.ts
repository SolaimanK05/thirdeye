import { describe, expect, it } from "vitest";
import { SlotDictionary } from "./dictionary";

const enc = new TextEncoder();

function patch(entries: { slot: number; id: string; name: string }[]) {
  const ids = entries.map((entry) => enc.encode(entry.id));
  const names = entries.map((entry) => enc.encode(entry.name));
  const offsets = (parts: Uint8Array[]) => {
    const out = new Uint32Array(parts.length + 1);
    parts.forEach((part, i) => {
      out[i + 1] = out[i] + part.length;
    });
    return out;
  };
  const join = (parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  };
  return {
    slots: Uint32Array.from(entries.map((entry) => entry.slot)),
    idOffsets: offsets(ids),
    idBytes: join(ids),
    nameOffsets: offsets(names),
    nameBytes: join(names),
  };
}

describe("SlotDictionary", () => {
  it("looks up ids and names by slot, including non-ASCII text", () => {
    const dictionary = new SlotDictionary();
    dictionary.reset(1);
    dictionary.append(
      patch([
        { slot: 0, id: "aircraft:a1", name: "UAL123" },
        { slot: 5, id: "aircraft:b2", name: "Zürich Süd ✈" },
      ]),
    );
    expect(dictionary.idOf(0)).toBe("aircraft:a1");
    expect(dictionary.nameOf(0)).toBe("UAL123");
    expect(dictionary.idOf(5)).toBe("aircraft:b2");
    expect(dictionary.nameOf(5)).toBe("Zürich Süd ✈");
    expect(dictionary.idOf(3)).toBeUndefined();
    expect(dictionary.nameOf(99)).toBeUndefined();
  });

  it("finds a slot from an id, and keeps finding it as more text arrives", () => {
    const dictionary = new SlotDictionary();
    dictionary.reset(1);
    dictionary.append(patch([{ slot: 0, id: "a", name: "A" }]));
    expect(dictionary.slotOf("a")).toBe(0);
    expect(dictionary.slotOf("b")).toBeUndefined();
    dictionary.append(patch([{ slot: 7, id: "b", name: "B" }]));
    expect(dictionary.slotOf("b")).toBe(7);
  });

  it("takes a rename without losing the id", () => {
    const dictionary = new SlotDictionary();
    dictionary.reset(1);
    dictionary.append(patch([{ slot: 2, id: "x", name: "OLD" }]));
    dictionary.append(patch([{ slot: 2, id: "x", name: "NEW" }]));
    expect(dictionary.nameOf(2)).toBe("NEW");
    expect(dictionary.slotOf("x")).toBe(2);
  });

  it("forgets everything on reset and counts its revisions", () => {
    const dictionary = new SlotDictionary();
    dictionary.reset(1);
    const first = dictionary.version;
    dictionary.append(patch([{ slot: 0, id: "a", name: "A" }]));
    expect(dictionary.version).toBeGreaterThan(first);
    dictionary.reset(2);
    expect(dictionary.epoch).toBe(2);
    expect(dictionary.idOf(0)).toBeUndefined();
    expect(dictionary.slotOf("a")).toBeUndefined();
  });

  it("holds 100,000 entries and answers lookups quickly", () => {
    const entries = Array.from({ length: 100_000 }, (_, slot) => ({
      slot,
      id: `fixture-${slot.toString(16).padStart(8, "0")}`,
      name: `CALL${slot}`,
    }));
    const dictionary = new SlotDictionary();
    dictionary.reset(1);
    dictionary.append(patch(entries));
    const started = performance.now();
    for (let slot = 0; slot < 100_000; slot += 997) {
      expect(dictionary.nameOf(slot)).toBe(`CALL${slot}`);
    }
    expect(performance.now() - started).toBeLessThan(50);
    expect(dictionary.slotOf("fixture-0000c350")).toBe(0xc350);
  });
});
