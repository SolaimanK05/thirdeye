"use client";

import { useEffect, useMemo, useState } from "react";
import type { EntityRow, EventRow, ModuleInfo } from "@/api/client";
import { useLayer, useModules } from "@/api/queries";
import { isBinaryMover, moverSpecs } from "@/data/binary";
import { MoverLayers } from "@/data/mover-layers";
import { useDataRuntime } from "@/data/runtime";
import { limitRows } from "@/modules/draw-limit";
import { boxContains } from "@/modules/geo-box";
import { type RefineSpec, refineRows, serverFloor } from "@/modules/refine";
import { ENTITY_VIEWS, MODULE_VIEWS } from "@/modules/registry";
import { useRefineValues } from "@/modules/use-refine";
import { readFlags } from "@/perf/params";
import { useDrawLimit } from "@/state/draw-limits";
import { entityStore, useEntityView } from "@/state/entities";
import { useFilters } from "@/state/filters";
import { useHere } from "@/state/here";
import { useLayerCaps } from "@/state/layer-caps";
import { useMotionStatus } from "@/state/motion";
import { usePins } from "@/state/pins";
import { useRefineStats } from "@/state/refine-stats";
import { useSelection } from "@/state/selection";
import { useStarred } from "@/state/starred";
import { streamIsLive, useStreamStatus } from "@/state/stream";
import { useViewport } from "@/state/viewport";
import { useConsole } from "./console-shell";
import { DataModuleMarkers, SyntheticMarkers } from "./data-markers";
import { inZoomRange, isDrawn } from "./draw-rules";
import type { MarkerOverlay } from "./marker-overlay";
import { withStars } from "./markers";
import { effectiveFilter, zoomRangeOf } from "./rail";
import { SatelliteMarkers } from "./satellite-markers";
import { useDrawState } from "./use-draw-state";
import { boxParam, clusterFor, queryBox } from "./viewport";

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
      <PinSweeper modules={drawable} />
      {items}
      {synthetic && hub && layers && (
        <SyntheticMarkers overlay={overlay} hub={hub} layers={layers} />
      )}
    </>
  );
}

/** A pin lasts until the zoom comes back into the module's range, or the user says AUTO. */
function PinSweeper({ modules }: { modules: readonly ModuleInfo[] }) {
  const { level, over } = useConsole();
  const pins = usePins((state) => state.pins);
  useEffect(() => {
    for (const id of Object.keys(pins)) {
      const module = modules.find((m) => m.id === id);
      if (!module) continue;
      if (inZoomRange(zoomRangeOf(module), { level, over: over.has(id) })) {
        usePins.getState().unpin(id);
      }
    }
  }, [pins, modules, level, over]);
  return null;
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
  const { limit } = useDrawLimit(module.id);
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
  const stale =
    module.health.state === "stale" || module.health.state === "cooldown";
  const missingKey = module.health.state === "missing_key";
  const candidate =
    module.kind === "entities" ? ENTITY_VIEWS[module.id] : undefined;
  const entityView = candidate?.computed ? undefined : candidate;
  const eventView =
    module.kind === "events" ? MODULE_VIEWS[module.id] : undefined;
  const starredFilter = filter === "starred" && entityView !== undefined;
  const drawing = (filter === "all" || starredFilter) && !missingKey;
  const { level, drawModule, drawView, scope, clipBox, viewBox, hidden } =
    useDrawState(module, filter, eventView?.minSeverityAt);
  const onlyStarred = scope === "starred" && entityView !== undefined;

  useEffect(() => {
    if (entityView && stored) {
      const refined = refineRows(
        stored.rows,
        entityView.refine,
        values,
        stored.updatedAt,
        keep,
      );
      const inZoom = refined.rows.filter((row) =>
        isDrawn(
          drawModule,
          {
            starred: starred.has(row.id),
            selected: keep.has(row.id),
            inView: boxContains(clipBox, row.lon, row.lat),
          },
          drawView,
        ),
      );
      const limited = limitRows(inZoom, limit, entityView.importance, keep);
      const markers = withStars(
        entityView.markers(limited.rows, { level }),
        starred,
        onlyStarred,
      );
      setStat(module.id, {
        kept: refined.kept,
        total: refined.total,
        drawn: markers.length,
      });
      overlay.setLayer(module.id, markers, stale, entityView.sizing);
    } else if (eventView && data) {
      const refined = refineRows(
        data.rows,
        eventView.refine,
        values,
        dataUpdatedAt,
        keep,
      );
      const inZoom = refined.rows.filter((row) =>
        isDrawn(
          drawModule,
          {
            starred: false,
            selected: keep.has(row.id),
            severity: row.severity,
            inView: boxContains(clipBox, row.lon, row.lat),
          },
          drawView,
        ),
      );
      const limited = limitRows(inZoom, limit, eventView.importance, keep);
      const markers = eventView.markers(limited.rows);
      setStat(module.id, {
        kept: refined.kept,
        total: refined.total,
        drawn: limited.drawn,
      });
      overlay.setLayer(module.id, markers, stale);
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
    limit,
    drawModule,
    drawView,
    clipBox,
  ]);

  // A hidden module draws nothing, so its "N here" is counted from its rows.
  const countRows =
    entityView !== undefined ? stored?.rows : (data?.rows ?? undefined);
  const countSpec = entityView?.refine ?? eventView?.refine;
  const countedAt =
    entityView !== undefined ? stored?.updatedAt : dataUpdatedAt;
  const here = useMemo(() => {
    if (!hidden || !countRows) return null;
    const refined = refineRows(
      countRows as readonly (EntityRow | EventRow)[],
      countSpec as RefineSpec<EntityRow | EventRow> | undefined,
      values,
      countedAt ?? 0,
      keep,
    );
    return refined.rows.filter((row) => boxContains(viewBox, row.lon, row.lat))
      .length;
  }, [hidden, countRows, countSpec, values, countedAt, keep, viewBox]);

  useEffect(() => {
    useHere.getState().setCount(module.id, here);
    return () => useHere.getState().setCount(module.id, null);
  }, [module.id, here]);

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
    const visible =
      scope === "all" || (scope === "starred" && entityView !== undefined);
    overlay.setVisible(module.id, visible);
  }, [overlay, module.id, scope, entityView]);

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
