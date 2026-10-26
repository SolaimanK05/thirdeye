import { create } from "zustand";

export type RefineStat = { kept: number; total: number };

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
