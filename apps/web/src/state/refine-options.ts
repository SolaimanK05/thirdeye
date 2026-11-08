import { create } from "zustand";

/** One value a pick control can offer, and how many things have it. */
export type PickOption = { value: string; label: string; count: number };

type OptionsState = {
  options: Readonly<
    Record<string, Readonly<Record<string, readonly PickOption[]>>>
  >;
  setOptions: (
    moduleId: string,
    options: Readonly<Record<string, readonly PickOption[]>>,
  ) => void;
};

export const useRefineOptions = create<OptionsState>()((set) => ({
  options: {},
  setOptions: (moduleId, options) =>
    set((state) => ({ options: { ...state.options, [moduleId]: options } })),
}));

const NONE: readonly PickOption[] = [];

export function usePickOptions(
  moduleId: string,
  controlId: string,
): readonly PickOption[] {
  return useRefineOptions(
    (state) => state.options[moduleId]?.[controlId] ?? NONE,
  );
}
