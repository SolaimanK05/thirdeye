import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import type { Filter } from "@/components/console/types";

export const FILTERS: readonly Filter[] = ["all", "starred", "none"];

export const isFilter = (value: unknown): value is Filter =>
  typeof value === "string" && FILTERS.some((filter) => filter === value);

export function sanitiseFilters(value: unknown): Record<string, Filter> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, Filter] =>
      isFilter(entry[1]),
    ),
  );
}

type FiltersState = {
  filters: Record<string, Filter>;
  setFilter: (moduleId: string, filter: Filter) => void;
  setFilters: (moduleIds: readonly string[], filter: Filter) => void;
};

export const FILTERS_STORAGE_KEY = "thirdeye.filters";

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

export const useFilters = create<FiltersState>()(
  persist(
    (set) => ({
      filters: {},
      setFilter: (moduleId, filter) =>
        set((state) => ({ filters: { ...state.filters, [moduleId]: filter } })),
      setFilters: (moduleIds, filter) =>
        set((state) => ({
          filters: {
            ...state.filters,
            ...Object.fromEntries(moduleIds.map((id) => [id, filter])),
          },
        })),
    }),
    {
      name: FILTERS_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: ({ filters }) => ({ filters }),
      merge: (persisted, current) => ({
        ...current,
        filters: sanitiseFilters(
          typeof persisted === "object" && persisted !== null
            ? (persisted as { filters?: unknown }).filters
            : undefined,
        ),
      }),
    },
  ),
);
