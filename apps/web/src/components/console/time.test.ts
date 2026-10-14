import { describe, expect, test } from "vitest";
import { formatUtc, msUntilNextSecond } from "./time";

describe("formatUtc", () => {
  test("formats the header clock in UTC", () => {
    const parts = formatUtc(new Date("2026-10-04T11:23:07.456Z"));
    expect(parts).toEqual({
      iso: "2026-10-04T11:23:07Z",
      time: "11:23:07Z",
      date: "SUN 04 OCT 2026",
    });
  });

  test("uses the UTC date, not the local one", () => {
    const parts = formatUtc(new Date("2026-12-31T23:59:59+06:00"));
    expect(parts.time).toBe("17:59:59Z");
    expect(parts.date).toBe("THU 31 DEC 2026");
  });

  test("pads single digits", () => {
    expect(formatUtc(new Date("2026-01-05T01:02:03Z")).time).toBe("01:02:03Z");
    expect(formatUtc(new Date("2026-01-05T01:02:03Z")).date).toBe(
      "MON 05 JAN 2026",
    );
  });
});

describe("msUntilNextSecond", () => {
  test("waits until the next whole second", () => {
    expect(msUntilNextSecond(1_000_250)).toBe(750);
    expect(msUntilNextSecond(1_000_999)).toBe(1);
    expect(msUntilNextSecond(1_000_000)).toBe(1000);
  });
});
