import type { EntityDetail } from "@/api/client";
import { formatCentre } from "@/components/console/geo";
import type { Selection, SelectionRow } from "@/components/console/types";
import { CONFIDENCE_TAG } from "../confidence";
import { entityName, entityProvenance, type StarOptions } from "../entity";

const HARBOR_SIZE: Readonly<Record<string, string>> = {
  L: "Large",
  M: "Medium",
  S: "Small",
  V: "Very small",
};

const HARBOR_TYPE: Readonly<Record<string, string>> = {
  CN: "Coastal, natural",
  CB: "Coastal, breakwater",
  CT: "Coastal, tide gate",
  RN: "River, natural",
  RB: "River, basin",
  RT: "River, tide gate",
  LC: "Lake or canal",
  OR: "Open roadstead",
  TH: "Typhoon harbour",
};

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

export function harborSizeLabel(code: unknown): string | null {
  const value = text(code);
  return value === null ? null : (HARBOR_SIZE[value] ?? value);
}

export function harborTypeLabel(code: unknown): string | null {
  const value = text(code);
  return value === null ? null : (HARBOR_TYPE[value] ?? value);
}

function countryLine(detail: EntityDetail): string | null {
  const country = text(detail.attrs.country);
  const code = text(detail.attrs.country_code);
  if (country && code) return `${country} (${code})`;
  return country ?? code;
}

export function portSelection(
  detail: EntityDetail,
  nowMs: number,
  options: StarOptions,
): Selection {
  const fix = detail.last_observation;
  const tag = fix ? CONFIDENCE_TAG[fix.confidence] : "REP";
  const country = countryLine(detail);
  const region = text(detail.attrs.region);

  const where: SelectionRow[] = [
    {
      key: "POSITION",
      value: fix ? formatCentre(fix.position) : "no position",
      confidence: tag,
    },
  ];
  if (country)
    where.push({ key: "COUNTRY", value: country, confidence: "REP" });
  if (region) where.push({ key: "REGION", value: region, confidence: "REP" });

  const port: SelectionRow[] = [];
  const wpi = text(detail.identifiers.wpi);
  const unlocode = text(detail.identifiers.unlocode);
  const size = harborSizeLabel(detail.attrs.harbor_size);
  const type = harborTypeLabel(detail.attrs.harbor_type);
  if (wpi) port.push({ key: "WPI", value: wpi, confidence: "REP" });
  if (unlocode) {
    port.push({ key: "UN/LOCODE", value: unlocode, confidence: "REP" });
  }
  if (size) port.push({ key: "HARBOUR SIZE", value: size, confidence: "REP" });
  if (type) port.push({ key: "HARBOUR TYPE", value: type, confidence: "REP" });
  for (const alias of detail.names.slice(1)) {
    port.push({ key: "ALIAS", value: alias, confidence: "REP" });
  }

  return {
    kind: "FACILITY",
    name: entityName(detail),
    subline: country ?? "Port",
    starred: options.starred,
    actions: [...(options.canStar ? (["star"] as const) : []), "center"],
    sections: [
      { label: "POSITION", rows: where },
      ...(port.length > 0 ? [{ label: "PORT", rows: port }] : []),
    ],
    provenance: entityProvenance(detail, nowMs, options.stale),
    limitations: detail.provenance?.limitations ?? [],
  };
}
