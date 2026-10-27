import { create } from "zustand";
import type { LatLon } from "@/components/console/types";

export type MotionMode = "interpolated" | "extrapolated";

type MotionStatus = {
  modes: Readonly<Record<string, MotionMode>>;
  setMode: (moduleId: string, mode: MotionMode | null) => void;
};

export const useMotionStatus = create<MotionStatus>()((set) => ({
  modes: {},
  setMode: (moduleId, mode) =>
    set((state) => {
      if (mode === null) {
        if (!(moduleId in state.modes)) return state;
        const { [moduleId]: _gone, ...rest } = state.modes;
        return { modes: rest };
      }
      return state.modes[moduleId] === mode
        ? state
        : { modes: { ...state.modes, [moduleId]: mode } };
    }),
}));

type Probe = (moduleId: string, id: string) => LatLon | null;

let probe: Probe | null = null;

export function setMotionProbe(next: Probe | null): void {
  probe = next;
}

export function renderedPosition(moduleId: string, id: string): LatLon | null {
  return probe?.(moduleId, id) ?? null;
}
