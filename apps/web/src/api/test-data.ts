import type { ModuleInfo } from "./client";

export function moduleInfo(
  id: string,
  attribution: string,
  overrides: Partial<ModuleInfo> = {},
  health: Partial<ModuleInfo["health"]> = {},
): ModuleInfo {
  return {
    id,
    name: id,
    domain: "earth",
    enabled: true,
    cadence_seconds: 60,
    zoom_range: { min: 1, max: 4 },
    requires_key: false,
    key_env: null,
    default_filter: "all",
    provenance: {
      source_id: id,
      source: id,
      licence: "open",
      attribution,
      freshness: "1 min",
      confidence: "observed",
      limitations: ["a", "b"],
    },
    health: {
      state: "fresh",
      fetched_at: "2026-10-14T05:59:12Z",
      record_count: 10,
      reason: null,
      stale_after_seconds: 180,
      ...health,
    },
    ...overrides,
  };
}
