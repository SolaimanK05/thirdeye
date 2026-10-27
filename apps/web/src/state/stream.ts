import { create } from "zustand";
import type { StreamStatus } from "@/api/stream";

type StreamState = {
  status: StreamStatus;
  setStatus: (status: StreamStatus) => void;
};

export const useStreamStatus = create<StreamState>()((set, get) => ({
  status: "connecting",
  setStatus: (status) => {
    if (get().status !== status) set({ status });
  },
}));

export const streamIsLive = (state: StreamState): boolean =>
  state.status === "live";

type ServerClock = {
  offsetMs: number;
  synced: boolean;
  sync: (serverTimeMs: number, clientTimeMs: number) => void;
  reset: () => void;
};

export const useServerClock = create<ServerClock>()((set) => ({
  offsetMs: 0,
  synced: false,
  sync: (serverTimeMs, clientTimeMs) =>
    set({ offsetMs: serverTimeMs - clientTimeMs, synced: true }),
  reset: () => set({ offsetMs: 0, synced: false }),
}));

export function serverNowMs(clientNowMs: number = Date.now()): number {
  return clientNowMs + useServerClock.getState().offsetMs;
}
