"use client";

import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { API_URL } from "@/api/client";
import { queryKeys } from "@/api/queries";
import { startStream } from "@/api/stream";
import { STREAM_PATH, streamHandlers } from "@/api/stream-sync";
import { createDataWorker } from "@/data/create-worker";
import { DataHub } from "@/data/hub";
import { useDataRuntime } from "@/data/runtime";
import { readFlags } from "@/perf/params";
import { useSelection } from "@/state/selection";
import { useServerClock, useStreamStatus } from "@/state/stream";

const STREAM_URL = `${API_URL}${STREAM_PATH}`;

function createHub(): DataHub | null {
  if (typeof Worker === "undefined") return null;
  if (!readFlags(window.location.search).worker) return null;
  try {
    const hub = new DataHub(createDataWorker());
    hub.start({
      apiUrl: API_URL,
      movers: [],
      clockOffsetMs: useServerClock.getState().offsetMs,
      feed: "segments",
    });
    return hub;
  } catch {
    return null;
  }
}

function StreamConnection() {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const { setStatus } = useStreamStatus.getState();
    const hub = createHub();
    const { set: setRuntime } = useDataRuntime.getState();
    setRuntime(hub ? { mode: "worker", hub } : { mode: "legacy", hub: null });
    const handlers = streamHandlers(queryClient, setStatus);
    const unclock = hub
      ? useServerClock.subscribe((state, previous) => {
          if (state.offsetMs !== previous.offsetMs) {
            hub.setClock(state.offsetMs);
          }
        })
      : null;
    const stop = startStream({
      // A worker client gets entity data as binary frames, so it asks the
      // stream for no JSON snapshots and deltas at all.
      url: hub ? `${STREAM_URL}?entities=` : STREAM_URL,
      ...handlers,
      onNotice: hub
        ? (moduleId, version) => {
            hub.notice(moduleId, version);
            const selected = useSelection.getState().selected;
            if (selected?.kind === "entity" && selected.moduleId === moduleId) {
              void queryClient.invalidateQueries({
                queryKey: queryKeys.entity(selected.id),
              });
            }
          }
        : undefined,
      onResync: () => {
        handlers.onResync();
        hub?.resync();
      },
    });
    return () => {
      stop();
      unclock?.();
      hub?.destroy();
      setRuntime({ mode: "pending", hub: null });
      setStatus("connecting");
    };
  }, [queryClient]);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 2, refetchOnWindowFocus: true },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <StreamConnection />
      {children}
    </QueryClientProvider>
  );
}
