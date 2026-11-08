import type { QueryClient } from "@tanstack/react-query";
import { type EntityStore, entityStore } from "@/state/entities";
import { useSelection } from "@/state/selection";
import { useServerClock } from "@/state/stream";
import type { ModuleInfo } from "./client";
import { queryKeys } from "./queries";
import type { StreamOptions, StreamStatus } from "./stream";

export const STREAM_PATH = "/v1/stream";

type Handlers = Pick<
  StreamOptions,
  | "onStatus"
  | "onLayer"
  | "onResync"
  | "onSnapshot"
  | "onDelta"
  | "onServerTime"
>;

export function streamHandlers(
  queryClient: QueryClient,
  onStatus: (status: StreamStatus) => void,
  store: EntityStore = entityStore,
): Handlers {
  const isEntityModule = (moduleId: unknown): boolean =>
    queryClient
      .getQueryData<ModuleInfo[]>(queryKeys.modules)
      ?.some(
        (module) => module.id === moduleId && module.kind === "entities",
      ) ?? false;

  return {
    onStatus,
    onServerTime: (serverTimeMs) =>
      useServerClock.getState().sync(serverTimeMs, Date.now()),
    onLayer: (moduleId) => {
      if (!isEntityModule(moduleId)) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.layerOf(moduleId),
        });
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.elementsOf(moduleId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.modules });
    },
    onResync: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.layers,
        predicate: (query) => !isEntityModule(query.queryKey[1]),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.computed });
      void queryClient.invalidateQueries({ queryKey: queryKeys.modules });
    },
    onSnapshot: (snapshot) => {
      store.applySnapshot(
        snapshot.moduleId,
        snapshot.entities,
        snapshot.fetchedAt,
        snapshot.version,
      );
    },
    onDelta: (delta) => {
      const applied = store.applyDelta(
        delta.moduleId,
        delta.upserts,
        delta.removes,
        delta.fetchedAt,
        delta.version,
      );
      if (!applied) return;
      const selected = useSelection.getState().selected;
      if (
        selected?.kind === "entity" &&
        selected.moduleId === delta.moduleId &&
        delta.upserts.some((row) => row.id === selected.id)
      ) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.entity(selected.id),
        });
      }
    },
  };
}
