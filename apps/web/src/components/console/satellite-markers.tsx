"use client";

import { useEffect, useState } from "react";
import type { ModuleInfo } from "@/api/client";
import { useSatelliteElements } from "@/api/queries";
import { ENTITY_VIEWS } from "@/modules/registry";
import { createSatelliteWorker } from "@/modules/satellites/create-worker";
import { useFilters } from "@/state/filters";
import { useSelection } from "@/state/selection";
import { useConsole } from "./console-shell";
import type { MarkerOverlay } from "./marker-overlay";
import { effectiveFilter } from "./rail";
import { SATELLITES_ID, SatelliteDriver } from "./satellite-driver";
import { zoomLevelFor } from "./zoom";

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
  const { zoomPercent } = useConsole();
  const level = zoomLevelFor(zoomPercent).level;
  const range = module.zoom_range;
  const view = ENTITY_VIEWS[module.id];
  const maxPercent = view?.computed ? view.maxZoomPercent : undefined;
  const inRange =
    range !== null &&
    level >= range.min &&
    level <= range.max &&
    (maxPercent === undefined || zoomPercent <= maxPercent);
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
    });
    setDriver(created);
    return () => {
      created.destroy();
      setDriver(null);
    };
  }, [overlay]);

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
    driver?.setStale(stale);
  }, [driver, stale]);

  useEffect(() => {
    driver?.setFollowing(following);
  }, [driver, following]);

  useEffect(() => {
    driver?.setInScope(inRange);
  }, [driver, inRange]);

  const spotlight = drawing && !inRange && selectedId !== null;
  const visible = drawing && inRange;
  useEffect(() => {
    driver?.setActive(visible);
    overlay.setVisible(SATELLITES_ID, visible || spotlight);
  }, [driver, overlay, visible, spotlight]);

  useEffect(() => {
    if (!drawing && selectedModule === SATELLITES_ID) select(null);
  }, [drawing, selectedModule, select]);

  return null;
}
