"use client";

import { useEffect, useState } from "react";
import type { ModuleInfo } from "@/api/client";
import { useSatelliteElements } from "@/api/queries";
import { createSatelliteWorker } from "@/modules/satellites/create-worker";
import { pickOptionsOf, traitsOf } from "@/modules/satellites/traits";
import { useRefineValues } from "@/modules/use-refine";
import { useDrawLimit } from "@/state/draw-limits";
import { useFilters } from "@/state/filters";
import { useHere } from "@/state/here";
import { useRefineOptions } from "@/state/refine-options";
import { useRefineStats } from "@/state/refine-stats";
import { useSelection } from "@/state/selection";
import { inZoomRange } from "./draw-rules";
import type { MarkerOverlay } from "./marker-overlay";
import { effectiveFilter, zoomRangeOf } from "./rail";
import { SATELLITES_ID, SatelliteDriver } from "./satellite-driver";
import { useDrawState } from "./use-draw-state";

type Props = {
  module: ModuleInfo;
  overlay: MarkerOverlay;
  starred: ReadonlySet<string>;
};

export function SatelliteMarkers({ module, overlay, starred }: Props) {
  const filter = useFilters((state) => effectiveFilter(state.filters, module));
  const onlyStarred = filter === "starred";
  const missingKey = module.health.state === "missing_key";
  const drawing = (filter === "all" || onlyStarred) && !missingKey;
  const stale = ["stale", "cooldown", "failed"].includes(module.health.state);
  const { drawView, clipped, clipBox, viewBox, hidden } = useDrawState(
    module,
    filter,
  );
  // Pinned with SHOW HERE counts as in scope, drawn only where the view is.
  const inRange = inZoomRange(zoomRangeOf(module), drawView) || clipped;
  const elements = useSatelliteElements(module.cadence_seconds, drawing);
  const selectedModule = useSelection((state) => state.selected?.moduleId);
  const selectedId = useSelection((state) =>
    state.selected?.moduleId === SATELLITES_ID ? state.selected.id : null,
  );
  const following = useSelection(
    (state) => state.following && state.selected?.moduleId === SATELLITES_ID,
  );
  const select = useSelection((state) => state.select);
  const [driver, setDriver] = useState<SatelliteDriver | null>(null);

  useEffect(() => {
    const created = new SatelliteDriver({
      overlay,
      port: createSatelliteWorker(),
      onCount: (count) => useRefineStats.getState().setStat(module.id, count),
      onHere: (count) => useHere.getState().setCount(module.id, count),
    });
    setDriver(created);
    return () => {
      created.destroy();
      setDriver(null);
    };
  }, [overlay, module.id]);

  const satellites = elements.data?.satellites;
  useEffect(() => {
    driver?.setElements(satellites);
  }, [driver, satellites]);

  useEffect(() => {
    driver?.setSelected(selectedId);
  }, [driver, selectedId]);

  useEffect(() => {
    driver?.setStars(starred, onlyStarred);
  }, [driver, starred, onlyStarred]);

  useEffect(() => {
    if (satellites === undefined) return;
    const rows = satellites.flatMap((element) => traitsOf(element) ?? []);
    useRefineOptions.getState().setOptions(module.id, pickOptionsOf(rows));
  }, [module.id, satellites]);

  const { values } = useRefineValues(module.id);
  useEffect(() => {
    driver?.setFilters(values);
  }, [driver, values]);

  const { limit } = useDrawLimit(module.id);
  useEffect(() => {
    driver?.setLimit(limit);
  }, [driver, limit]);

  useEffect(() => {
    driver?.setStale(stale);
  }, [driver, stale]);

  useEffect(() => {
    driver?.setFollowing(following);
  }, [driver, following]);

  useEffect(() => {
    driver?.setInScope(inRange);
  }, [driver, inRange]);

  useEffect(() => {
    driver?.setClip(clipBox, clipped);
  }, [driver, clipBox, clipped]);

  // Hidden satellites are not moving, so the driver looks now and then to count them.
  useEffect(() => {
    driver?.setWatch(hidden, viewBox);
    if (!hidden) useHere.getState().setCount(module.id, null);
  }, [driver, module.id, hidden, viewBox]);

  useEffect(
    () => () => useHere.getState().setCount(module.id, null),
    [module.id],
  );

  // Out of range, the starred satellites and the selected one still draw.
  const extras =
    drawing && !inRange && (selectedId !== null || starred.size > 0);
  const visible = drawing && inRange;
  useEffect(() => {
    driver?.setActive(visible || extras);
    overlay.setVisible(SATELLITES_ID, visible || extras);
  }, [driver, overlay, visible, extras]);

  useEffect(() => {
    if (!drawing && selectedModule === SATELLITES_ID) select(null);
  }, [drawing, selectedModule, select]);

  return null;
}
