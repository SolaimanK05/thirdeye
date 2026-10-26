import { describe, expect, test } from "vitest";
import {
  formatMinute,
  formatUtc,
  msUntilNextSecond,
  relativeAge,
} from "./time";

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

describe("formatMinute", () => {
  test("drops the seconds and keeps the Z", () => {
    expect(formatMinute(new Date("2026-10-26T11:32:40Z"))).toBe("11:32Z");
    expect(formatMinute(new Date("2026-10-26T01:02:03Z"))).toBe("01:02Z");
  });
});

describe("msUntilNextSecond", () => {
  test("waits until the next whole second", () => {
    expect(msUntilNextSecond(1_000_250)).toBe(750);
    expect(msUntilNextSecond(1_000_999)).toBe(1);
    expect(msUntilNextSecond(1_000_000)).toBe(1000);
  });
});

describe("relativeAge", () => {
  const now = Date.parse("2026-10-14T06:00:00Z");
  const ago = (seconds: number) => new Date(now - seconds * 1000);

  test("rounds to the coarsest useful unit", () => {
    expect(relativeAge(ago(5), now)).toBe("just now");
    expect(relativeAge(ago(13 * 60), now)).toBe("13 min ago");
    expect(relativeAge(ago(3 * 3600), now)).toBe("3 h ago");
    expect(relativeAge(ago(3 * 86400), now)).toBe("3 d ago");
  });

  test("clock skew into the future reads as just now", () => {
    expect(relativeAge(ago(-30), now)).toBe("just now");
  });
});
