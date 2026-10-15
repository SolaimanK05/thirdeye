import type {
  EntityDetail,
  EntityRow,
  EventDetail,
  EventRow,
} from "@/api/client";
import type { ClusterInfo, Marker } from "@/components/console/markers";
import type { Selection, ZoomLevel } from "@/components/console/types";
import { quakeMarkers } from "./earthquakes/render";
import { quakeSelection } from "./earthquakes/selection";
import { entitySelection, type StarOptions } from "./entity";
import { genericSelection } from "./generic";
import { portMarkers } from "./ports/render";
import { portSelection } from "./ports/selection";
import { fireMarkers } from "./wildfires/render";
import { fireSelection } from "./wildfires/selection";

export type ModuleView = {
  markers: (rows: readonly EventRow[]) => Marker[];
  selection: (
    detail: EventDetail,
    nowMs: number,
    cluster?: ClusterInfo,
  ) => Selection;
};

export const MODULE_VIEWS: Readonly<Record<string, ModuleView>> = {
  earthquakes: { markers: quakeMarkers, selection: quakeSelection },
  wildfires: { markers: fireMarkers, selection: fireSelection },
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
};

export const ENTITY_VIEWS: Readonly<Record<string, EntityView>> = {
  ports: { markers: portMarkers, selection: portSelection },
};

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
