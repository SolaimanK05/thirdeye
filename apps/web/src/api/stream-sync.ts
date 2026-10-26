import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queries";
import type { StreamOptions, StreamStatus } from "./stream";

export const STREAM_PATH = "/v1/stream";

export function streamHandlers(
  queryClient: QueryClient,
  onStatus: (status: StreamStatus) => void,
): Pick<StreamOptions, "onStatus" | "onLayer" | "onResync"> {
  return {
    onStatus,
    onLayer: (moduleId) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.layerOf(moduleId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.modules });
    },
    onResync: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.layers });
      void queryClient.invalidateQueries({ queryKey: queryKeys.modules });
    },
  };
}
