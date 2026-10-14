import type { EventDetail } from "@/api/client";
import { formatCentre } from "@/components/console/geo";
import {
  formatClock,
  formatShortDate,
  relativeAge,
} from "@/components/console/time";
import type { Selection, SelectionRow } from "@/components/console/types";
import { CONFIDENCE_TAG } from "../confidence";
import { magnitudeLabel } from "./render";

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const REVIEW: Record<string, string> = {
  automatic: "automatic review",
  reviewed: "reviewed",
  deleted: "deleted by USGS",
};

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function quakeSelection(detail: EventDetail, nowMs: number): Selection {
  const tag = CONFIDENCE_TAG[detail.confidence];
  const place = text(detail.attrs.place);
  const magType = text(detail.attrs.mag_type);
  const depth = number(detail.attrs.depth_km);
  const status = text(detail.attrs.status);
  const felt = number(detail.attrs.felt);
  const origin = new Date(detail.t_start);
  const retrieved = new Date(detail.retrieved_at);

  const rows: SelectionRow[] = [
    {
      key: "MAGNITUDE",
      value:
        detail.severity === null
          ? "not reported"
          : [detail.severity.toFixed(1), magType].filter(Boolean).join(" "),
      confidence: tag,
    },
    {
      key: "DEPTH",
      value: depth === null ? "not reported" : `${depth.toFixed(1)} km`,
      confidence: tag,
    },
    {
      key: "ORIGIN",
      value: `${formatClock(origin)} ${formatShortDate(origin)}`,
      confidence: tag,
    },
    {
      key: "POSITION",
      value: formatCentre(detail.position),
      confidence: tag,
    },
  ];
  if (place) rows.push({ key: "REGION", value: place, confidence: "DER" });
  if (detail.attrs.tsunami === true) {
    rows.push({ key: "TSUNAMI", value: "flagged by USGS", confidence: "REP" });
  }
  if (felt !== null && felt > 0) {
    rows.push({
      key: "FELT",
      value: felt === 1 ? "1 report" : `${felt} reports`,
      confidence: "REP",
    });
  }

  const name = [magnitudeLabel(detail.severity), place ?? "Earthquake"].join(
    " ",
  );
  const review = status ? (REVIEW[status] ?? status) : null;

  return {
    kind: "EVENT",
    name,
    subline: [capitalise(detail.category), review].filter(Boolean).join(", "),
    starred: false,
    actions: ["center"],
    sections: [{ label: "DETAILS", rows }],
    provenance: {
      source: detail.provenance?.source ?? detail.source.id,
      retrieved: `${formatClock(retrieved)}, ${relativeAge(retrieved, nowMs)}`,
      reliability: detail.source.reliability,
      licence: detail.provenance?.licence ?? detail.source.licence,
    },
    limitations: detail.provenance?.limitations ?? [],
  };
}
