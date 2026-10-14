import type { EventDetail, EventRow } from "@/api/client";
import type { Marker } from "@/components/console/markers";
import type { Selection } from "@/components/console/types";
import { quakeMarkers } from "./earthquakes/render";
import { quakeSelection } from "./earthquakes/selection";
import { genericSelection } from "./generic";

export type ModuleView = {
  markers: (rows: readonly EventRow[]) => Marker[];
  selection: (detail: EventDetail, nowMs: number) => Selection;
};

export const MODULE_VIEWS: Readonly<Record<string, ModuleView>> = {
  earthquakes: { markers: quakeMarkers, selection: quakeSelection },
};

export function selectionFor(detail: EventDetail, nowMs: number): Selection {
  const view = MODULE_VIEWS[detail.module_id];
  return view ? view.selection(detail, nowMs) : genericSelection(detail, nowMs);
}
