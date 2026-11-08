"use client";

import { useModules } from "@/api/queries";
import { ZOOM_CAPS } from "@/modules/registry";
import { useFilters } from "@/state/filters";
import { useHere } from "@/state/here";
import { usePins } from "@/state/pins";
import { useConsole } from "./console-shell";
import { inZoomRange } from "./draw-rules";
import { effectiveFilter, zoomRangeOf } from "./rail";
import { satellitesNotice } from "./satellites-notice";

const SATELLITES = "satellites";

/** Top centre of the globe: why the satellites are not drawn, and a way to see them here. */
export function SatellitesNotice() {
  const { data: modules } = useModules();
  const { level, over } = useConsole();
  const chosen = useFilters((state) => state.filters);
  const pinned = usePins((state) => state.pins[SATELLITES] !== undefined);
  const here = useHere((state) => state.counts[SATELLITES]);
  const module = modules?.find((m) => m.id === SATELLITES);
  if (!module?.enabled) return null;
  const notice = satellitesNotice({
    active:
      module.health.state !== "missing_key" &&
      effectiveFilter(chosen, module) === "all",
    inRange: inZoomRange(zoomRangeOf(module), {
      level,
      over: over.has(SATELLITES),
    }),
    pinned,
    here,
    capPercent: ZOOM_CAPS[SATELLITES] ?? 300,
  });
  if (!notice) return null;
  const show = notice.action === "show-here";
  return (
    <div
      role="status"
      className="pointer-events-auto absolute top-14 left-1/2 z-6 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2.5 border border-line-2 bg-panel px-2.5 py-1.5 text-label text-ink-2 tracking-[0.04em] lg:top-5.5"
    >
      <span className="min-w-0 truncate">{notice.text}</span>
      <button
        type="button"
        onClick={() =>
          show
            ? usePins.getState().pin(SATELLITES, level)
            : usePins.getState().unpin(SATELLITES)
        }
        className={
          show
            ? "h-5 shrink-0 border border-line-2 px-1.5 text-micro text-ink tracking-[0.06em] hover-fine:border-accent hover-fine:text-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-2"
            : "h-5 shrink-0 border border-accent px-1.5 text-accent text-micro tracking-[0.06em] hover-fine:bg-accent hover-fine:text-space focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-2"
        }
      >
        {show ? "SHOW HERE" : "AUTO"}
      </button>
    </div>
  );
}
