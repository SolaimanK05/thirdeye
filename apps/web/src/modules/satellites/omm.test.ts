import { describe, expect, test } from "vitest";
import { ISS_EPOCH, ISS_OMM } from "./fixtures";
import { epochMs, parseOmm } from "./omm";

describe("parseOmm", () => {
  test("reads a CelesTrak element set", () => {
    const omm = parseOmm(ISS_OMM, null);
    expect(omm).toMatchObject({
      OBJECT_NAME: "ISS (ZARYA)",
      OBJECT_ID: "1998-067A",
      NORAD_CAT_ID: 25544,
      MEAN_MOTION: 15.4991,
    });
  });

  test("takes the name it is given over the one inside", () => {
    expect(parseOmm(ISS_OMM, "Station")?.OBJECT_NAME).toBe("Station");
  });

  test("accepts a catalogue number that does not fit in a two-line element set", () => {
    expect(parseOmm({ ...ISS_OMM, NORAD_CAT_ID: 270001 }, null)).not.toBeNull();
    expect(
      parseOmm({ ...ISS_OMM, NORAD_CAT_ID: 123456789 }, null),
    ).not.toBeNull();
  });

  test("accepts a record with no name or designator", () => {
    const { OBJECT_NAME: _name, OBJECT_ID: _id, ...bare } = ISS_OMM;
    expect(parseOmm(bare, null)).toMatchObject({
      OBJECT_NAME: "",
      OBJECT_ID: "",
    });
  });

  test.each([
    ["not an object", "text"],
    ["an array", []],
    ["null", null],
    ["a missing mean motion", { ...ISS_OMM, MEAN_MOTION: undefined }],
    ["a text mean motion", { ...ISS_OMM, MEAN_MOTION: "15.4" }],
    ["an infinite value", { ...ISS_OMM, BSTAR: Number.POSITIVE_INFINITY }],
    ["a not-a-number value", { ...ISS_OMM, INCLINATION: Number.NaN }],
    ["a zero mean motion", { ...ISS_OMM, MEAN_MOTION: 0 }],
    ["an eccentricity of one", { ...ISS_OMM, ECCENTRICITY: 1 }],
    ["a negative eccentricity", { ...ISS_OMM, ECCENTRICITY: -0.1 }],
    ["an empty epoch", { ...ISS_OMM, EPOCH: "" }],
    ["an unreadable epoch", { ...ISS_OMM, EPOCH: "yesterday" }],
    ["a missing catalogue number", { ...ISS_OMM, NORAD_CAT_ID: undefined }],
  ])("refuses %s", (_label, value) => {
    expect(parseOmm(value, null)).toBeNull();
  });
});

describe("epochMs", () => {
  test("reads an epoch with no zone as UTC", () => {
    expect(epochMs(ISS_EPOCH)).toBe(Date.parse("2026-10-26T12:34:56.123Z"));
  });

  test("leaves an epoch that already ends in Z alone", () => {
    expect(epochMs("2026-10-26T12:34:56Z")).toBe(
      Date.parse("2026-10-26T12:34:56Z"),
    );
  });
});
