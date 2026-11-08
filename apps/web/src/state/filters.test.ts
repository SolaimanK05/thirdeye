import { afterEach, describe, expect, test, vi } from "vitest";
import { FILTERS_STORAGE_KEY, isFilter, sanitiseFilters } from "./filters";

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

async function freshStore(storage: MemoryStorage) {
  vi.resetModules();
  vi.stubGlobal("localStorage", storage);
  return (await import("./filters")).useFilters;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sanitiseFilters", () => {
  test("keeps only known filter values", () => {
    expect(
      sanitiseFilters({ a: "all", b: "starred", c: "none", d: "loud", e: 3 }),
    ).toEqual({ a: "all", b: "starred", c: "none" });
  });

  test("anything that is not a plain object becomes empty", () => {
    for (const bad of [null, undefined, "all", 7, ["all"], true]) {
      expect(sanitiseFilters(bad)).toEqual({});
    }
  });

  test("a hostile key cannot reach the prototype", () => {
    const parsed: unknown = JSON.parse('{"__proto__":"none","a":"all"}');
    const clean = sanitiseFilters(parsed);
    expect(Object.getPrototypeOf(clean)).toBe(Object.prototype);
    expect(clean.a).toBe("all");
  });

  test("isFilter agrees", () => {
    expect(isFilter("starred")).toBe(true);
    expect(isFilter("mixed")).toBe(false);
    expect(isFilter(undefined)).toBe(false);
  });
});

describe("useFilters", () => {
  test("starts with no choices", async () => {
    const useFilters = await freshStore(new MemoryStorage());
    expect(useFilters.getState().filters).toEqual({});
  });

  test("setFilter changes one module only", async () => {
    const useFilters = await freshStore(new MemoryStorage());
    useFilters.getState().setFilter("a", "none");
    useFilters.getState().setFilter("b", "starred");
    useFilters.getState().setFilter("a", "all");
    expect(useFilters.getState().filters).toEqual({ a: "all", b: "starred" });
  });

  test("setFilters sets every listed module in one update", async () => {
    const useFilters = await freshStore(new MemoryStorage());
    useFilters.getState().setFilter("c", "starred");
    useFilters.getState().setFilters(["a", "b"], "none");
    expect(useFilters.getState().filters).toEqual({
      a: "none",
      b: "none",
      c: "starred",
    });
  });

  test("choices are written to storage", async () => {
    const storage = new MemoryStorage();
    const useFilters = await freshStore(storage);
    useFilters.getState().setFilter("earthquakes", "none");
    const saved = JSON.parse(storage.getItem(FILTERS_STORAGE_KEY) ?? "null");
    expect(saved.state).toEqual({ filters: { earthquakes: "none" } });
    expect(saved.version).toBe(1);
  });

  test("a reload restores the saved choices", async () => {
    const storage = new MemoryStorage({
      [FILTERS_STORAGE_KEY]: JSON.stringify({
        state: { filters: { earthquakes: "none" } },
        version: 1,
      }),
    });
    const useFilters = await freshStore(storage);
    expect(useFilters.getState().filters).toEqual({ earthquakes: "none" });
  });

  test("tampered storage is cleaned, not trusted", async () => {
    const storage = new MemoryStorage({
      [FILTERS_STORAGE_KEY]: JSON.stringify({
        state: { filters: { earthquakes: "none", vessels: "everything" } },
        version: 1,
      }),
    });
    const useFilters = await freshStore(storage);
    expect(useFilters.getState().filters).toEqual({ earthquakes: "none" });
  });

  test("unreadable storage falls back to no choices", async () => {
    const storage = new MemoryStorage({ [FILTERS_STORAGE_KEY]: "{not json" });
    const useFilters = await freshStore(storage);
    expect(useFilters.getState().filters).toEqual({});
  });

  test("storage that throws does not break the store", async () => {
    vi.resetModules();
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => undefined,
    });
    const { useFilters } = await import("./filters");
    useFilters.getState().setFilter("a", "none");
    expect(useFilters.getState().filters).toEqual({ a: "none" });
  });
});
