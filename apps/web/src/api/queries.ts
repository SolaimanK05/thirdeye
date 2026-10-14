"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  api,
  type EventDetail,
  type Layer,
  type ModuleInfo,
  unwrap,
} from "./client";

export type LayerQuery = {
  bbox: string;
  cell: number | null;
  minSeverity: number;
};

const SECOND = 1000;
const MODULES_REFRESH = 30 * SECOND;

export const queryKeys = {
  modules: ["modules"] as const,
  layer: (moduleId: string, query: LayerQuery | null) =>
    [
      "layer",
      moduleId,
      query?.bbox ?? null,
      query?.cell ?? null,
      query?.minSeverity ?? null,
    ] as const,
  event: (eventId: string) => ["event", eventId] as const,
};

export function useModules() {
  return useQuery({
    queryKey: queryKeys.modules,
    queryFn: async ({ signal }): Promise<ModuleInfo[]> =>
      unwrap(await api.GET("/v1/modules", { signal })),
    staleTime: MODULES_REFRESH,
    refetchInterval: MODULES_REFRESH,
  });
}

function params(query: LayerQuery) {
  return {
    bbox: query.bbox,
    ...(query.cell === null ? {} : { cell: query.cell }),
    ...(query.minSeverity > 0 ? { min_severity: query.minSeverity } : {}),
  };
}

export function useLayer(
  moduleId: string,
  cadenceSeconds: number,
  layerQuery: LayerQuery | null = null,
) {
  const refresh = Math.max(cadenceSeconds, 15) * SECOND;
  return useQuery({
    queryKey: queryKeys.layer(moduleId, layerQuery),
    queryFn: async ({ signal }): Promise<Layer> =>
      unwrap(
        await api.GET("/v1/layers/{module_id}", {
          params: {
            path: { module_id: moduleId },
            query: layerQuery === null ? undefined : params(layerQuery),
          },
          signal,
        }),
      ),
    placeholderData: keepPreviousData,
    staleTime: refresh,
    refetchInterval: cadenceSeconds > 0 ? refresh : false,
  });
}

export function useEvent(eventId: string | null) {
  return useQuery({
    queryKey: queryKeys.event(eventId ?? ""),
    queryFn: async ({ signal }): Promise<EventDetail> =>
      unwrap(
        await api.GET("/v1/events/{event_id}", {
          params: { path: { event_id: eventId ?? "" } },
          signal,
        }),
      ),
    enabled: eventId !== null,
    staleTime: 60 * SECOND,
  });
}
