import type {
  EntityDetail,
  EntityRow,
  EventDetail,
  EventRow,
  FixOut,
} from "@/api/client";
import type { ColumnarStyle } from "@/components/console/layer-state";
import type {
  ClusterInfo,
  LayerSizing,
  Marker,
} from "@/components/console/markers";
import type {
  Selection,
  SelectionChart,
  ZoomLevel,
} from "@/components/console/types";
import { aircraftRefine } from "./aircraft/refine";
import {
  aircraftMarkers,
  aircraftSizing,
  aircraftStyle,
} from "./aircraft/render";
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
import {
  SATELLITE_MAX_ZOOM_PERCENT,
  satelliteSizing,
} from "./satellites/render";
import { satelliteSelection } from "./satellites/selection";
import { speedHistory } from "./vessels/history";
import { vesselRefine } from "./vessels/refine";
import { vesselMarkers, vesselSizing, vesselStyle } from "./vessels/render";
import { vesselSelection } from "./vessels/selection";
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

type EntityViewBase = {
  selection: (
    detail: EntityDetail,
    nowMs: number,
    options: StarOptions,
  ) => Selection;
  refine?: RefineSpec<EntityRow>;
  sizing?: LayerSizing;
  history?: (fixes: readonly FixOut[]) => SelectionChart | undefined;
};

export type StoredEntityView = EntityViewBase & {
  computed?: false;
  /** How the data worker's columns are drawn; present for modules sent as binary frames. */
  columnar?: (context: { level: ZoomLevel }) => ColumnarStyle;
  markers: (
    rows: readonly EntityRow[],
    context: { level: ZoomLevel },
  ) => Marker[];
};

export type ComputedEntityView = EntityViewBase & {
  computed: true;
  maxZoomPercent?: number;
};

export type EntityView = StoredEntityView | ComputedEntityView;

export const ENTITY_VIEWS: Readonly<Record<string, EntityView>> = {
  aircraft: {
    markers: aircraftMarkers,
    selection: aircraftSelection,
    refine: aircraftRefine,
    sizing: aircraftSizing,
    columnar: aircraftStyle,
  },
  vessels: {
    markers: vesselMarkers,
    selection: vesselSelection,
    refine: vesselRefine,
    sizing: vesselSizing,
    columnar: vesselStyle,
    history: speedHistory,
  },
  ports: {
    markers: portMarkers,
    selection: portSelection,
    refine: portRefine,
  },
  satellites: {
    computed: true,
    maxZoomPercent: SATELLITE_MAX_ZOOM_PERCENT,
    selection: satelliteSelection,
    sizing: satelliteSizing,
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
