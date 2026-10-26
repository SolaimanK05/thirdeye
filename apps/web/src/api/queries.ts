"use client";

import {
  keepPreviousData,
  type MutationOptions,
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { streamIsLive, useStreamStatus } from "@/state/stream";
import {
  ApiRequestError,
  api,
  type EntityDetail,
  type EventDetail,
  type Layer,
  type ModuleInfo,
  type SearchResults,
  unwrap,
  type Watchlist,
} from "./client";
import { type StarTarget, withStar } from "./watchlist";

export type LayerQuery = {
  bbox: string;
  cell: number | null;
  minSeverity: number;
};

const SECOND = 1000;
const MIN_REFRESH_SECONDS = 15;
const MAX_REFRESH_SECONDS = 3600;
const MODULES_REFRESH = 30 * SECOND;

export const queryKeys = {
  modules: ["modules"] as const,
  layers: ["layer"] as const,
  layerOf: (moduleId: string) => ["layer", moduleId] as const,
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

export function refreshSeconds(cadenceSeconds: number): number {
  return Math.min(
    Math.max(cadenceSeconds, MIN_REFRESH_SECONDS),
    MAX_REFRESH_SECONDS,
  );
}

export function layerRefetchInterval(
  cadenceSeconds: number,
  live: boolean,
): number | false {
  return cadenceSeconds > 0 && !live
    ? refreshSeconds(cadenceSeconds) * SECOND
    : false;
}

export function useLayer(
  moduleId: string,
  cadenceSeconds: number,
  layerQuery: LayerQuery | null = null,
) {
  const refresh = refreshSeconds(cadenceSeconds) * SECOND;
  const live = useStreamStatus(streamIsLive);
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
    refetchInterval: layerRefetchInterval(cadenceSeconds, live),
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

const ENTITY_RETRIES = 2;

export function entityQueryOptions(entityId: string | null) {
  return queryOptions({
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
    retry: (failures: number, error: Error) =>
      !(error instanceof ApiRequestError && error.status === 404) &&
      failures < ENTITY_RETRIES,
  });
}

export function useEntity(entityId: string | null) {
  return useQuery(entityQueryOptions(entityId));
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

export type StarVariables = { target: StarTarget; starred: boolean };
export type StarContext = { previous: Watchlist | undefined };

export function starMutationOptions(
  queryClient: QueryClient,
): MutationOptions<void, Error, StarVariables, StarContext> {
  return {
    mutationFn: async ({ target, starred }) => {
      const params = { params: { path: { entity_id: target.id } } };
      const result = starred
        ? await api.PUT("/v1/watchlist/{entity_id}", params)
        : await api.DELETE("/v1/watchlist/{entity_id}", params);
      if (!result.response.ok) {
        unwrap({ error: result.error, response: result.response });
      }
    },
    onMutate: async ({ target, starred }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.watchlist });
      const previous = queryClient.getQueryData<Watchlist>(queryKeys.watchlist);
      if (previous) {
        queryClient.setQueryData<Watchlist>(
          queryKeys.watchlist,
          withStar(previous, target, starred, new Date().toISOString()),
        );
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.watchlist, context.previous);
      }
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.watchlist }),
  };
}

export function useStarEntity() {
  const queryClient = useQueryClient();
  return useMutation(starMutationOptions(queryClient));
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
