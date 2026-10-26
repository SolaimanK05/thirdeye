"use client";

import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { API_URL } from "@/api/client";
import { startStream } from "@/api/stream";
import { STREAM_PATH, streamHandlers } from "@/api/stream-sync";
import { useStreamStatus } from "@/state/stream";

const STREAM_URL = `${API_URL}${STREAM_PATH}?entities=`;

function StreamConnection() {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const { setStatus } = useStreamStatus.getState();
    const stop = startStream({
      url: STREAM_URL,
      ...streamHandlers(queryClient, setStatus),
    });
    return () => {
      stop();
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
