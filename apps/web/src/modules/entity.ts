import type { EntityDetail } from "@/api/client";
import { formatCentre } from "@/components/console/geo";
import { formatClock, relativeAge } from "@/components/console/time";
import type {
  Selection,
  SelectionAction,
  SelectionRow,
} from "@/components/console/types";
import { CONFIDENCE_TAG } from "./confidence";

const IDENTIFIER_LABEL: Record<string, string> = {
  mmsi: "MMSI",
  imo: "IMO",
  icao24: "ICAO24",
  callsign: "CALLSIGN",
  norad: "NORAD",
};

export function identifierLabel(key: string): string {
  return IDENTIFIER_LABEL[key] ?? key.replaceAll("_", " ").toUpperCase();
}

function identifierValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() === "" ? null : value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

export function entityName(detail: EntityDetail): string {
  const [name] = detail.names;
  if (name) return name;
  for (const value of Object.values(detail.identifiers)) {
    const text = identifierValue(value);
    if (text !== null) return text;
  }
  return detail.id;
}

export function entityProvenance(
  detail: EntityDetail,
  nowMs: number,
  stale = false,
): Selection["provenance"] {
  const retrieved = new Date(detail.retrieved_at);
  const age = `${formatClock(retrieved)}, ${relativeAge(retrieved, nowMs)}`;
  return {
    source: detail.provenance?.source ?? detail.source.id,
    retrieved: stale ? `${age}, STALE` : age,
    reliability: detail.source.reliability,
    licence: detail.provenance?.licence ?? detail.source.licence,
  };
}

export type StarOptions = {
  starred: boolean;
  canStar: boolean;
  canFollow?: boolean;
  following?: boolean;
  stale?: boolean;
};

export function entitySelection(
  detail: EntityDetail,
  nowMs: number,
  options: StarOptions,
): Selection {
  const lastSeen = new Date(detail.last_seen);
  const fix = detail.last_observation;
  const name = entityName(detail);

  const identity: SelectionRow[] = [];
  for (const alias of detail.names.slice(1)) {
    identity.push({ key: "ALIAS", value: alias, confidence: "REP" });
  }
  for (const [key, value] of Object.entries(detail.identifiers)) {
    const text = identifierValue(value);
    if (text !== null) {
      identity.push({
        key: identifierLabel(key),
        value: text,
        confidence: "REP",
      });
    }
  }

  const track: SelectionRow[] = [
    {
      key: "LAST SEEN",
      value: `${formatClock(lastSeen)}, ${relativeAge(lastSeen, nowMs)}`,
      confidence: "OBS",
    },
  ];
  if (fix) {
    const tag = CONFIDENCE_TAG[fix.confidence];
    track.push({
      key: "POSITION",
      value: formatCentre(fix.position),
      confidence: tag,
    });
    if (fix.cog !== null) {
      track.push({
        key: "COURSE",
        value: `${Math.round(fix.cog)}°`,
        confidence: tag,
      });
    }
  } else {
    track.push({ key: "POSITION", value: "no fix yet", confidence: "OBS" });
  }

  const actions: SelectionAction[] = [];
  if (options.canStar) actions.push("star");
  if (fix) actions.push("center");

  return {
    kind: detail.kind.toUpperCase(),
    name,
    subline: detail.source.id,
    starred: options.starred,
    actions,
    sections: [
      ...(identity.length > 0
        ? [{ label: "IDENTITY", rows: identity as readonly SelectionRow[] }]
        : []),
      { label: "TRACK", rows: track },
    ],
    provenance: entityProvenance(detail, nowMs, options.stale),
    limitations: detail.provenance?.limitations ?? [],
  };
}
