import type { EntityRow } from "@/api/client";
import { parseInstant } from "@/state/entities";

export const HISTORY_SIZE = 5;

export type Fix = {
  t: number;
  lon: number;
  lat: number;
  sog: number | null;
  cog: number | null;
  track: number | null;
};

export function fixFromRow(row: EntityRow): Fix | null {
  const t = parseInstant(row.t);
  if (t === null) return null;
  return {
    t,
    lon: row.lon,
    lat: row.lat,
    sog: row.sog,
    cog: row.cog,
    track: row.heading ?? row.cog,
  };
}

function sameFix(a: Fix, b: Fix): boolean {
  return (
    a.t === b.t &&
    a.lon === b.lon &&
    a.lat === b.lat &&
    a.sog === b.sog &&
    a.cog === b.cog &&
    a.track === b.track
  );
}

export function pushFix(
  fixes: readonly Fix[],
  fix: Fix,
  size: number = HISTORY_SIZE,
): readonly Fix[] {
  const at = fixes.findIndex((known) => known.t >= fix.t);
  let next: Fix[];
  if (at !== -1 && fixes[at].t === fix.t) {
    if (sameFix(fixes[at], fix)) return fixes;
    next = fixes.slice();
    next[at] = fix;
  } else if (at === -1) {
    next = [...fixes, fix];
  } else {
    next = [...fixes.slice(0, at), fix, ...fixes.slice(at)];
  }
  if (next.length <= size) return next;
  const trimmed = next.slice(next.length - size);
  return trimmed.length === fixes.length &&
    trimmed.every((f, i) => f === fixes[i])
    ? fixes
    : trimmed;
}

export class MotionHistory {
  private readonly fixes = new Map<string, readonly Fix[]>();

  record(id: string, fix: Fix): void {
    const known = this.fixes.get(id) ?? [];
    const next = pushFix(known, fix);
    if (next !== known) this.fixes.set(id, next);
  }

  get(id: string): readonly Fix[] | undefined {
    return this.fixes.get(id);
  }

  forget(id: string): void {
    this.fixes.delete(id);
  }

  retain(ids: ReadonlySet<string>): void {
    for (const id of this.fixes.keys()) {
      if (!ids.has(id)) this.fixes.delete(id);
    }
  }

  get size(): number {
    return this.fixes.size;
  }

  clear(): void {
    this.fixes.clear();
  }
}
