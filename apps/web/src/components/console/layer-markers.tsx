"use client";

import { useEffect } from "react";
import type { ModuleInfo } from "@/api/client";
import { useLayer, useModules } from "@/api/queries";
import { MODULE_VIEWS } from "@/modules/registry";
import { useConsole } from "./console-shell";
import type { MarkerOverlay } from "./marker-overlay";
import { zoomLevelFor } from "./zoom";

type Props = { overlay: MarkerOverlay };

export function LayerMarkers({ overlay }: Props) {
  const { data: modules } = useModules();
  const drawable = (modules ?? []).filter(
    (module) => module.enabled && MODULE_VIEWS[module.id] !== undefined,
  );
  return drawable.map((module) => (
    <ModuleMarkers key={module.id} module={module} overlay={overlay} />
  ));
}

function ModuleMarkers({
  module,
  overlay,
}: {
  module: ModuleInfo;
  overlay: MarkerOverlay;
}) {
  const { data } = useLayer(module.id, module.cadence_seconds);
  const { zoomPercent } = useConsole();
  const level = zoomLevelFor(zoomPercent).level;
  const range = module.zoom_range;
  const inRange = range !== null && level >= range.min && level <= range.max;
  const stale = module.health.state === "stale";

  useEffect(() => {
    const view = MODULE_VIEWS[module.id];
    if (!view || !data || !inRange) {
      overlay.removeLayer(module.id);
      return;
    }
    overlay.setLayer(module.id, view.markers(data.rows), stale);
  }, [overlay, module.id, data, inRange, stale]);

  useEffect(() => () => overlay.removeLayer(module.id), [overlay, module.id]);

  return null;
}
