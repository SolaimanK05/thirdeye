"use client";

import { useModules } from "@/api/queries";
import { useInView } from "@/state/in-view";
import { useMotionStatus } from "@/state/motion";
import { useSelection } from "@/state/selection";
import { useConsole } from "./console-shell";
import { formatCentre } from "./geo";
import { railCounts } from "./status";
import { useRail } from "./use-rail";
import { altitudeKm, formatKm, scaleBar, zoomLevelFor } from "./zoom";
import { ZoomControl } from "./zoom-control";

const SHEET_CLEARANCE = "bottom-20 lg:bottom-5.5";

export function GlobeHud() {
  const { zoomPercent, globeStyle, centre } = useConsole();
  const level = zoomLevelFor(zoomPercent);
  const { status, domains } = useRail();
  const inView = useInView((state) =>
    Object.values(state.counts).reduce((sum, count) => sum + count, 0),
  );
  const layers = railCounts(domains, level.level).drawn;
  const { data: modules } = useModules();
  const modes = useMotionStatus((state) => state.modes);
  const selectedModule = useSelection((state) =>
    state.selected?.kind === "entity" ? state.selected.moduleId : null,
  );
  const renderModule =
    selectedModule !== null && selectedModule in modes
      ? selectedModule
      : (Object.keys(modes)[0] ?? null);
  const renderDelay =
    renderModule === null
      ? null
      : (modules?.find((module) => module.id === renderModule)
          ?.render_delay_seconds ?? null);
  const scale = scaleBar(zoomPercent);

  return (
    <>
      <div className="absolute top-4 left-4 z-5 flex flex-col gap-0.75 text-ink-3 text-label tracking-[0.04em] tabular-nums lg:top-5.5 lg:left-6">
        <span className="text-ink-2">
          {formatKm(altitudeKm(zoomPercent))}, {level.name}
        </span>
        <span>{formatCentre(centre)}</span>
        {renderModule !== null && renderDelay !== null && (
          <span>
            RENDER T−{renderDelay}s, {modes[renderModule]}
          </span>
        )}
      </div>

      <div className="absolute top-5.5 right-6 z-5 hidden flex-col items-end gap-0.75 text-ink-3 text-label tracking-[0.04em] tabular-nums @min-[640px]:flex">
        <span className="text-ink-2">{globeStyle}</span>
        <span>{status === "ready" ? `${inView} in view` : "no data"}</span>
        <span className="hidden xl:inline">
          {status === "ready"
            ? `${layers} ${layers === 1 ? "layer" : "layers"}`
            : ""}
        </span>
      </div>

      <ZoomControl className="-translate-y-1/2 absolute top-1/2 right-3 z-9 lg:right-4.5" />

      <div
        className={`absolute left-4 z-5 flex flex-col gap-1 text-ink-3 text-label tracking-normal tabular-nums lg:left-6 ${SHEET_CLEARANCE}`}
      >
        <span
          aria-hidden="true"
          style={{ width: scale.widthPx }}
          className="block h-1 border border-ink-3 border-t-0"
        />
        <span>{scale.label}</span>
      </div>
    </>
  );
}
