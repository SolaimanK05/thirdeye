import { describe, expect, test } from "vitest";
import { type NoticeInput, satellitesNotice } from "./satellites-notice";

const base: NoticeInput = {
  active: true,
  inRange: false,
  pinned: false,
  here: 12,
  capPercent: 300,
};

describe("the satellites notice", () => {
  test("tells how to see them when the zoom hides them", () => {
    expect(satellitesNotice(base)).toEqual({
      text: "Satellites auto-hide above 300%. 12 overhead",
      action: "show-here",
    });
  });

  test("does not invent a count before it knows one", () => {
    expect(satellitesNotice({ ...base, here: undefined })).toEqual({
      text: "Satellites auto-hide above 300%",
      action: "show-here",
    });
  });

  test("says zero when nothing is overhead", () => {
    expect(satellitesNotice({ ...base, here: 0 })?.text).toBe(
      "Satellites auto-hide above 300%. 0 overhead",
    );
  });

  test("offers AUTO while pinned and out of range", () => {
    expect(satellitesNotice({ ...base, pinned: true })).toEqual({
      text: "Showing 12 overhead",
      action: "auto",
    });
    expect(
      satellitesNotice({ ...base, pinned: true, here: undefined })?.text,
    ).toBe("Showing satellites here");
  });

  test("says nothing while they are drawn, off, or unavailable", () => {
    expect(satellitesNotice({ ...base, inRange: true })).toBeNull();
    expect(
      satellitesNotice({ ...base, inRange: true, pinned: true }),
    ).toBeNull();
    expect(satellitesNotice({ ...base, active: false })).toBeNull();
  });
});
