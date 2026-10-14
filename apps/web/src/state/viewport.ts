import { create } from "zustand";

export type ViewBox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

type ViewportState = {
  box: ViewBox | null;
  setBox: (box: ViewBox | null) => void;
};

function sameBox(a: ViewBox | null, b: ViewBox | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.west === b.west &&
    a.south === b.south &&
    a.east === b.east &&
    a.north === b.north
  );
}

export const useViewport = create<ViewportState>()((set, get) => ({
  box: null,
  setBox: (box) => {
    if (!sameBox(get().box, box)) set({ box });
  },
}));
