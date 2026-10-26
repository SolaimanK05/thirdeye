import { afterEach, describe, expect, test, vi } from "vitest";
import { REFINE_STORAGE_KEY, sanitiseStored } from "./refine";

class MemoryStorage {
  private readonly items = new Map<string, string>();

  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) {
      this.items.set(key, value);
    }
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }
}

async function freshStore(storage: unknown) {
  vi.resetModules();
  vi.stubGlobal("localStorage", storage);
  return (await import("./refine")).useRefine;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sanitiseStored", () => {
  test("keeps one object per module and drops everything else", () => {
    expect(
      sanitiseStored({
        aircraft: { altitude: [1, 2] },
        bad: 3,
        worse: [1],
        none: null,
      }),
    ).toEqual({ aircraft: { altitude: [1, 2] } });
  });

  test("anything that is not an object gives nothing", () => {
    for (const value of [undefined, null, "x", 4, ["a"]]) {
      expect(sanitiseStored(value)).toEqual({});
    }
  });
});

describe("useRefine", () => {
  test("starts with nothing stored", async () => {
    const useRefine = await freshStore(new MemoryStorage());
    expect(useRefine.getState().stored).toEqual({});
  });

  test("set changes one control and keeps the others", async () => {
    const useRefine = await freshStore(new MemoryStorage());
    useRefine.getState().set("aircraft", "altitude", [1000, 2000]);
    useRefine.getState().set("earthquakes", "magnitude", 4);
    useRefine.getState().set("earthquakes", "age", 3600);
    expect(useRefine.getState().stored).toEqual({
      aircraft: { altitude: [1000, 2000] },
      earthquakes: { magnitude: 4, age: 3600 },
    });
  });

  test("reset clears one module only", async () => {
    const useRefine = await freshStore(new MemoryStorage());
    useRefine.getState().set("aircraft", "altitude", [1000, 2000]);
    useRefine.getState().set("ports", "harbour", ["L"]);
    useRefine.getState().reset("aircraft");
    expect(useRefine.getState().stored).toEqual({ ports: { harbour: ["L"] } });
  });

  test("choices are written to storage and read back", async () => {
    const storage = new MemoryStorage();
    const first = await freshStore(storage);
    first.getState().set("aircraft", "altitude", [5000, 9000]);
    expect(storage.getItem(REFINE_STORAGE_KEY)).toContain("5000");
    const second = await freshStore(storage);
    expect(second.getState().stored).toEqual({
      aircraft: { altitude: [5000, 9000] },
    });
  });

  test("tampered storage is cleaned, not trusted", async () => {
    const storage = new MemoryStorage({
      [REFINE_STORAGE_KEY]: JSON.stringify({
        state: { stored: { aircraft: { altitude: [1, 2] }, x: 5 } },
        version: 2,
      }),
    });
    const useRefine = await freshStore(storage);
    expect(useRefine.getState().stored).toEqual({
      aircraft: { altitude: [1, 2] },
    });
  });

  test("an altitude saved under the old 45,000 ft ceiling is dropped, the rest kept", async () => {
    const storage = new MemoryStorage({
      [REFINE_STORAGE_KEY]: JSON.stringify({
        state: {
          stored: {
            aircraft: { altitude: [25000, 45000] },
            ports: { harbour: ["L"] },
          },
        },
        version: 1,
      }),
    });
    const useRefine = await freshStore(storage);
    expect(useRefine.getState().stored).toEqual({
      aircraft: {},
      ports: { harbour: ["L"] },
    });
  });

  test("a module with no altitude saved is left alone by the migration", async () => {
    const storage = new MemoryStorage({
      [REFINE_STORAGE_KEY]: JSON.stringify({
        state: { stored: { ports: { harbour: ["M"] } } },
        version: 1,
      }),
    });
    const useRefine = await freshStore(storage);
    expect(useRefine.getState().stored).toEqual({ ports: { harbour: ["M"] } });
  });

  test("unreadable storage falls back to nothing stored", async () => {
    const storage = new MemoryStorage({ [REFINE_STORAGE_KEY]: "{not json" });
    const useRefine = await freshStore(storage);
    expect(useRefine.getState().stored).toEqual({});
  });

  test("storage that throws does not break the store", async () => {
    const useRefine = await freshStore({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => undefined,
    });
    useRefine.getState().set("aircraft", "altitude", [0, 1000]);
    expect(useRefine.getState().stored).toEqual({
      aircraft: { altitude: [0, 1000] },
    });
  });
});
