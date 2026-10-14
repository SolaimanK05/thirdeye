import type { ModuleInfo } from "@/api/client";
import { HEALTH_FROM_API } from "./module-status";
import { formatClock } from "./time";
import type { DomainGroup, Filter, ModuleRow, ZoomLevel } from "./types";

type Domain = ModuleInfo["domain"];

export const DOMAIN_LABEL: Record<Domain, string> = {
  earth: "EARTH",
  movers: "MOVERS",
  street: "STREET",
  geopolitics: "GEOPOLITICS",
  infrastructure: "INFRASTRUCTURE",
};

const LEVELS: readonly ZoomLevel[] = [1, 2, 3, 4];

function toLevel(value: number, fallback: ZoomLevel): ZoomLevel {
  return LEVELS.find((level) => level === value) ?? fallback;
}

export function effectiveFilter(
  chosen: Readonly<Record<string, Filter>>,
  module: Pick<ModuleInfo, "id" | "default_filter">,
): Filter {
  return chosen[module.id] ?? module.default_filter;
}

export function toRow(
  module: ModuleInfo,
  chosen: Readonly<Record<string, Filter>>,
  inView: Readonly<Record<string, number>>,
): ModuleRow {
  const { zoom_range: range, health } = module;
  return {
    id: module.id,
    name: module.name,
    health: HEALTH_FROM_API[health.state],
    zoomRange: range ? [toLevel(range.min, 1), toLevel(range.max, 4)] : null,
    filter: effectiveFilter(chosen, module),
    loaded: health.record_count,
    starredCount: 0,
    inView: inView[module.id],
    missingKey: module.key_env ?? undefined,
    failure: health.reason ?? undefined,
    lastGood: health.fetched_at
      ? formatClock(new Date(health.fetched_at))
      : undefined,
  };
}

export function buildDomains(
  modules: readonly ModuleInfo[],
  chosen: Readonly<Record<string, Filter>>,
  inView: Readonly<Record<string, number>>,
): DomainGroup[] {
  const groups = new Map<Domain, ModuleRow[]>();
  for (const module of modules) {
    if (!module.enabled) continue;
    const rows = groups.get(module.domain) ?? [];
    rows.push(toRow(module, chosen, inView));
    groups.set(module.domain, rows);
  }
  return [...groups].map(([domain, rows]) => ({
    label: DOMAIN_LABEL[domain],
    modules: rows,
  }));
}
