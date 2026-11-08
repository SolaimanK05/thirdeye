import { create } from "zustand";
import type { DataHub } from "./hub";

/**
 * Whether movers run through the data worker. "pending" lasts until the page
 * has decided, so the layers do not start on the JSON path and then switch.
 */
type Runtime =
  | { mode: "pending"; hub: null }
  | { mode: "legacy"; hub: null }
  | { mode: "worker"; hub: DataHub };

type RuntimeStore = Runtime & {
  set: (runtime: Runtime) => void;
};

export const useDataRuntime = create<RuntimeStore>()((set) => ({
  mode: "pending",
  hub: null,
  set: (runtime) => set(runtime),
}));
