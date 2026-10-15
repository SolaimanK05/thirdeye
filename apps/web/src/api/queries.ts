"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  api,
  type EntityDetail,
  type EventDetail,
  type Layer,
  type ModuleInfo,
  type SearchResults,
  unwrap,
  type Watchlist,
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
  entity: (entityId: string) => ["entity", entityId] as const,
  watchlist: ["watchlist"] as const,
  search: (text: string) => ["search", text] as const,
};

export const MIN_SEARCH_LENGTH = 2;

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

export function useEntity(entityId: string | null) {
  return useQuery({
    queryKey: queryKeys.entity(entityId ?? ""),
    queryFn: async ({ signal }): Promise<EntityDetail> =>
      unwrap(
        await api.GET("/v1/entities/{entity_id}", {
          params: { path: { entity_id: entityId ?? "" } },
          signal,
        }),
      ),
    enabled: entityId !== null,
    staleTime: 60 * SECOND,
  });
}

export function useWatchlist() {
  return useQuery({
    queryKey: queryKeys.watchlist,
    queryFn: async ({ signal }): Promise<Watchlist> =>
      unwrap(await api.GET("/v1/watchlist", { signal })),
    staleTime: MODULES_REFRESH,
    refetchInterval: MODULES_REFRESH,
  });
}

export function useStarEntity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      entityId,
      starred,
    }: {
      entityId: string;
      starred: boolean;
    }) => {
      const params = { params: { path: { entity_id: entityId } } };
      const result = starred
        ? await api.PUT("/v1/watchlist/{entity_id}", params)
        : await api.DELETE("/v1/watchlist/{entity_id}", params);
      if (!result.response.ok) {
        unwrap({ error: result.error, response: result.response });
      }
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.watchlist }),
        queryClient.invalidateQueries({ queryKey: ["search"] }),
      ]),
  });
}

export function useSearch(text: string) {
  return useQuery({
    queryKey: queryKeys.search(text),
    queryFn: async ({ signal }): Promise<SearchResults> =>
      unwrap(
        await api.GET("/v1/search", { params: { query: { q: text } }, signal }),
      ),
    enabled: text.length >= MIN_SEARCH_LENGTH,
    staleTime: 15 * SECOND,
  });
}
