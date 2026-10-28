import { describe, expect, test } from "vitest";
import type { EntityDetail } from "@/api/client";
import { ENTITY_VIEWS, entitySelectionFor } from "../registry";
import { GEO_OMM, ISS_EPOCH_MS, ISS_OMM } from "./fixtures";
import type { OrbitSample } from "./propagator";
import { ageText, satelliteSelection } from "./selection";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function detail(
  omm: unknown = ISS_OMM,
  names: string[] = ["ISS (ZARYA)"],
): EntityDetail {
  return {
    id: "a0000000-0000-4000-8000-000000000001",
    kind: "satellite",
    names,
    identifiers: { norad_id: 25544 },
    attrs: { omm: omm as never },
    first_seen: "2026-10-26T13:00:00Z",
    last_seen: "2026-10-26T13:00:00Z",
    retrieved_at: "2026-10-26T13:00:00Z",
    last_observation: null,
    source: {
      id: "celestrak",
      url: "https://example.test/celestrak",
      licence: "Free",
      reliability: "aggregated",
    },
    provenance: {
      source_id: "celestrak",
      source: "CelesTrak",
      licence: "Free",
      attribution: "CelesTrak",
      freshness: "daily",
      confidence: "derived",
      limitations: ["Computed, not observed.", "Elements age."],
    },
  };
}

const LIVE: OrbitSample = {
  id: "a0000000-0000-4000-8000-000000000001",
  atMs: ISS_EPOCH_MS,
  lon: -103.2,
  lat: 12.3,
  altKm: 417.03,
  speedKmS: 7.66,
};

const OPTIONS = { starred: false, canStar: true, orbit: LIVE };
const NOW = ISS_EPOCH_MS + 3 * HOUR;

const rows = (
  section: string,
  selection = satelliteSelection(detail(), NOW, OPTIONS),
) =>
  Object.fromEntries(
    (selection.sections.find((s) => s.label === section)?.rows ?? []).map(
      (r) => [r.key, r],
    ),
  );

describe("satelliteSelection follow", () => {
  test("offers follow once the orbit is known, and says when it is on", () => {
    const options = { ...OPTIONS, canFollow: true };
    const selection = satelliteSelection(detail(), NOW, options);
    expect(selection.actions).toEqual(["star", "follow", "center"]);
    expect(selection.following).toBe(false);
    expect(
      satelliteSelection(detail(), NOW, { ...options, following: true })
        .following,
    ).toBe(true);
  });

  test("offers no follow before the orbit arrives or when it is not allowed", () => {
    expect(
      satelliteSelection(detail(), NOW, {
        ...OPTIONS,
        canFollow: true,
        orbit: null,
      }).actions,
    ).toEqual(["star", "center"]);
    expect(satelliteSelection(detail(), NOW, OPTIONS).actions).toEqual([
      "star",
      "center",
    ]);
  });

  test("is drawn up to 300% zoom and no further", () => {
    const view = ENTITY_VIEWS.satellites;
    expect(view?.computed === true ? view.maxZoomPercent : null).toBe(300);
  });
});

describe("satelliteSelection", () => {
  test("names the satellite and says what kind of orbit it is in", () => {
    const selection = satelliteSelection(detail(), NOW, OPTIONS);
    expect(selection.kind).toBe("SATELLITE");
    expect(selection.name).toBe("ISS (ZARYA)");
    expect(selection.subline).toBe("Low Earth orbit");
    expect(satelliteSelection(detail(GEO_OMM), NOW, OPTIONS).subline).toBe(
      "Geostationary orbit",
    );
  });

  test("lists identity as reported", () => {
    const identity = rows("IDENTITY");
    expect(identity["NORAD ID"]).toEqual({
      key: "NORAD ID",
      value: "25544",
      confidence: "REP",
    });
    expect(identity.DESIGNATOR.value).toBe("1998-067A");
  });

  test("shows the live altitude, speed and sub-point", () => {
    const orbit = rows("ORBIT");
    expect(orbit.ALTITUDE.value).toBe("417 km");
    expect(orbit.SPEED.value).toBe("7.66 km/s");
    expect(orbit["SUB-POINT"].value).toBe("12.3°N 103.2°W");
  });

  test("shows the shape of the orbit from the elements", () => {
    const orbit = rows("ORBIT");
    expect(orbit.INCLINATION.value).toBe("51.64°");
    expect(orbit.PERIOD.value).toBe("92.9 min");
    expect(orbit.PERIGEE.value).toMatch(/^4\d\d km$/);
    expect(orbit.APOGEE.value).toMatch(/^4\d\d km$/);
    expect(orbit["ELEMENT AGE"].value).toBe("3 h 0 min");
  });

  test("marks every computed orbit value as derived", () => {
    const orbit = rows("ORBIT");
    for (const key of [
      "ALTITUDE",
      "SPEED",
      "SUB-POINT",
      "INCLINATION",
      "PERIOD",
      "PERIGEE",
      "APOGEE",
      "ELEMENT AGE",
    ]) {
      expect(orbit[key].confidence, key).toBe("DER");
    }
    expect(orbit["ELEMENT EPOCH"].confidence).toBe("REP");
  });

  test("says it is computing before the first live position arrives", () => {
    const orbit = rows(
      "ORBIT",
      satelliteSelection(detail(), NOW, { ...OPTIONS, orbit: null }),
    );
    expect(orbit.ALTITUDE.value).toBe("computing");
    expect(orbit.SPEED).toBeUndefined();
    expect(orbit.INCLINATION).toBeDefined();
  });

  test("still shows the identity when the elements cannot be read", () => {
    const selection = satelliteSelection(detail({ broken: true }), NOW, {
      ...OPTIONS,
      orbit: null,
    });
    expect(rows("IDENTITY", selection)["NORAD ID"].value).toBe("25544");
    expect(rows("ORBIT", selection).ELEMENTS.value).toBe("unreadable");
    expect(selection.subline).toBe("Satellite");
  });

  test("falls back to the catalogue number when the satellite has no name", () => {
    expect(satelliteSelection(detail(ISS_OMM, []), NOW, OPTIONS).name).toBe(
      "25544",
    );
  });

  test("offers star and centre, and follow only when allowed", () => {
    expect(satelliteSelection(detail(), NOW, OPTIONS).actions).toEqual([
      "star",
      "center",
    ]);
    expect(
      satelliteSelection(detail(), NOW, {
        ...OPTIONS,
        canStar: false,
        canFollow: true,
      }).actions,
    ).toEqual(["follow", "center"]);
  });

  test("carries the provenance and the limitations", () => {
    const selection = satelliteSelection(detail(), NOW, OPTIONS);
    expect(selection.provenance.source).toBe("CelesTrak");
    expect(selection.limitations).toEqual([
      "Computed, not observed.",
      "Elements age.",
    ]);
  });

  test("never uses the middle dot", () => {
    const text = JSON.stringify(satelliteSelection(detail(), NOW, OPTIONS));
    expect(text).not.toContain("·");
  });

  test("is the panel the registry uses for satellites", () => {
    expect(ENTITY_VIEWS.satellites.computed).toBe(true);
    expect(ENTITY_VIEWS.satellites.selection).toBe(satelliteSelection);
    expect(entitySelectionFor("satellites", detail(), NOW, OPTIONS).kind).toBe(
      "SATELLITE",
    );
  });
});

describe("ageText", () => {
  test.each([
    [0, "0 min"],
    [-5000, "0 min"],
    [59 * 60_000, "59 min"],
    [HOUR + 5 * 60_000, "1 h 5 min"],
    [47 * HOUR, "47 h 0 min"],
    [2 * DAY + 5 * HOUR, "2 d 5 h"],
  ])("writes %i ms as %s", (ms, text) => {
    expect(ageText(ms)).toBe(text);
  });
});
