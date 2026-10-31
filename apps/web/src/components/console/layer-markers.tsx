"use client";

import { useEffect, useMemo, useState } from "react";
import type { ModuleInfo } from "@/api/client";
import { useLayer, useModules } from "@/api/queries";
import { isBinaryMover, moverSpecs } from "@/data/binary";
import { MoverLayers } from "@/data/mover-layers";
import { useDataRuntime } from "@/data/runtime";
import { refineRows, serverFloor } from "@/modules/refine";
import { ENTITY_VIEWS, MODULE_VIEWS } from "@/modules/registry";
import { useRefineValues } from "@/modules/use-refine";
import { readFlags } from "@/perf/params";
import { entityStore, useEntityView } from "@/state/entities";
import { useFilters } from "@/state/filters";
import { useLayerCaps } from "@/state/layer-caps";
import { useMotionStatus } from "@/state/motion";
import { useRefineStats } from "@/state/refine-stats";
import { useSelection } from "@/state/selection";
import { useStarred } from "@/state/starred";
import { streamIsLive, useStreamStatus } from "@/state/stream";
import { useViewport } from "@/state/viewport";
import { useConsole } from "./console-shell";
import { DataModuleMarkers, SyntheticMarkers } from "./data-markers";
import type { MarkerOverlay } from "./marker-overlay";
import { withStars } from "./markers";
import { effectiveFilter } from "./rail";
import { SatelliteMarkers } from "./satellite-markers";
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
  const mode = useDataRuntime((state) => state.mode);
  const hub = useDataRuntime((state) => state.hub);
  const [layers, setLayers] = useState<MoverLayers | null>(null);
  const synthetic = hub !== null && readFlags(window.location.search).synthetic;
  const specs = useMemo(
    () => (hub ? moverSpecs(modules, synthetic) : []),
    [hub, modules, synthetic],
  );
  const specKey = JSON.stringify(specs);

  useEffect(() => {
    if (!hub) return;
    const created = new MoverLayers(hub, overlay, {
      setStat: (moduleId, stat) =>
        useRefineStats.getState().setStat(moduleId, stat),
      setMode: (moduleId, motion) =>
        useMotionStatus.getState().setMode(moduleId, motion),
    });
    setLayers(created);
    return () => {
      created.destroy();
      setLayers(null);
    };
  }, [hub, overlay]);

  // The key stands for the list, so a refetch that changes nothing sends nothing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    hub?.setMovers(specs);
  }, [hub, specKey]);

  const drawable = (modules ?? []).filter(
    (module) => module.enabled && hasView(module),
  );
  const items = drawable.map((module) => {
    if (ENTITY_VIEWS[module.id]?.computed) {
      return (
        <SatelliteMarkers
          key={module.id}
          module={module}
          overlay={overlay}
          starred={starred}
        />
      );
    }
    if (isBinaryMover(module.id)) {
      if (mode === "pending") return null;
      if (hub && layers) {
        return (
          <DataModuleMarkers
            key={module.id}
            module={module}
            overlay={overlay}
            hub={hub}
            layers={layers}
            starred={starred}
          />
        );
      }
      if (hub) return null;
    }
    return (
      <ModuleMarkers
        key={module.id}
        module={module}
        overlay={overlay}
        starred={starred}
      />
    );
  });
  return (
    <>
      {items}
      {synthetic && hub && layers && (
        <SyntheticMarkers overlay={overlay} hub={hub} layers={layers} />
      )}
    </>
  );
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
  const { controls, values } = useRefineValues(module.id);
  const floor = serverFloor(controls, values);
  const live = useStreamStatus(streamIsLive);
  const stored = useEntityView(module.id);
  const fromStream = module.kind === "entities" && live && stored !== undefined;
  const { data, dataUpdatedAt } = useLayer(
    module.id,
    module.cadence_seconds,
    box === null
      ? null
      : {
          bbox: boxParam(box),
          cell: clustering?.cell ?? null,
          minSeverity: Math.max(clustering?.minSeverity ?? 0, floor),
        },
    !fromStream,
  );
  const queryEntities = module.kind === "entities" ? data?.entities : undefined;
  const queryFetchedAt = data?.fetched_at ?? null;

  useEffect(() => {
    if (queryEntities) {
      entityStore.seed(module.id, queryEntities, queryFetchedAt);
    }
  }, [module.id, queryEntities, queryFetchedAt]);
  const setStat = useRefineStats((state) => state.setStat);
  const setCap = useLayerCaps((state) => state.setCap);
  const { zoomPercent } = useConsole();
  const filter = useFilters((state) => effectiveFilter(state.filters, module));
  const selectedModule = useSelection((state) => state.selected?.moduleId);
  const selectedId = useSelection((state) =>
    state.selected?.moduleId === module.id ? state.selected.id : null,
  );
  const keep = useMemo(
    () => (selectedId === null ? starred : new Set([...starred, selectedId])),
    [starred, selectedId],
  );
  const select = useSelection((state) => state.select);
  const level = zoomLevelFor(zoomPercent).level;
  const range = module.zoom_range;
  const inRange = range !== null && level >= range.min && level <= range.max;
  const stale =
    module.health.state === "stale" || module.health.state === "cooldown";
  const missingKey = module.health.state === "missing_key";
  const candidate =
    module.kind === "entities" ? ENTITY_VIEWS[module.id] : undefined;
  const entityView = candidate?.computed ? undefined : candidate;
  const eventView =
    module.kind === "events" ? MODULE_VIEWS[module.id] : undefined;
  const onlyStarred = filter === "starred" && entityView !== undefined;
  const drawing = (filter === "all" || onlyStarred) && !missingKey;

  useEffect(() => {
    if (entityView && stored) {
      const refined = refineRows(
        stored.rows,
        entityView.refine,
        values,
        stored.updatedAt,
        keep,
      );
      setStat(module.id, { kept: refined.kept, total: refined.total });
      overlay.setLayer(
        module.id,
        withStars(
          entityView.markers(refined.rows, { level }),
          starred,
          onlyStarred,
        ),
        stale,
        entityView.sizing,
      );
    } else if (eventView && data) {
      const refined = refineRows(
        data.rows,
        eventView.refine,
        values,
        dataUpdatedAt,
        keep,
      );
      setStat(module.id, { kept: refined.kept, total: refined.total });
      overlay.setLayer(module.id, eventView.markers(refined.rows), stale);
    } else {
      setStat(module.id, null);
      overlay.removeLayer(module.id);
    }
  }, [
    overlay,
    module.id,
    entityView,
    eventView,
    stored,
    data,
    dataUpdatedAt,
    values,
    keep,
    setStat,
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

  useEffect(
    () => () => {
      overlay.removeLayer(module.id);
      setStat(module.id, null);
    },
    [overlay, module.id, setStat],
  );

  return null;
}
