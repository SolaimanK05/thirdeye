import { describe, expect, test } from "vitest";
import { searchStatus } from "./search-field";

const base = {
  text: "ever",
  settled: true,
  pending: false,
  failed: false,
  count: 3,
};

describe("searchStatus", () => {
  test("says nothing until there are enough characters", () => {
    expect(searchStatus({ ...base, text: "" })).toBeNull();
    expect(searchStatus({ ...base, text: "e" })).toBeNull();
  });

  test("says searching while the query is debouncing or in flight", () => {
    expect(searchStatus({ ...base, settled: false })).toBe("Searching…");
    expect(searchStatus({ ...base, pending: true })).toBe("Searching…");
  });

  test("reports failures", () => {
    expect(searchStatus({ ...base, failed: true })).toBe(
      "Search unavailable. Is the API running?",
    );
  });

  test("reports empty and counted results", () => {
    expect(searchStatus({ ...base, count: 0 })).toBe('Nothing matches "ever".');
    expect(searchStatus({ ...base, count: 1 })).toBe("1 result");
    expect(searchStatus({ ...base, count: 3 })).toBe("3 results");
  });
});
