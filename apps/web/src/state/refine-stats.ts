import { create } from "zustand";

/** `kept` pass the filter, `drawn` of them are on the globe after the draw limit. */
export type RefineStat = { kept: number; total: number; drawn: number };

type RefineStatsState = {
  stats: Readonly<Record<string, RefineStat>>;
  setStat: (moduleId: string, stat: RefineStat | null) => void;
};

export const useRefineStats = create<RefineStatsState>()((set, get) => ({
  stats: {},
  setStat: (moduleId, stat) => {
    const current = get().stats[moduleId];
    if (
      current?.kept === stat?.kept &&
      current?.total === stat?.total &&
      current?.drawn === stat?.drawn &&
      (current === undefined) === (stat === null)
    ) {
      return;
    }
    set((state) => {
      const { [moduleId]: _dropped, ...rest } = state.stats;
      return { stats: stat === null ? rest : { ...rest, [moduleId]: stat } };
    });
  },
}));
