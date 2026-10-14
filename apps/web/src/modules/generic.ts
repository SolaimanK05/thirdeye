import type { EventDetail } from "@/api/client";
import { formatCentre } from "@/components/console/geo";
import { formatClock, relativeAge } from "@/components/console/time";
import type { Selection } from "@/components/console/types";
import { CONFIDENCE_TAG } from "./confidence";

export function genericSelection(
  detail: EventDetail,
  nowMs: number,
): Selection {
  const tag = CONFIDENCE_TAG[detail.confidence];
  const retrieved = new Date(detail.retrieved_at);
  return {
    kind: "EVENT",
    name: detail.category,
    subline: detail.module_id,
    starred: false,
    actions: ["center"],
    sections: [
      {
        label: "POSITION",
        rows: [
          {
            key: "POSITION",
            value: formatCentre(detail.position),
            confidence: tag,
          },
          { key: "MODULE", value: detail.module_id, confidence: "DER" },
        ],
      },
    ],
    provenance: {
      source: detail.provenance?.source ?? detail.source.id,
      retrieved: `${formatClock(retrieved)}, ${relativeAge(retrieved, nowMs)}`,
      reliability: detail.source.reliability,
      licence: detail.provenance?.licence ?? detail.source.licence,
    },
    limitations: detail.provenance?.limitations ?? [],
  };
}
