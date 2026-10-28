import type { EntityDetail } from "@/api/client";
import { formatCentre } from "@/components/console/geo";
import { formatMinute, formatShortDate } from "@/components/console/time";
import type { Selection, SelectionRow } from "@/components/console/types";
import { entityName, entityProvenance, type StarOptions } from "../entity";
import { epochMs, parseOmm } from "./omm";
import { elementAgeMs, orbitClass, orbitShape } from "./orbit";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function ageText(ms: number): string {
  const age = Math.max(0, ms);
  if (age < HOUR_MS) return `${Math.floor(age / MINUTE_MS)} min`;
  if (age < 2 * DAY_MS) {
    const hours = Math.floor(age / HOUR_MS);
    const minutes = Math.floor((age % HOUR_MS) / MINUTE_MS);
    return `${hours} h ${minutes} min`;
  }
  const days = Math.floor(age / DAY_MS);
  const hours = Math.floor((age % DAY_MS) / HOUR_MS);
  return `${days} d ${hours} h`;
}

const kilometres = (value: number): string =>
  `${Math.round(value).toLocaleString("en-GB")} km`;

export function satelliteSelection(
  detail: EntityDetail,
  nowMs: number,
  options: StarOptions,
): Selection {
  const name = entityName(detail);
  const omm = parseOmm(detail.attrs.omm, null);
  const norad = detail.identifiers.norad_id;

  const identity: SelectionRow[] = [];
  if (norad !== undefined && norad !== null) {
    identity.push({ key: "NORAD ID", value: String(norad), confidence: "REP" });
  }
  const designator = omm?.OBJECT_ID;
  if (designator) {
    identity.push({
      key: "DESIGNATOR",
      value: designator,
      confidence: "REP",
    });
  }

  const orbit: SelectionRow[] = [];
  let subline = "Satellite";
  const live = options.orbit;
  if (live) {
    orbit.push(
      {
        key: "ALTITUDE",
        value: kilometres(live.altKm),
        confidence: "DER",
      },
      {
        key: "SPEED",
        value: `${live.speedKmS.toFixed(2)} km/s`,
        confidence: "DER",
      },
      {
        key: "SUB-POINT",
        value: formatCentre({ lat: live.lat, lon: live.lon }),
        confidence: "DER",
      },
    );
  } else {
    orbit.push({
      key: "ALTITUDE",
      value: "computing",
      confidence: "DER",
    });
  }
  if (omm) {
    const shape = orbitShape(omm);
    subline = orbitClass(shape);
    orbit.push(
      {
        key: "INCLINATION",
        value: `${shape.inclinationDeg.toFixed(2)}°`,
        confidence: "DER",
      },
      {
        key: "PERIOD",
        value: `${shape.periodMinutes.toFixed(1)} min`,
        confidence: "DER",
      },
      {
        key: "PERIGEE",
        value: kilometres(shape.perigeeKm),
        confidence: "DER",
      },
      {
        key: "APOGEE",
        value: kilometres(shape.apogeeKm),
        confidence: "DER",
      },
      {
        key: "ELEMENT AGE",
        value: ageText(elementAgeMs(omm, nowMs)),
        confidence: "DER",
      },
      {
        key: "ELEMENT EPOCH",
        value: `${formatShortDate(new Date(epochMs(omm.EPOCH)))} ${formatMinute(new Date(epochMs(omm.EPOCH)))}`,
        confidence: "REP",
      },
    );
  } else {
    orbit.push({
      key: "ELEMENTS",
      value: "unreadable",
      confidence: "DER",
    });
  }

  return {
    kind: "SATELLITE",
    name,
    subline,
    starred: options.starred,
    following: options.following ?? false,
    actions: [
      ...(options.canStar ? (["star"] as const) : []),
      ...(options.canFollow && live ? (["follow"] as const) : []),
      "center",
    ],
    sections: [
      ...(identity.length > 0 ? [{ label: "IDENTITY", rows: identity }] : []),
      { label: "ORBIT", rows: orbit },
    ],
    provenance: entityProvenance(detail, nowMs, options.stale),
    limitations: detail.provenance?.limitations ?? [],
  };
}
