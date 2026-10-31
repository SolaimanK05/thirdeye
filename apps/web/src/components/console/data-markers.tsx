"use client";

import { useEffect, useMemo } from "react";
import type { ModuleInfo } from "@/api/client";
import { SYNTHETIC_MODULE } from "@/data/binary";
import type { DataHub } from "@/data/hub";
import type { MoverLayers } from "@/data/mover-layers";
import { aircraftSizing, aircraftStyle } from "@/modules/aircraft/render";
import { ENTITY_VIEWS } from "@/modules/registry";
import { useRefineValues } from "@/modules/use-refine";
import { useFilters } from "@/state/filters";
import { useLayerCaps } from "@/state/layer-caps";
import { useSelection } from "@/state/selection";
import { useConsole } from "./console-shell";
import type { MarkerOverlay } from "./marker-overlay";
import { effectiveFilter } from "./rail";
import { zoomLevelFor } from "./zoom";

type Props = {
  module: ModuleInfo;
  overlay: MarkerOverlay;
  hub: DataHub;
  layers: MoverLayers;
  starred: ReadonlySet<string>;
};

/**
 * The binary-frame counterpart of ModuleMarkers: it does no row work itself.
 * It tells the data worker what to keep and how to filter, and tells the
 * overlay how the worker's columns should look.
 */
export function DataModuleMarkers({
  module,
  overlay,
  hub,
  layers,
  starred,
}: Props) {
  const { values } = useRefineValues(module.id);
  const { zoomPercent } = useConsole();
  const filter = useFilters((state) => effectiveFilter(state.filters, module));
  const selectedModule = useSelection((state) => state.selected?.moduleId);
  const selectedId = useSelection((state) =>
    state.selected?.moduleId === module.id ? state.selected.id : null,
  );
  const select = useSelection((state) => state.select);
  const level = zoomLevelFor(zoomPercent).level;
  const range = module.zoom_range;
  const inRange = range !== null && level >= range.min && level <= range.max;
  const stale =
    module.health.state === "stale" || module.health.state === "cooldown";
  const missingKey = module.health.state === "missing_key";
  const view = ENTITY_VIEWS[module.id];
  const onlyStarred = filter === "starred";
  const drawing = (filter === "all" || onlyStarred) && !missingKey;
  const style = useMemo(
    () => (view && !view.computed ? view.columnar?.({ level }) : undefined),
    [view, level],
  );
  const keep = useMemo(
    () => (selectedId === null ? starred : new Set([...starred, selectedId])),
    [starred, selectedId],
  );

  useEffect(() => {
    if (!style) return;
    layers.configure(module.id, {
      style,
      stale,
      sizing: view?.sizing,
      starred,
    });
  }, [layers, module.id, style, stale, view, starred]);

  useEffect(() => {
    hub.setRefine(module.id, values);
  }, [hub, module.id, values]);

  useEffect(() => {
    layers.setKeep(module.id, keep, onlyStarred, starred);
  }, [layers, module.id, keep, onlyStarred, starred]);

  useEffect(() => {
    const visible = drawing && inRange;
    overlay.setVisible(module.id, visible);
    hub.setVisible(module.id, visible);
  }, [overlay, hub, module.id, drawing, inRange]);

  useEffect(() => {
    if (!drawing && selectedModule === module.id) select(null);
  }, [drawing, selectedModule, module.id, select]);

  useEffect(() => {
    useLayerCaps.getState().setCap(module.id, null);
    return () => layers.remove(module.id);
  }, [layers, module.id]);

  return null;
}

const NONE: ReadonlySet<string> = new Set();

/** The server's synthetic fleet (`?synthetic=1`), drawn like aircraft with no controls. */
export function SyntheticMarkers({
  overlay,
  hub,
  layers,
}: Omit<Props, "module" | "starred">) {
  useEffect(() => {
    layers.configure(SYNTHETIC_MODULE, {
      style: aircraftStyle(),
      stale: false,
      sizing: aircraftSizing,
      starred: NONE,
    });
    layers.setKeep(SYNTHETIC_MODULE, NONE, false, NONE);
    overlay.setVisible(SYNTHETIC_MODULE, true);
    hub.setVisible(SYNTHETIC_MODULE, true);
    return () => layers.remove(SYNTHETIC_MODULE);
  }, [overlay, hub, layers]);
  return null;
}
