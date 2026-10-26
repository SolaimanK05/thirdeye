import type {
  EntityDetail,
  EntityRow,
  EventDetail,
  EventRow,
} from "@/api/client";
import type {
  ClusterInfo,
  LayerSizing,
  Marker,
} from "@/components/console/markers";
import type { Selection, ZoomLevel } from "@/components/console/types";
import { aircraftRefine } from "./aircraft/refine";
import { aircraftMarkers, aircraftSizing } from "./aircraft/render";
import { aircraftSelection } from "./aircraft/selection";
import { quakeRefine } from "./earthquakes/refine";
import { quakeMarkers } from "./earthquakes/render";
import { quakeSelection } from "./earthquakes/selection";
import { entitySelection, type StarOptions } from "./entity";
import { genericSelection } from "./generic";
import { portRefine } from "./ports/refine";
import { portMarkers } from "./ports/render";
import { portSelection } from "./ports/selection";
import type { RefineControl, RefineSpec } from "./refine";
import { fireRefine } from "./wildfires/refine";
import { fireMarkers } from "./wildfires/render";
import { fireSelection } from "./wildfires/selection";

export type ModuleView = {
  markers: (rows: readonly EventRow[]) => Marker[];
  selection: (
    detail: EventDetail,
    nowMs: number,
    cluster?: ClusterInfo,
  ) => Selection;
  refine?: RefineSpec<EventRow>;
};

export const MODULE_VIEWS: Readonly<Record<string, ModuleView>> = {
  earthquakes: {
    markers: quakeMarkers,
    selection: quakeSelection,
    refine: quakeRefine,
  },
  wildfires: {
    markers: fireMarkers,
    selection: fireSelection,
    refine: fireRefine,
  },
};

export function selectionFor(
  detail: EventDetail,
  nowMs: number,
  cluster?: ClusterInfo,
): Selection {
  const view = MODULE_VIEWS[detail.module_id];
  return view
    ? view.selection(detail, nowMs, cluster)
    : genericSelection(detail, nowMs);
}

export type EntityView = {
  markers: (
    rows: readonly EntityRow[],
    context: { level: ZoomLevel },
  ) => Marker[];
  selection: (
    detail: EntityDetail,
    nowMs: number,
    options: StarOptions,
  ) => Selection;
  refine?: RefineSpec<EntityRow>;
  sizing?: LayerSizing;
};

export const ENTITY_VIEWS: Readonly<Record<string, EntityView>> = {
  aircraft: {
    markers: aircraftMarkers,
    selection: aircraftSelection,
    refine: aircraftRefine,
    sizing: aircraftSizing,
  },
  ports: {
    markers: portMarkers,
    selection: portSelection,
    refine: portRefine,
  },
};

export function controlsFor(
  moduleId: string,
): readonly RefineControl[] | undefined {
  const spec = ENTITY_VIEWS[moduleId]?.refine ?? MODULE_VIEWS[moduleId]?.refine;
  return spec && spec.controls.length > 0 ? spec.controls : undefined;
}

export function entitySelectionFor(
  moduleId: string,
  detail: EntityDetail,
  nowMs: number,
  options: StarOptions,
): Selection {
  const view = ENTITY_VIEWS[moduleId];
  return view
    ? view.selection(detail, nowMs, options)
    : entitySelection(detail, nowMs, options);
}
