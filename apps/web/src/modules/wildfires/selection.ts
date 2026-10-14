import type { EventDetail } from "@/api/client";
import { formatCount } from "@/components/console/count";
import { formatCentre } from "@/components/console/geo";
import type { ClusterInfo } from "@/components/console/markers";
import {
  formatClock,
  formatShortDate,
  relativeAge,
} from "@/components/console/time";
import type { Selection, SelectionRow } from "@/components/console/types";
import { CONFIDENCE_TAG } from "../confidence";
import { powerLabel } from "./render";

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const PASS: Record<string, string> = { D: "day pass", N: "night pass" };

export function fireSelection(
  detail: EventDetail,
  nowMs: number,
  cluster?: ClusterInfo,
): Selection {
  const tag = CONFIDENCE_TAG[detail.confidence];
  const detected = new Date(detail.t_start);
  const retrieved = new Date(detail.retrieved_at);
  const certainty = text(detail.attrs.detection_confidence);
  const brightness = number(detail.attrs.brightness_ti4_k);
  const instrument = text(detail.attrs.instrument);
  const satellite = text(detail.attrs.satellite);
  const pass = text(detail.attrs.day_night);
  const scan = number(detail.attrs.scan_km);
  const track = number(detail.attrs.track_km);

  const rows: SelectionRow[] = [
    {
      key: "DETECTED",
      value: `${formatClock(detected)} ${formatShortDate(detected)}`,
      confidence: tag,
    },
    {
      key: "POSITION",
      value: formatCentre(detail.position),
      confidence: tag,
    },
    {
      key: "POWER",
      value:
        detail.severity === null ? "not reported" : powerLabel(detail.severity),
      confidence: tag,
    },
    {
      key: "HEAT",
      value:
        brightness === null ? "not reported" : `${brightness.toFixed(1)} K`,
      confidence: tag,
    },
    {
      key: "CERTAINTY",
      value: certainty ?? "not reported",
      confidence: "REP",
    },
  ];
  if (scan !== null && track !== null) {
    rows.push({
      key: "PIXEL",
      value: `${Math.round(scan * 1000)} x ${Math.round(track * 1000)} m`,
      confidence: "DER",
    });
  }

  const sensor = [satellite, instrument].filter(Boolean).join(" ");
  const sections: Selection["sections"] = cluster
    ? [
        {
          label: "CLUSTER",
          rows: [
            {
              key: "DETECTIONS",
              value: formatCount(cluster.count),
              confidence: "DER",
            },
            {
              key: "COMBINED",
              value: powerLabel(cluster.megawatts),
              confidence: "DER",
            },
          ],
        },
        { label: "STRONGEST DETECTION", rows },
      ]
    : [{ label: "DETAILS", rows }];
  return {
    kind: "EVENT",
    name: cluster ? "Thermal anomaly cluster" : "Thermal anomaly",
    subline: [
      sensor === "" ? "VIIRS" : sensor,
      pass ? (PASS[pass] ?? pass) : null,
    ]
      .filter(Boolean)
      .join(", "),
    starred: false,
    actions: ["center"],
    sections,
    provenance: {
      source: detail.provenance?.source ?? detail.source.id,
      retrieved: `${formatClock(retrieved)}, ${relativeAge(retrieved, nowMs)}`,
      reliability: detail.source.reliability,
      licence: detail.provenance?.licence ?? detail.source.licence,
    },
    limitations: detail.provenance?.limitations ?? [],
  };
}
