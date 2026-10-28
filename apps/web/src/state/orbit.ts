import { create } from "zustand";
import type { OrbitSample } from "@/modules/satellites/propagator";

type OrbitState = {
  sample: OrbitSample | null;
  publish: (sample: OrbitSample | null) => void;
};

export const useOrbit = create<OrbitState>()((set, get) => ({
  sample: null,
  publish: (sample) => {
    const current = get().sample;
    if (current === sample) return;
    if (current === null || sample === null || current.atMs !== sample.atMs) {
      set({ sample });
    }
  },
}));
