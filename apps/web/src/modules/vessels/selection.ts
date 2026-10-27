import type { EntityDetail } from "@/api/client";
import { formatCentre } from "@/components/console/geo";
import { formatClock, relativeAge } from "@/components/console/time";
import type { Selection, SelectionRow } from "@/components/console/types";
import { CONFIDENCE_TAG } from "../confidence";
import { entityName, entityProvenance, type StarOptions } from "../entity";

const NAV_STATUS: Readonly<Record<number, string>> = {
  0: "Under way using engine",
  1: "At anchor",
  2: "Not under command",
  3: "Restricted manoeuvrability",
  4: "Constrained by draught",
  5: "Moored",
  6: "Aground",
  7: "Engaged in fishing",
  8: "Under way sailing",
  14: "AIS-SART active",
};

const SHIP_TYPE: Readonly<Record<string, string>> = {
  wing_in_ground: "Wing in ground craft",
  fishing: "Fishing vessel",
  tug: "Tug or towing",
  special: "Special craft",
  military: "Military",
  pleasure: "Pleasure craft",
  high_speed: "High speed craft",
  passenger: "Passenger ship",
  cargo: "Cargo ship",
  tanker: "Tanker",
  other: "Other",
};

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function navStatusLabel(code: unknown): string | null {
  const value = number(code);
  return value === null ? null : (NAV_STATUS[value] ?? null);
}

export function shipTypeLabel(type: unknown): string | null {
  const value = text(type);
  return value === null ? null : (SHIP_TYPE[value] ?? null);
}

export function sizeLabel(length: unknown, beam: unknown): string | null {
  const long = number(length);
  const wide = number(beam);
  if (long !== null && wide !== null) return `${long} by ${wide} m`;
  if (long !== null) return `${long} m long`;
  if (wide !== null) return `${wide} m wide`;
  return null;
}

export function draughtLabel(metres: unknown): string | null {
  const value = number(metres);
  return value === null ? null : `${value.toFixed(1)} m`;
}

export function vesselSelection(
  detail: EntityDetail,
  nowMs: number,
  options: StarOptions,
): Selection {
  const fix = detail.last_observation;
  const tag = fix ? CONFIDENCE_TAG[fix.confidence] : "OBS";
  const name = entityName(detail);
  const mmsi = text(detail.identifiers.mmsi);
  const imo = text(detail.identifiers.imo);
  const callsign = text(detail.identifiers.callsign);
  const flag = text(detail.attrs.flag);
  const type = shipTypeLabel(detail.attrs.ship_type);
  const size = sizeLabel(detail.attrs.length, detail.attrs.beam);

  const identity: SelectionRow[] = [];
  if (mmsi) identity.push({ key: "MMSI", value: mmsi, confidence: "REP" });
  if (imo) identity.push({ key: "IMO", value: imo, confidence: "REP" });
  if (callsign) {
    identity.push({ key: "CALLSIGN", value: callsign, confidence: "REP" });
  }
  if (flag) identity.push({ key: "FLAG", value: flag, confidence: "DER" });
  if (type) identity.push({ key: "TYPE", value: type, confidence: "REP" });
  if (size) identity.push({ key: "SIZE", value: size, confidence: "REP" });

  const lastSeen = new Date(fix?.t ?? detail.last_seen);
  const telemetry: SelectionRow[] = [];
  const status = navStatusLabel(detail.attrs.nav_status);
  if (status) {
    telemetry.push({ key: "STATUS", value: status, confidence: "REP" });
  }
  if (fix?.sog !== null && fix?.sog !== undefined) {
    telemetry.push({
      key: "SPEED",
      value: `${fix.sog.toFixed(1)} kn`,
      confidence: tag,
    });
  }
  if (fix?.cog !== null && fix?.cog !== undefined) {
    telemetry.push({
      key: "COURSE",
      value: `${Math.round(fix.cog)}°`,
      confidence: tag,
    });
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

  const declared: SelectionRow[] = [];
  const destination = text(detail.attrs.destination);
  const eta = text(detail.attrs.eta);
  const draught = draughtLabel(detail.attrs.draught);
  if (destination) {
    declared.push({
      key: "DESTINATION",
      value: destination,
      confidence: "REP",
    });
  }
  if (eta) declared.push({ key: "ETA", value: eta, confidence: "REP" });
  if (draught) {
    declared.push({ key: "DRAUGHT", value: draught, confidence: "REP" });
  }

  return {
    kind: "VESSEL",
    name,
    subline: type ?? "Vessel",
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
      ...(declared.length > 0 ? [{ label: "DECLARED", rows: declared }] : []),
    ],
    provenance: entityProvenance(detail, nowMs, options.stale),
    limitations: detail.provenance?.limitations ?? [],
  };
}
