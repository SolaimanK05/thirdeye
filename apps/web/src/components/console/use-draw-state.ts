"use client";

import { useMemo } from "react";
import type { ModuleInfo } from "@/api/client";
import { padBox } from "@/modules/geo-box";
import { usePins } from "@/state/pins";
import { useViewport } from "@/state/viewport";
import { useConsole } from "./console-shell";
import {
  clipsToView,
  type DrawModule,
  type DrawView,
  type Scope,
  scopeOf,
} from "./draw-rules";
import { zoomRangeOf } from "./rail";
import type { Filter } from "./types";

/** How far past the view edge a pinned layer still draws, as a share of the view. */
export const CLIP_PAD = 0.15;

export type DrawState = {
  level: DrawView["level"];
  isOver: boolean;
  drawModule: DrawModule;
  drawView: DrawView;
  scope: Scope;
  /** True while a pinned module draws only what is in view. */
  clipped: boolean;
  /** The view a pinned module is clipped to, a little grown; null for no clipping. */
  clipBox: ReturnType<typeof padBox>;
  /** The view itself; null while the camera sees the whole globe. */
  viewBox: ReturnType<typeof useViewport.getState>["box"];
  /** The module is on but only its starred items draw, because of the zoom. */
  hidden: boolean;
};

/** What the draw rules say about one module right now, for every kind of marker layer. */
export function useDrawState(
  module: ModuleInfo,
  filter: Filter,
  minSeverityAt?: DrawModule["minSeverityAt"],
): DrawState {
  const { level, over } = useConsole();
  const pinned = usePins((state) => state.pins[module.id] !== undefined);
  const viewBox = useViewport((state) => state.box);
  const missingKey = module.health.state === "missing_key";
  const rangeMin = module.zoom_range?.min;
  const rangeMax = module.zoom_range?.max;
  const drawModule = useMemo<DrawModule>(
    () => ({
      filter,
      usable: !missingKey,
      zoomRange: zoomRangeOf({
        zoom_range:
          rangeMin === undefined || rangeMax === undefined
            ? null
            : { min: rangeMin, max: rangeMax },
      }),
      pinned,
      minSeverityAt,
    }),
    [filter, missingKey, rangeMin, rangeMax, pinned, minSeverityAt],
  );
  const isOver = over.has(module.id);
  const drawView = useMemo(() => ({ level, over: isOver }), [level, isOver]);
  const scope = scopeOf(drawModule, drawView);
  const clipped = clipsToView(drawModule, drawView);
  const clipBox = useMemo(
    () => (clipped ? padBox(viewBox, CLIP_PAD) : null),
    [clipped, viewBox],
  );
  return {
    level,
    isOver,
    drawModule,
    drawView,
    scope,
    clipped,
    clipBox,
    viewBox,
    hidden: filter === "all" && !missingKey && scope === "starred",
  };
}
