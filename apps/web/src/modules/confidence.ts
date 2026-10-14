import type { ApiSchemas } from "@/api/client";
import type { ConfidenceTag } from "@/components/console/types";

export const CONFIDENCE_TAG: Record<ApiSchemas["Confidence"], ConfidenceTag> = {
  observed: "OBS",
  reported: "REP",
  derived: "DER",
  inferred: "INF",
};
