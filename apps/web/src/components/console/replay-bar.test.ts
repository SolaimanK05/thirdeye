import { describe, expect, test } from "vitest";
import { backLabel } from "./replay-bar";

describe("backLabel", () => {
  test("says how far back the replay is, in plain words", () => {
    expect(backLabel(0)).toBe("Live");
    expect(backLabel(45 * 60_000)).toBe("−45 min");
    expect(backLabel(3 * 3_600_000)).toBe("−3 h");
    expect(backLabel((3 * 60 + 20) * 60_000)).toBe("−3 h 20 min");
  });
});
