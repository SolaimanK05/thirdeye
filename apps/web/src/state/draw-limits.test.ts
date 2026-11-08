import { afterEach, describe, expect, test, vi } from "vitest";
import { DRAW_LIMITS_STORAGE_KEY } from "./draw-limits";

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

async function fresh(storage: unknown) {
  vi.resetModules();
  vi.stubGlobal("localStorage", storage);
  return await import("./draw-limits");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saved draw limits", () => {
  test("start empty, so every module follows the renderer's default", async () => {
    const { useDrawLimits } = await fresh(new MemoryStorage());
    expect(useDrawLimits.getState().limits).toEqual({});
  });

  test("are saved per module and survive a reload", async () => {
    const storage = new MemoryStorage();
    const first = await fresh(storage);
    first.useDrawLimits.getState().setLimit("aircraft", 5000);
    first.useDrawLimits.getState().setLimit("vessels", null);
    const second = await fresh(storage);
    expect(second.useDrawLimits.getState().limits).toEqual({
      aircraft: 5000,
      vessels: null,
    });
  });

  test("drop invalid saved entries", async () => {
    const storage = new MemoryStorage({
      [DRAW_LIMITS_STORAGE_KEY]: JSON.stringify({
        state: { limits: { aircraft: 10_000, vessels: "lots", ports: -4 } },
        version: 1,
      }),
    });
    const { useDrawLimits } = await fresh(storage);
    expect(useDrawLimits.getState().limits).toEqual({ aircraft: 10_000 });
  });

  test("reset forgets one module only", async () => {
    const { useDrawLimits } = await fresh(new MemoryStorage());
    const { setLimit, reset } = useDrawLimits.getState();
    setLimit("aircraft", 2000);
    setLimit("vessels", 5000);
    reset("aircraft");
    expect(useDrawLimits.getState().limits).toEqual({ vessels: 5000 });
  });

  test("keep working when storage is unavailable", async () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const { useDrawLimits } = await fresh(broken);
    useDrawLimits.getState().setLimit("aircraft", 3000);
    expect(useDrawLimits.getState().limits).toEqual({ aircraft: 3000 });
  });
});
