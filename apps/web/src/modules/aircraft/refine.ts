import type { EntityRow } from "@/api/client";
import { formatCount } from "@/components/console/count";
import type { RefineSpec } from "../refine";

export const FEET_PER_METRE = 3.280839895;
export const METRES_PER_FOOT = 0.3048;
export const ALTITUDE_MAX_FT = 60_000;
export const DEFAULT_ALTITUDE_FT = 25_000;

export const aircraftRefine: RefineSpec<EntityRow> = {
  controls: [
    {
      kind: "range",
      id: "altitude",
      label: "ALTITUDE",
      short: "ALT",
      min: 0,
      max: ALTITUDE_MAX_FT,
      step: 1000,
      initial: [DEFAULT_ALTITUDE_FT, ALTITUDE_MAX_FT],
      unit: "ft",
      format: formatCount,
      secondary: {
        unit: "m",
        convert: (feet) => Math.round(feet * METRES_PER_FOOT),
      },
    },
  ],
  read: {
    altitude: (row) => {
      if (row.attrs.on_ground === true) return 0;
      return row.alt === null ? null : row.alt * FEET_PER_METRE;
    },
  },
};
