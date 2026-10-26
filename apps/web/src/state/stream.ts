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
