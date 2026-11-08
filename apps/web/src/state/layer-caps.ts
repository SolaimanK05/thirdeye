import { create } from "zustand";

export type LayerCap = { shown: number; matched: number };

type LayerCapsState = {
  caps: Readonly<Record<string, LayerCap>>;
  setCap: (moduleId: string, cap: LayerCap | null) => void;
};

export const useLayerCaps = create<LayerCapsState>()((set, get) => ({
  caps: {},
  setCap: (moduleId, cap) => {
    const current = get().caps[moduleId];
    if (
      current?.shown === cap?.shown &&
      current?.matched === cap?.matched &&
      (current === undefined) === (cap === null)
    ) {
      return;
    }
    set((state) => {
      const { [moduleId]: _dropped, ...rest } = state.caps;
      return { caps: cap === null ? rest : { ...rest, [moduleId]: cap } };
    });
  },
}));
