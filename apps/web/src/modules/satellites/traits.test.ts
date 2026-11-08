import { describe, expect, test } from "vitest";
import type { SatelliteElement } from "@/api/client";
import { defaultValues, isDefault, passes } from "../refine";
import { GEO_OMM, ISS_OMM } from "./fixtures";
import {
  familyOf,
  launchYearOf,
  orbitOf,
  ownerLabel,
  pickOptionsOf,
  satelliteRefine,
  traitsOf,
} from "./traits";

function element(
  omm: Record<string, unknown>,
  satcat: Record<string, unknown> | null = null,
  name: string | null = String(omm.OBJECT_NAME),
): SatelliteElement {
  return {
    id: String(omm.NORAD_CAT_ID),
    norad_id: Number(omm.NORAD_CAT_ID),
    name,
    omm: omm as SatelliteElement["omm"],
    satcat: satcat as SatelliteElement["satcat"],
  };
}

function rowOf(...args: Parameters<typeof element>) {
  const row = traitsOf(element(...args));
  if (row === null) throw new Error("no traits");
  return row;
}

const allControls = defaultValues(satelliteRefine.controls);
const keep = (row: ReturnType<typeof rowOf>, values = allControls) =>
  passes(satelliteRefine, values, row, 0);

describe("orbit classes", () => {
  test("the space station is low, a weather satellite is geostationary", () => {
    expect(orbitOf(15.4991, 0.0006).orbit).toBe("LEO");
    expect(orbitOf(1.0027, 0.0001).orbit).toBe("GEO");
    expect(orbitOf(1.0027, 0.0001).altitudeKm).toBeGreaterThan(35_000);
  });

  test("a navigation satellite is medium, a Molniya orbit is highly elliptical", () => {
    expect(orbitOf(2.0057, 0.01).orbit).toBe("MEO");
    expect(orbitOf(2.0057, 0.7).orbit).toBe("HEO");
  });

  test("a graveyard orbit is beyond geostationary", () => {
    expect(orbitOf(0.9, 0.001).orbit).toBe("BEYOND");
  });

  test("an elliptical orbit that stays low is still low", () => {
    expect(orbitOf(14.5, 0.05).orbit).toBe("LEO");
  });
});

describe("name families", () => {
  test.each([
    ["STARLINK-1007", "STARLINK"],
    ["ONEWEB-0012", "ONEWEB"],
    ["IRIDIUM 106", "IRIDIUM"],
    ["NAVSTAR 81 (USA 319)", "NAVSTAR"],
    ["GSAT0223 (GALILEO 27)", "GSAT"],
    ["BEIDOU-3 M1", "BEIDOU"],
    ["FLOCK 4P 1", "FLOCK"],
    ["LEMUR-2-ALPHA", "LEMUR"],
    ["ISS (ZARYA)", "ISS"],
    ["tianhe", "TIANHE"],
    ["2020-ODD", "2020-ODD"],
    ["", "UNNAMED"],
  ])("%s is %s", (name, family) => {
    expect(familyOf(name)).toBe(family);
  });
});

describe("the pick lists", () => {
  const rows = [
    rowOf(ISS_OMM, { OWNER: "ISS" }),
    rowOf(
      { ...ISS_OMM, NORAD_CAT_ID: 2, OBJECT_NAME: "STARLINK-1" },
      { OWNER: "US" },
    ),
    rowOf(
      { ...ISS_OMM, NORAD_CAT_ID: 3, OBJECT_NAME: "STARLINK-2" },
      { OWNER: "US" },
    ),
    rowOf(
      { ...ISS_OMM, NORAD_CAT_ID: 4, OBJECT_NAME: "ODDSAT 4" },
      { OWNER: "ZZZ" },
    ),
    rowOf({ ...ISS_OMM, NORAD_CAT_ID: 5, OBJECT_NAME: "NOCAT 5" }),
  ];
  const lists = pickOptionsOf(rows);

  test("offer every family and owner there is, so nothing hides under other", () => {
    expect(lists.families.map((o) => o.value)).toEqual([
      "STARLINK",
      "ISS",
      "NOCAT",
      "ODDSAT",
    ]);
    expect(lists.owners.map((o) => o.value)).toEqual(["US", "ISS", "ZZZ"]);
    for (const list of Object.values(lists)) {
      expect(list.map((o) => o.value)).not.toContain("OTHER");
    }
  });

  test("count them, most numerous first", () => {
    expect(lists.families[0]).toEqual({
      value: "STARLINK",
      label: "STARLINK",
      count: 2,
    });
  });

  test("name an owner in full when the code is known, and by its code when not", () => {
    expect(ownerLabel("PRC")).toBe("China (PRC)");
    expect(ownerLabel("ZZZ")).toBe("ZZZ");
  });

  test("picking several keeps all of them and nothing else", () => {
    const values = { ...allControls, families: ["ISS", "ODDSAT"] };
    expect(rows.filter((r) => keep(r, values)).map((r) => r.family)).toEqual([
      "ISS",
      "ODDSAT",
    ]);
  });

  test("picking nothing means no limit, even for a satellite the catalogue lacks", () => {
    expect(rows.every((r) => keep(r))).toBe(true);
  });

  test("an owner pick leaves out satellites with no catalogue entry", () => {
    const values = { ...allControls, owners: ["US", "ZZZ"] };
    expect(rows.filter((r) => keep(r, values)).map((r) => r.owner)).toEqual([
      "US",
      "US",
      "ZZZ",
    ]);
  });
});

test("the launch year is read from the international designator", () => {
  expect(launchYearOf("1998-067A")).toBe(1998);
  expect(launchYearOf("")).toBeNull();
  expect(launchYearOf(undefined)).toBeNull();
});

describe("reading an element set", () => {
  test("combines the orbit with what the catalogue says", () => {
    const row = rowOf(ISS_OMM, {
      OWNER: "US",
      OPS_STATUS_CODE: "+",
    });
    expect(row).toMatchObject({
      orbit: "LEO",
      family: "ISS",
      owner: "US",
      status: "OPERATIONAL",
      launchYear: 1998,
    });
    expect(row.altitudeKm).toBeGreaterThan(300);
    expect(row.altitudeKm).toBeLessThan(500);
  });

  test("the owner is the catalogue's own code, and a missing catalogue is unknown", () => {
    expect(rowOf(ISS_OMM, { OWNER: "ISS" }).owner).toBe("ISS");
    const none = rowOf(ISS_OMM);
    expect(none.owner).toBeNull();
    expect(none.status).toBeNull();
  });

  test("status codes group into plain words", () => {
    const status = (code: string) =>
      rowOf(ISS_OMM, { OPS_STATUS_CODE: code }).status;
    expect(status("P")).toBe("PARTIAL");
    expect(status("S")).toBe("STANDBY");
    expect(status("B")).toBe("STANDBY");
    expect(status("-")).toBe("INACTIVE");
    expect(status("Z")).toBe("UNKNOWN");
  });

  test("an element set with no usable motion has no traits", () => {
    expect(traitsOf(element({ ...ISS_OMM, MEAN_MOTION: 0 }))).toBeNull();
  });
});

describe("the satellite filters", () => {
  const iss = rowOf(ISS_OMM, { OWNER: "ISS", OPS_STATUS_CODE: "+" });
  const goes = rowOf(GEO_OMM, { OWNER: "US", OPS_STATUS_CODE: "+" });
  const unknown = rowOf({ ...ISS_OMM, NORAD_CAT_ID: 9, OBJECT_ID: "" });

  test("start with everything on, so every satellite shows", () => {
    expect(isDefault(satelliteRefine.controls, allControls)).toBe(true);
    for (const row of [iss, goes, unknown]) expect(keep(row)).toBe(true);
  });

  test("an orbit choice keeps only that orbit", () => {
    const values = { ...allControls, orbit: ["GEO"] };
    expect(keep(goes, values)).toBe(true);
    expect(keep(iss, values)).toBe(false);
  });

  test("a satellite with no catalogue entry hides as soon as owner or status narrows", () => {
    const owners = { ...allControls, owners: ["US", "ISS"] };
    expect(keep(unknown, owners)).toBe(false);
    expect(keep(iss, owners)).toBe(true);
    const status = { ...allControls, status: ["OPERATIONAL"] };
    expect(keep(unknown, status)).toBe(false);
  });

  test("altitude, inclination and launch year are ranges with open ends", () => {
    const high = { ...allControls, altitude: [20_000, 40_000] as const };
    expect(keep(goes, high)).toBe(true);
    expect(keep(iss, high)).toBe(false);
    const polar = { ...allControls, inclination: [80, 180] as const };
    expect(keep(iss, polar)).toBe(false);
    const recent = { ...allControls, launched: [2010, 2026] as const };
    expect(keep(goes, recent)).toBe(true);
    expect(keep(iss, recent)).toBe(false);
    expect(keep(unknown, recent)).toBe(false);
  });
});
