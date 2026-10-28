import type { ModuleInfo } from "@/api/client";

type Mover = readonly [string, number];

export function moversKey(modules: readonly ModuleInfo[] | undefined): string {
  const movers: Mover[] = (modules ?? []).flatMap((module) =>
    module.enabled && module.render_delay_seconds != null
      ? [[module.id, module.render_delay_seconds] as const]
      : [],
  );
  return JSON.stringify(movers);
}

export function moversFromKey(key: string): ReadonlyMap<string, number> {
  return new Map(JSON.parse(key) as Mover[]);
}
