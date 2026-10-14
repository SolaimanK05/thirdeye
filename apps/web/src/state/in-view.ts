import { create } from "zustand";

type InViewState = {
  counts: Readonly<Record<string, number>>;
  setCounts: (counts: Readonly<Record<string, number>>) => void;
};

export const useInView = create<InViewState>()((set) => ({
  counts: {},
  setCounts: (counts) => set({ counts }),
}));
