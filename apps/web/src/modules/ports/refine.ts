import type { EntityRow } from "@/api/client";
import type { RefineSpec } from "../refine";

const SIZES = [
  { value: "L", label: "LARGE" },
  { value: "M", label: "MEDIUM" },
  { value: "S", label: "SMALL" },
  { value: "V", label: "VERY SMALL" },
] as const;

export const portRefine: RefineSpec<EntityRow> = {
  controls: [
    {
      kind: "choices",
      id: "harbour",
      label: "HARBOUR SIZE",
      short: "SIZE",
      options: SIZES,
      initial: SIZES.map((size) => size.value),
    },
  ],
  read: {
    harbour: (row) => {
      const size = row.attrs.harbor_size;
      return typeof size === "string" ? size : null;
    },
  },
};
