import { create } from "zustand";
import type { ZoomLevel } from "@/components/console/types";

/**
 * Modules the user asked to see here with SHOW HERE: they draw what is in the
 * current view even though the zoom is outside their range. A pin remembers
 * the level it was made at, for the rail note, and goes away on AUTO or when
 * the zoom comes back into the module's range.
 */
type PinState = {
  pins: Readonly<Record<string, ZoomLevel>>;
  pin: (moduleId: string, level: ZoomLevel) => void;
  unpin: (moduleId: string) => void;
};

export const usePins = create<PinState>()((set) => ({
  pins: {},
  pin: (moduleId, level) =>
    set((state) =>
      state.pins[moduleId] === level
        ? state
        : { pins: { ...state.pins, [moduleId]: level } },
    ),
  unpin: (moduleId) =>
    set((state) => {
      if (!(moduleId in state.pins)) return state;
      const { [moduleId]: _gone, ...rest } = state.pins;
      return { pins: rest };
    }),
}));
