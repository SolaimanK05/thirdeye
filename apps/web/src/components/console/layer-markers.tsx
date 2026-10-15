"use client";

import { useEffect } from "react";
import type { ModuleInfo } from "@/api/client";
import { useLayer, useModules } from "@/api/queries";
import { ENTITY_VIEWS, MODULE_VIEWS } from "@/modules/registry";
import { useFilters } from "@/state/filters";
import { useLayerCaps } from "@/state/layer-caps";
import { useSelection } from "@/state/selection";
import { useStarred } from "@/state/starred";
import { useViewport } from "@/state/viewport";
import { useConsole } from "./console-shell";
import type { MarkerOverlay } from "./marker-overlay";
import { withStars } from "./markers";
import { effectiveFilter } from "./rail";
import { boxParam, clusterFor, queryBox } from "./viewport";
import { zoomLevelFor } from "./zoom";

type Props = { overlay: MarkerOverlay };

function hasView(module: ModuleInfo): boolean {
  return module.kind === "entities"
    ? ENTITY_VIEWS[module.id] !== undefined
    : MODULE_VIEWS[module.id] !== undefined;
}

export function LayerMarkers({ overlay }: Props) {
  const { data: modules } = useModules();
  const { ids: starred } = useStarred();
  const drawable = (modules ?? []).filter(
    (module) => module.enabled && hasView(module),
  );
  return drawable.map((module) => (
    <ModuleMarkers
      key={module.id}
      module={module}
      overlay={overlay}
      starred={starred}
    />
  ));
}

function ModuleMarkers({
  module,
  overlay,
  starred,
}: {
  module: ModuleInfo;
  overlay: MarkerOverlay;
  starred: ReadonlySet<string>;
}) {
  const view = useViewport((state) => state.box);
  const box = module.viewport ? queryBox(view) : null;
  const clustering = box === null ? null : clusterFor(box);
  const { data } = useLayer(
    module.id,
    module.cadence_seconds,
    box === null
      ? null
      : {
          bbox: boxParam(box),
          cell: clustering?.cell ?? null,
          minSeverity: clustering?.minSeverity ?? 0,
        },
  );
  const setCap = useLayerCaps((state) => state.setCap);
  const { zoomPercent } = useConsole();
  const filter = useFilters((state) => effectiveFilter(state.filters, module));
  const selectedModule = useSelection((state) => state.selected?.moduleId);
  const select = useSelection((state) => state.select);
  const level = zoomLevelFor(zoomPercent).level;
  const range = module.zoom_range;
  const inRange = range !== null && level >= range.min && level <= range.max;
  const stale = module.health.state === "stale";
  const missingKey = module.health.state === "missing_key";
  const entityView =
    module.kind === "entities" ? ENTITY_VIEWS[module.id] : undefined;
  const eventView =
    module.kind === "events" ? MODULE_VIEWS[module.id] : undefined;
  const onlyStarred = filter === "starred" && entityView !== undefined;
  const drawing = (filter === "all" || onlyStarred) && !missingKey;

  useEffect(() => {
    if (entityView && data) {
      overlay.setLayer(
        module.id,
        withStars(
          entityView.markers(data.entities, { level }),
          starred,
          onlyStarred,
        ),
        stale,
      );
    } else if (eventView && data) {
      overlay.setLayer(module.id, eventView.markers(data.rows), stale);
    } else {
      overlay.removeLayer(module.id);
    }
  }, [
    overlay,
    module.id,
    entityView,
    eventView,
    data,
    stale,
    level,
    starred,
    onlyStarred,
  ]);

  const shown = data?.record_count;
  const matched = data?.matched;
  const capped = data?.truncated === true;
  useEffect(() => {
    if (capped && shown !== undefined && matched !== undefined) {
      setCap(module.id, { shown, matched });
    } else {
      setCap(module.id, null);
    }
    return () => setCap(module.id, null);
  }, [module.id, capped, shown, matched, setCap]);

  useEffect(() => {
    overlay.setVisible(module.id, drawing && inRange);
  }, [overlay, module.id, drawing, inRange]);

  useEffect(() => {
    if (!drawing && selectedModule === module.id) select(null);
  }, [drawing, selectedModule, module.id, select]);

  useEffect(() => () => overlay.removeLayer(module.id), [overlay, module.id]);

  return null;
}
