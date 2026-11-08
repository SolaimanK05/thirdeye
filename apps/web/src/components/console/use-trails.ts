"use client";

import { useMemo } from "react";
import { useTrailFixes } from "@/api/queries";
import { type TrailFix, toTrail } from "@/motion/trail";
import { useStarred } from "@/state/starred";

export type MoverTrail = {
  id: string;
  moduleId: string;
  name: string;
  trail: readonly TrailFix[];
};

/** 24 h trails of the starred movers (aircraft, vessels) that have any fixes. */
export function useTrails(movers: ReadonlySet<string>): readonly MoverTrail[] {
  const { items } = useStarred();
  const starred = useMemo(
    () => items.filter((item) => movers.has(item.module_id)),
    [items, movers],
  );
  const fixes = useTrailFixes(starred.map((item) => item.entity_id));
  return useMemo(
    () =>
      starred.flatMap((item, index) => {
        const history = fixes[index];
        const trail = history ? toTrail(history.fixes) : [];
        return trail.length > 1
          ? [
              {
                id: item.entity_id,
                moduleId: item.module_id,
                name: item.name,
                trail,
              },
            ]
          : [];
      }),
    [starred, fixes],
  );
}
