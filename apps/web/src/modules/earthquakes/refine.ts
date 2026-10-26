import type { EventRow } from "@/api/client";
import type { RefineSpec } from "../refine";

const HOUR_S = 3600;

export const quakeRefine: RefineSpec<EventRow> = {
  controls: [
    {
      kind: "level",
      id: "magnitude",
      label: "MAGNITUDE",
      short: "MAG",
      stops: [0, 2, 3, 4, 5, 6, 7],
      initial: 0,
      format: (magnitude) => `M${magnitude}+`,
    },
    {
      kind: "window",
      id: "age",
      label: "AGE",
      short: "AGE",
      options: [
        { value: HOUR_S, label: "1H" },
        { value: 6 * HOUR_S, label: "6H" },
        { value: 24 * HOUR_S, label: "24H" },
        { value: 0, label: "ALL" },
      ],
      initial: 0,
    },
  ],
  read: {
    magnitude: (row) => row.severity,
    age: (row, nowMs) => (nowMs - Date.parse(row.t_start)) / 1000,
  },
};
