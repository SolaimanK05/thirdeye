import { create } from "zustand";
import type { ClusterInfo } from "@/components/console/markers";
import type { LatLon } from "@/components/console/types";

export type SelectedItem = {
  kind: "event";
  id: string;
  moduleId: string;
  cluster?: ClusterInfo;
};

type SelectionState = {
  selected: SelectedItem | null;
  focus: { at: LatLon; nonce: number } | null;
  select: (item: SelectedItem | null) => void;
  focusOn: (at: LatLon) => void;
};

export const useSelection = create<SelectionState>()((set) => ({
  selected: null,
  focus: null,
  select: (item) => set({ selected: item }),
  focusOn: (at) =>
    set((state) => ({ focus: { at, nonce: (state.focus?.nonce ?? 0) + 1 } })),
}));
