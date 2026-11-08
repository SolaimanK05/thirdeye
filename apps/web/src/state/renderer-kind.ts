import { create } from "zustand";
import type { RendererKind } from "@/modules/draw-limit";

type RendererKindState = {
  kind: RendererKind;
  setKind: (kind: RendererKind) => void;
};

/** Which renderer the marker overlay is using now; the draw limit's default follows it. */
export const useRendererKind = create<RendererKindState>()((set, get) => ({
  kind: "webgl2",
  setKind: (kind) => {
    if (get().kind !== kind) set({ kind });
  },
}));
