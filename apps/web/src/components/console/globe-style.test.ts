import { afterEach, describe, expect, test, vi } from "vitest";
import {
  GLOBE_STYLE_KEY,
  isGlobeStyle,
  readSavedStyle,
  saveStyle,
} from "./globe-style";

function stubStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  });
  return data;
}

afterEach(() => vi.unstubAllGlobals());

describe("the saved globe style", () => {
  test("a style that was saved comes back", () => {
    const data = stubStorage();
    saveStyle("NATURAL");
    expect(data.get(GLOBE_STYLE_KEY)).toBe("NATURAL");
    expect(readSavedStyle()).toBe("NATURAL");
  });

  test("nothing saved, or something that is not a style, reads as none", () => {
    stubStorage();
    expect(readSavedStyle()).toBeNull();
    stubStorage({ [GLOBE_STYLE_KEY]: "PURPLE" });
    expect(readSavedStyle()).toBeNull();
  });

  test("blocked storage neither throws nor remembers", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(readSavedStyle()).toBeNull();
    expect(() => saveStyle("BLACK")).not.toThrow();
  });

  test("only the three known styles are accepted", () => {
    expect(["GREEN", "NATURAL", "BLACK"].every(isGlobeStyle)).toBe(true);
    expect(isGlobeStyle("green")).toBe(false);
    expect(isGlobeStyle(undefined)).toBe(false);
  });
});
