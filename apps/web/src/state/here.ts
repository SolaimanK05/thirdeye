import { create } from "zustand";

/**
 * How many items of a hidden module are in the current view, for the rail's
 * "hidden, N here" and the satellites notice. The overlay counts drawn layers
 * itself; this holds the counts of the layers that are not drawn.
 */
type HereState = {
  counts: Readonly<Record<string, number>>;
  setCount: (moduleId: string, count: number | null) => void;
};

export const useHere = create<HereState>()((set) => ({
  counts: {},
  setCount: (moduleId, count) =>
    set((state) => {
      if (count === null) {
        if (!(moduleId in state.counts)) return state;
        const { [moduleId]: _gone, ...rest } = state.counts;
        return { counts: rest };
      }
      return state.counts[moduleId] === count
        ? state
        : { counts: { ...state.counts, [moduleId]: count } };
    }),
}));
