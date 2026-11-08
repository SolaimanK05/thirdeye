import { create } from "zustand";
import type { ClusterInfo } from "@/components/console/markers";
import type { LatLon } from "@/components/console/types";

export type SelectedItem =
  | { kind: "event"; id: string; moduleId: string; cluster?: ClusterInfo }
  | { kind: "entity"; id: string; moduleId: string };

type SelectionState = {
  selected: SelectedItem | null;
  focus: { at: LatLon; nonce: number } | null;
  following: boolean;
  select: (item: SelectedItem | null) => void;
  focusOn: (at: LatLon) => void;
  toggleFollow: () => void;
  stopFollowing: () => void;
};

export const useSelection = create<SelectionState>()((set) => ({
  selected: null,
  focus: null,
  following: false,
  select: (item) =>
    set((state) => ({
      selected: item,
      following:
        state.following &&
        item?.kind === "entity" &&
        state.selected?.id === item.id,
    })),
  focusOn: (at) =>
    set((state) => ({
      focus: { at, nonce: (state.focus?.nonce ?? 0) + 1 },
      following: false,
    })),
  toggleFollow: () =>
    set((state) => ({
      following: state.selected?.kind === "entity" && !state.following,
    })),
  stopFollowing: () =>
    set((state) => (state.following ? { following: false } : state)),
}));
