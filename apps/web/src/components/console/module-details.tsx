"use client";

import { useId, useState } from "react";
import { describeFilters } from "@/modules/refine";
import { useRefineValues } from "@/modules/use-refine";
import { useDrawLimit } from "@/state/draw-limits";
import { useRefineStats } from "@/state/refine-stats";
import { formatCount } from "./count";
import { cx } from "./cx";
import {
  DrawLimitFields,
  drawSummary,
  drawsAnything,
} from "./draw-limit-panel";
import { RefineFields } from "./refine-panel";
import type { ModuleRow } from "./types";

/** The filter summary line of a module, and the refine and draw-limit controls behind its Edit button. */
export function ModuleDetails({ row }: { row: ModuleRow }) {
  const { controls, values } = useRefineValues(row.id);
  const { limit, chosen } = useDrawLimit(row.id);
  const stat = useRefineStats((state) => state.stats[row.id]);
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const draws = drawsAnything(row.id);
  if (row.health === "missing-key" || (controls.length === 0 && !draws)) {
    return null;
  }

  const fromRenderer = !chosen && limit !== null;
  const parts = [
    ...(controls.length > 0 ? [describeFilters(controls, values)] : []),
    ...(draws ? [drawSummary(limit, fromRenderer)] : []),
  ];

  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-7 w-full items-baseline justify-between gap-3 text-left text-ink-3 text-secondary transition-colors duration-120 ease-out hover-fine:text-ink-2 max-lg:min-h-11 max-lg:items-center"
      >
        <span className="min-w-0 truncate">{parts.join(", ")}</span>
        <span className={cx("shrink-0", open ? "text-accent" : "text-ink-2")}>
          {open ? "Done" : "Edit"}
          <span className="sr-only"> {row.name} filters</span>
        </span>
      </button>
      {open ? (
        <div
          id={bodyId}
          className="mt-1 flex flex-col gap-4 border-line-2 border-l pt-1 pb-1 pl-3"
        >
          {stat ? (
            <p className="text-ink-3 text-secondary tabular-nums">
              {formatCount(stat.kept)} of {formatCount(stat.total)} kept,{" "}
              {formatCount(stat.drawn)} drawn
            </p>
          ) : null}
          <RefineFields row={row} />
          <DrawLimitFields row={row} />
        </div>
      ) : null}
    </div>
  );
}
