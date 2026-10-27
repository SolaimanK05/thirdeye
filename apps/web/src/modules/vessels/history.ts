import type { FixOut } from "@/api/client";
import type { SelectionChart } from "@/components/console/types";

export const MIN_HISTORY_FIXES = 2;

export function speedHistory(
  fixes: readonly FixOut[],
): SelectionChart | undefined {
  const points = fixes.flatMap((fix) => {
    const t = Date.parse(fix.t);
    return fix.sog === null || !Number.isFinite(t) ? [] : [{ t, v: fix.sog }];
  });
  if (points.length < MIN_HISTORY_FIXES) return undefined;
  points.sort((a, b) => a.t - b.t);
  return { label: "SPEED", unit: "kn", points };
}
