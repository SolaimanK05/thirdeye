import type { EventRow } from "@/api/client";
import type { RefineSpec } from "../refine";

export const fireRefine: RefineSpec<EventRow> = {
  controls: [
    {
      kind: "level",
      id: "power",
      label: "FIRE POWER",
      short: "FRP",
      stops: [0, 3, 10, 30, 100, 300],
      initial: 0,
      format: (megawatts) => `${megawatts} MW+`,
      target: "server",
    },
  ],
  read: {},
};
