import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";

export type LocalStar = { id: string; moduleId: string; name: string };

export const STARS_STORAGE_KEY = "thirdeye.stars";
export const MAX_LOCAL_STARS = 500;

const NAME_LIMIT = 200;

export function sanitiseStars(value: unknown): Record<string, LocalStar> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const stars: Record<string, LocalStar> = {};
  for (const entry of Object.values(value)) {
    if (Object.keys(stars).length >= MAX_LOCAL_STARS) break;
    if (typeof entry !== "object" || entry === null) continue;
    const { id, moduleId, name } = entry as Record<string, unknown>;
    if (
      typeof id === "string" &&
      id !== "" &&
      typeof moduleId === "string" &&
      moduleId !== "" &&
      typeof name === "string"
    ) {
      stars[id] = { id, moduleId, name: name.slice(0, NAME_LIMIT) };
    }
  }
  return stars;
}

type StarsState = {
  stars: Record<string, LocalStar>;
  noteSeen: boolean;
  noteOpen: boolean;
  toggle: (star: LocalStar) => void;
  remove: (id: string) => void;
  dismissNote: () => void;
};

const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      return;
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch {
      return;
    }
  },
};

export const useStars = create<StarsState>()(
  persist(
    (set) => ({
      stars: {},
      noteSeen: false,
      noteOpen: false,
      toggle: (star) =>
        set((state) => {
          if (state.stars[star.id]) {
            const { [star.id]: _removed, ...rest } = state.stars;
            return { stars: rest };
          }
          if (Object.keys(state.stars).length >= MAX_LOCAL_STARS) return state;
          return {
            stars: {
              ...state.stars,
              [star.id]: { ...star, name: star.name.slice(0, NAME_LIMIT) },
            },
            noteSeen: true,
            noteOpen: state.noteOpen || !state.noteSeen,
          };
        }),
      remove: (id) =>
        set((state) => {
          if (!state.stars[id]) return state;
          const { [id]: _removed, ...rest } = state.stars;
          return { stars: rest };
        }),
      dismissNote: () => set({ noteOpen: false }),
    }),
    {
      name: STARS_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: ({ stars, noteSeen }) => ({ stars, noteSeen }),
      merge: (persisted, current) => {
        const saved =
          typeof persisted === "object" && persisted !== null
            ? (persisted as { stars?: unknown; noteSeen?: unknown })
            : {};
        return {
          ...current,
          stars: sanitiseStars(saved.stars),
          noteSeen: saved.noteSeen === true,
        };
      },
    },
  ),
);
