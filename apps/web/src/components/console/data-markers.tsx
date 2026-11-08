"use client";

import { useEffect, useMemo } from "react";
import type { ModuleInfo } from "@/api/client";
import { SYNTHETIC_MODULE } from "@/data/binary";
import type { DataHub } from "@/data/hub";
import type { MoverLayers } from "@/data/mover-layers";
import { aircraftSizing, aircraftStyle } from "@/modules/aircraft/render";
import { ENTITY_VIEWS } from "@/modules/registry";
import { useRefineValues } from "@/modules/use-refine";
import { useDrawLimit } from "@/state/draw-limits";
import { useFilters } from "@/state/filters";
import { useHere } from "@/state/here";
import { useLayerCaps } from "@/state/layer-caps";
import { useSelection } from "@/state/selection";
import type { MarkerOverlay } from "./marker-overlay";
import { effectiveFilter } from "./rail";
import { useDrawState } from "./use-draw-state";

const HERE_REFRESH_MS = 5000;

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
  const { limit } = useDrawLimit(module.id);
  const filter = useFilters((state) => effectiveFilter(state.filters, module));
  const { level, scope, clipBox, viewBox, hidden } = useDrawState(
    module,
    filter,
  );
  const selectedModule = useSelection((state) => state.selected?.moduleId);
  const selectedId = useSelection((state) =>
    state.selected?.moduleId === module.id ? state.selected.id : null,
  );
  const select = useSelection((state) => state.select);
  const stale =
    module.health.state === "stale" || module.health.state === "cooldown";
  const missingKey = module.health.state === "missing_key";
  const view = ENTITY_VIEWS[module.id];
  const drawing = (filter === "all" || filter === "starred") && !missingKey;
  const onlyStarred = scope === "starred";
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
    hub.setLimit(module.id, limit);
  }, [hub, module.id, limit]);

  useEffect(() => {
    hub.setClip(module.id, clipBox);
  }, [hub, module.id, clipBox]);

  // A hidden module draws nothing, so its "N here" comes from the worker.
  useEffect(() => {
    if (!hidden) return;
    const off = hub.subscribe((message) => {
      if (message.type === "here" && message.moduleId === module.id) {
        useHere.getState().setCount(module.id, message.count);
      }
    });
    hub.countHere(module.id, viewBox);
    const timer = setInterval(
      () => hub.countHere(module.id, viewBox),
      HERE_REFRESH_MS,
    );
    return () => {
      off();
      clearInterval(timer);
    };
  }, [hub, module.id, hidden, viewBox]);

  useEffect(() => {
    if (!hidden) useHere.getState().setCount(module.id, null);
  }, [module.id, hidden]);

  useEffect(
    () => () => useHere.getState().setCount(module.id, null),
    [module.id],
  );

  useEffect(() => {
    layers.setKeep(module.id, keep, onlyStarred, starred);
  }, [layers, module.id, keep, onlyStarred, starred]);

  useEffect(() => {
    const visible =
      scope === "all" || (scope === "starred" && starred.size > 0);
    overlay.setVisible(module.id, visible);
    hub.setVisible(module.id, visible);
  }, [overlay, hub, module.id, scope, starred]);

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
