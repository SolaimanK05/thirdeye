import type { HealthState, ModuleInfo } from "@/api/client";
import type { StreamStatus } from "@/api/stream";
import { formatClock, formatMinute } from "./time";
import type { Health, StatusLine } from "./types";

export const HEALTH_FROM_API: Record<HealthState, Health> = {
  fresh: "fresh",
  stale: "stale",
  cooldown: "cooldown",
  failed: "failed",
  empty: "empty",
  pending: "empty",
  missing_key: "missing-key",
};

export function attributionLine(modules: readonly ModuleInfo[]): string | null {
  const credits = [
    ...new Set(
      modules
        .filter((module) => module.enabled)
        .map((module) => module.provenance.attribution),
    ),
  ];
  return credits.length > 0 ? `Data: ${credits.join(", ")}` : null;
}

function cooldownText(module: ModuleInfo, lastGood: string | null): string {
  const { cooldown_until: until, record_count: loaded } = module.health;
  const wait = until ? ` until ${formatMinute(new Date(until))}` : "";
  const last = lastGood && loaded > 0 ? `, last good ${lastGood}` : "";
  return `${module.id} cooldown${wait}${last}`;
}

function statusText(module: ModuleInfo): string {
  const { state, fetched_at: fetchedAt } = module.health;
  const at = fetchedAt ? formatClock(new Date(fetchedAt)) : null;
  const name = module.id;
  switch (state) {
    case "pending":
      return `${name} waiting for first fetch`;
    case "failed":
      return `${name} failed ${at ?? ""}`.trim();
    case "stale":
      return `${name} stale, last ${at ?? "unknown"}`;
    case "cooldown":
      return cooldownText(module, at);
    case "empty":
      return `${name} empty ${at ?? ""}`.trim();
    case "fresh":
      return `${name} ${at ?? ""}`.trim();
    case "missing_key":
      return `${name} needs ${module.key_env ?? "an API key"}`;
  }
}

export function moduleStatusLines(
  modules: readonly ModuleInfo[] | undefined,
  apiDown: boolean,
  stream: StreamStatus = "live",
): StatusLine[] {
  if (apiDown) return [{ health: "failed", text: "API unreachable" }];
  if (!modules) return [{ health: "empty", text: "connecting to API" }];
  const enabled = modules.filter((module) => module.enabled);
  if (enabled.length === 0) {
    return [{ health: "empty", text: "no modules enabled" }];
  }
  const lines = enabled.map((module) => ({
    health: HEALTH_FROM_API[module.health.state],
    text: statusText(module),
  }));
  return stream === "reconnecting"
    ? [{ health: "stale", text: "live stream reconnecting" }, ...lines]
    : lines;
}
