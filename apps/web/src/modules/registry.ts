import type { EventDetail, EventRow } from "@/api/client";
import type { ClusterInfo, Marker } from "@/components/console/markers";
import type { Selection } from "@/components/console/types";
import { quakeMarkers } from "./earthquakes/render";
import { quakeSelection } from "./earthquakes/selection";
import { genericSelection } from "./generic";
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
