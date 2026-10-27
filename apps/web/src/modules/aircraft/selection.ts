import type { EntityDetail } from "@/api/client";
import { formatCentre } from "@/components/console/geo";
import { formatClock, relativeAge } from "@/components/console/time";
import type { Selection, SelectionRow } from "@/components/console/types";
import { CONFIDENCE_TAG } from "../confidence";
import { entityName, entityProvenance, type StarOptions } from "../entity";

const METRES_PER_FOOT = 0.3048;

const CATEGORY: Readonly<Record<number, string>> = {
  0: "No information",
  1: "No ADS-B category",
  2: "Light",
  3: "Small",
  4: "Large",
  5: "High vortex large",
  6: "Heavy",
  7: "High performance",
  8: "Rotorcraft",
  9: "Glider",
  10: "Lighter than air",
  11: "Parachutist",
  12: "Ultralight",
  14: "Unmanned",
  15: "Space vehicle",
  16: "Emergency vehicle",
  17: "Service vehicle",
  18: "Point obstacle",
  19: "Cluster obstacle",
  20: "Line obstacle",
};

const SQUAWK_MEANING: Readonly<Record<string, string>> = {
  "7500": "unlawful interference",
  "7600": "radio failure",
  "7700": "general emergency",
};

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function categoryLabel(code: unknown): string | null {
  const value = number(code);
  return value === null ? null : (CATEGORY[value] ?? `Category ${value}`);
}

export function squawkLabel(code: unknown): string | null {
  const value = text(code);
  if (value === null) return null;
  const meaning = SQUAWK_MEANING[value];
  return meaning ? `${value}, ${meaning}` : value;
}

export function altitudeLabel(metres: number | null): string | null {
  if (metres === null) return null;
  const feet = Math.round(metres / METRES_PER_FOOT);
  return `${Math.round(metres).toLocaleString("en-US")} m, ${feet.toLocaleString("en-US")} ft`;
}

export function verticalRateLabel(
  metresPerSecond: number | null,
): string | null {
  if (metresPerSecond === null) return null;
  const sign = metresPerSecond > 0 ? "+" : "";
  return `${sign}${metresPerSecond.toFixed(1)} m/s`;
}

export function aircraftSelection(
  detail: EntityDetail,
  nowMs: number,
  options: StarOptions,
): Selection {
  const fix = detail.last_observation;
  const tag = fix ? CONFIDENCE_TAG[fix.confidence] : "OBS";
  const name = entityName(detail);
  const callsign = text(detail.identifiers.callsign);
  const icao24 = text(detail.identifiers.icao24);
  const state = text(detail.attrs.origin_country);
  const category = categoryLabel(detail.attrs.category);
  const squawk = squawkLabel(detail.attrs.squawk);
  const onGround = detail.attrs.on_ground === true;

  const identity: SelectionRow[] = [];
  if (callsign) {
    identity.push({ key: "CALLSIGN", value: callsign, confidence: "REP" });
  }
  if (icao24) {
    identity.push({
      key: "ICAO24",
      value: icao24.toUpperCase(),
      confidence: "REP",
    });
  }
  if (category) {
    identity.push({ key: "CATEGORY", value: category, confidence: "REP" });
  }
  if (squawk)
    identity.push({ key: "SQUAWK", value: squawk, confidence: "REP" });
  if (state) {
    identity.push({ key: "ICAO STATE", value: state, confidence: "DER" });
  }

  const lastSeen = new Date(fix?.t ?? detail.last_seen);
  const telemetry: SelectionRow[] = [
    {
      key: "STATUS",
      value: onGround ? "On the ground" : "Airborne",
      confidence: "OBS",
    },
  ];
  const altitude = altitudeLabel(fix?.alt ?? null);
  if (altitude && !onGround) {
    telemetry.push({ key: "ALTITUDE", value: altitude, confidence: tag });
  }
  if (fix?.sog !== null && fix?.sog !== undefined) {
    telemetry.push({
      key: "GROUND SPEED",
      value: `${Math.round(fix.sog)} kn`,
      confidence: tag,
    });
  }
  if (fix?.cog !== null && fix?.cog !== undefined) {
    telemetry.push({
      key: "TRACK",
      value: `${Math.round(fix.cog)}°`,
      confidence: tag,
    });
  }
  const climb = verticalRateLabel(number(detail.attrs.vertical_rate));
  if (climb && !onGround) {
    telemetry.push({ key: "VERTICAL SPEED", value: climb, confidence: tag });
  }
  telemetry.push({
    key: "POSITION",
    value: fix ? formatCentre(fix.position) : "no fix yet",
    confidence: tag,
  });
  telemetry.push({
    key: "LAST FIX",
    value: `${formatClock(lastSeen)}, ${relativeAge(lastSeen, nowMs)}`,
    confidence: tag,
  });

  return {
    kind: "AIRCRAFT",
    name,
    subline: category ?? "Aircraft",
    starred: options.starred,
    following: options.following ?? false,
    actions: [
      ...(options.canStar ? (["star"] as const) : []),
      ...(options.canFollow && fix ? (["follow"] as const) : []),
      "center",
    ],
    sections: [
      ...(identity.length > 0 ? [{ label: "IDENTITY", rows: identity }] : []),
      { label: "TELEMETRY", rows: telemetry },
    ],
    provenance: entityProvenance(detail, nowMs, options.stale),
    limitations: detail.provenance?.limitations ?? [],
  };
}
