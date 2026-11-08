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
import { NOTABLE_MAGNITUDE, quakeMarkers } from "./earthquakes/render";
import { quakeSelection } from "./earthquakes/selection";
import { entitySelection, type StarOptions } from "./entity";
import { genericSelection } from "./generic";
import { entityImportance, eventImportance } from "./importance";
import { portRefine } from "./ports/refine";
import { portMarkers } from "./ports/render";
import { portSelection } from "./ports/selection";
import type { RefineControl, RefineSpec } from "./refine";
import {
  SATELLITE_MAX_ZOOM_PERCENT,
  satelliteSizing,
} from "./satellites/render";
import { satelliteSelection } from "./satellites/selection";
import { type SatelliteTraits, satelliteRefine } from "./satellites/traits";
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
  /** How much a marker matters when a draw limit leaves some out; higher is kept first. */
  importance?: (row: EventRow) => number;
  /** The lowest severity drawn at a zoom level (earthquakes: M5 and up at ORBIT). */
  minSeverityAt?: Readonly<Partial<Record<ZoomLevel, number>>>;
};

export const MODULE_VIEWS: Readonly<Record<string, ModuleView>> = {
  earthquakes: {
    markers: quakeMarkers,
    selection: quakeSelection,
    refine: quakeRefine,
    importance: eventImportance.earthquakes,
    minSeverityAt: { 1: NOTABLE_MAGNITUDE },
  },
  wildfires: {
    markers: fireMarkers,
    selection: fireSelection,
    refine: fireRefine,
    importance: eventImportance.wildfires,
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
  importance?: (row: EntityRow) => number;
  sizing?: LayerSizing;
  history?: (fixes: readonly FixOut[]) => SelectionChart | undefined;
};

export type StoredEntityView = EntityViewBase & {
  computed?: false;
  refine?: RefineSpec<EntityRow>;
  /** How the data worker's columns are drawn; present for modules sent as binary frames. */
  columnar?: (context: { level: ZoomLevel }) => ColumnarStyle;
  markers: (
    rows: readonly EntityRow[],
    context: { level: ZoomLevel },
  ) => Marker[];
};

export type ComputedEntityView = EntityViewBase & {
  computed: true;
  /** Read from each element set in the browser, since there are no stored rows. */
  refine?: RefineSpec<SatelliteTraits>;
  maxZoomPercent?: number;
};

export type EntityView = StoredEntityView | ComputedEntityView;

export const ENTITY_VIEWS: Readonly<Record<string, EntityView>> = {
  aircraft: {
    markers: aircraftMarkers,
    selection: aircraftSelection,
    refine: aircraftRefine,
    importance: entityImportance.aircraft,
    sizing: aircraftSizing,
    columnar: aircraftStyle,
  },
  vessels: {
    markers: vesselMarkers,
    selection: vesselSelection,
    refine: vesselRefine,
    importance: entityImportance.vessels,
    sizing: vesselSizing,
    columnar: vesselStyle,
    history: speedHistory,
  },
  ports: {
    markers: portMarkers,
    selection: portSelection,
    refine: portRefine,
    importance: entityImportance.ports,
  },
  satellites: {
    computed: true,
    maxZoomPercent: SATELLITE_MAX_ZOOM_PERCENT,
    selection: satelliteSelection,
    sizing: satelliteSizing,
    refine: satelliteRefine,
  },
};

/** The singular noun for what a module draws, by module id. */
export const TYPE_LABEL: Readonly<Record<string, string>> = {
  aircraft: "Aircraft",
  vessels: "Vessel",
  ports: "Port",
  satellites: "Satellite",
  earthquakes: "Earthquake",
  wildfires: "Wildfire",
};

/** What one item of a module is called; a module nobody named uses `fallback`, else its id. */
export function typeLabelOf(moduleId: string, fallback?: string): string {
  return TYPE_LABEL[moduleId] ?? fallback ?? moduleId;
}

/** The zoom percent above which a module hides itself, by module id. */
export const ZOOM_CAPS: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(ENTITY_VIEWS).flatMap(([id, view]) =>
    view.computed && view.maxZoomPercent !== undefined
      ? [[id, view.maxZoomPercent] as const]
      : [],
  ),
);

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
