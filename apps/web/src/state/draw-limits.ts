import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import {
  type DrawLimit,
  resolveLimit,
  sanitiseLimits,
} from "@/modules/draw-limit";
import { useRendererKind } from "./renderer-kind";

export const DRAW_LIMITS_STORAGE_KEY = "thirdeye.drawLimits";

type DrawLimitsState = {
  limits: Record<string, DrawLimit>;
  setLimit: (moduleId: string, limit: DrawLimit) => void;
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

export const useDrawLimits = create<DrawLimitsState>()(
  persist(
    (set) => ({
      limits: {},
      setLimit: (moduleId, limit) =>
        set((state) => ({ limits: { ...state.limits, [moduleId]: limit } })),
      reset: (moduleId) =>
        set((state) => {
          const { [moduleId]: _dropped, ...rest } = state.limits;
          return { limits: rest };
        }),
    }),
    {
      name: DRAW_LIMITS_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: ({ limits }) => ({ limits }),
      merge: (persisted, current) => ({
        ...current,
        limits: sanitiseLimits(
          typeof persisted === "object" && persisted !== null
            ? (persisted as { limits?: unknown }).limits
            : undefined,
        ),
      }),
    },
  ),
);

/** The limit in force for a module: the saved choice, else the renderer's default. */
export function useDrawLimit(moduleId: string): {
  limit: DrawLimit;
  chosen: boolean;
} {
  const limits = useDrawLimits((state) => state.limits);
  const kind = useRendererKind((state) => state.kind);
  return {
    limit: resolveLimit(limits, moduleId, kind),
    chosen: moduleId in limits,
  };
}
