import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import type { RefineValue } from "@/modules/refine";

export type StoredRefine = Readonly<
  Record<string, Readonly<Record<string, unknown>>>
>;

export const REFINE_STORAGE_KEY = "thirdeye.refine";

export function sanitiseStored(value: unknown): StoredRefine {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([moduleId, controls]) =>
      typeof controls === "object" &&
      controls !== null &&
      !Array.isArray(controls)
        ? [[moduleId, { ...controls }]]
        : [],
    ),
  );
}

type RefineState = {
  stored: StoredRefine;
  set: (moduleId: string, controlId: string, value: RefineValue) => void;
  reset: (moduleId: string) => void;
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

export const useRefine = create<RefineState>()(
  persist(
    (set) => ({
      stored: {},
      set: (moduleId, controlId, value) =>
        set((state) => ({
          stored: {
            ...state.stored,
            [moduleId]: { ...state.stored[moduleId], [controlId]: value },
          },
        })),
      reset: (moduleId) =>
        set((state) => {
          const { [moduleId]: _dropped, ...rest } = state.stored;
          return { stored: rest };
        }),
    }),
    {
      name: REFINE_STORAGE_KEY,
      version: 2,
      migrate: (persisted, version) => {
        const stored = sanitiseStored(
          typeof persisted === "object" && persisted !== null
            ? (persisted as { stored?: unknown }).stored
            : undefined,
        );
        if (version >= 2) return { stored };
        const { aircraft, ...rest } = stored;
        if (aircraft === undefined) return { stored: rest };
        const { altitude: _dropped, ...kept } = aircraft;
        return { stored: { ...rest, aircraft: kept } };
      },
      storage: createJSONStorage(() => safeStorage),
      partialize: ({ stored }) => ({ stored }),
      merge: (persisted, current) => ({
        ...current,
        stored: sanitiseStored(
          typeof persisted === "object" && persisted !== null
            ? (persisted as { stored?: unknown }).stored
            : undefined,
        ),
      }),
    },
  ),
);
