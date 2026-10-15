import type { ModuleInfo } from "@/api/client";
import type { StarItem } from "@/api/watchlist";
import type { LayerCap } from "@/state/layer-caps";
import { HEALTH_FROM_API } from "./module-status";
import { formatClock, relativeAge } from "./time";
import type {
  DomainGroup,
  Filter,
  ModuleRow,
  StarredEntity,
  ZoomLevel,
} from "./types";

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
  capped: Readonly<Record<string, LayerCap>> = {},
  starred: Readonly<Record<string, number>> = {},
): ModuleRow {
  const { zoom_range: range, health } = module;
  return {
    id: module.id,
    name: module.name,
    health: HEALTH_FROM_API[health.state],
    zoomRange: range ? [toLevel(range.min, 1), toLevel(range.max, 4)] : null,
    filter: effectiveFilter(chosen, module),
    loaded: health.record_count,
    starredCount: starred[module.id] ?? 0,
    inView: inView[module.id],
    capped: capped[module.id],
    missingKey: module.key_env ?? undefined,
    failure: health.reason ?? undefined,
    lastGood: health.fetched_at
      ? formatClock(new Date(health.fetched_at))
      : undefined,
  };
}

export function countStarred(
  items: readonly { module_id: string }[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.module_id] = (counts[item.module_id] ?? 0) + 1;
  }
  return counts;
}

export function buildDomains(
  modules: readonly ModuleInfo[],
  chosen: Readonly<Record<string, Filter>>,
  inView: Readonly<Record<string, number>>,
  capped: Readonly<Record<string, LayerCap>> = {},
  starred: Readonly<Record<string, number>> = {},
): DomainGroup[] {
  const groups = new Map<Domain, ModuleRow[]>();
  for (const module of modules) {
    if (!module.enabled) continue;
    const rows = groups.get(module.domain) ?? [];
    rows.push(toRow(module, chosen, inView, capped, starred));
    groups.set(module.domain, rows);
  }
  return [...groups].map(([domain, rows]) => ({
    label: DOMAIN_LABEL[domain],
    modules: rows,
  }));
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export function starredTone(ageMs: number): StarredEntity["tone"] {
  if (ageMs >= DAY_MS) return "gap";
  if (ageMs >= HOUR_MS) return "stale";
  return "normal";
}

export function toStarred(
  items: readonly StarItem[],
  modules: readonly Pick<ModuleInfo, "id" | "name">[],
  nowMs: number,
): StarredEntity[] {
  const names = new Map(modules.map((module) => [module.id, module.name]));
  return items.map((item) => {
    const seen = item.last_seen === null ? null : new Date(item.last_seen);
    return {
      id: item.entity_id,
      name: item.name,
      moduleId: item.module_id,
      module: names.get(item.module_id) ?? item.module_id,
      position: item.position,
      age: seen === null ? "no data" : relativeAge(seen, nowMs),
      tone:
        seen === null
          ? "normal"
          : starredTone(Math.max(0, nowMs - seen.getTime())),
    };
  });
}
