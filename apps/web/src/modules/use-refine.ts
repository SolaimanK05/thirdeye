import { useMemo } from "react";
import { useRefine } from "@/state/refine";
import { type RefineControl, type RefineValues, resolveValues } from "./refine";
import { controlsFor } from "./registry";

const NO_CONTROLS: readonly RefineControl[] = [];

export function useRefineValues(moduleId: string): {
  controls: readonly RefineControl[];
  values: RefineValues;
} {
  const controls = controlsFor(moduleId) ?? NO_CONTROLS;
  const stored = useRefine((state) => state.stored[moduleId]);
  const values = useMemo(
    () => resolveValues(controls, stored),
    [controls, stored],
  );
  return { controls, values };
}
