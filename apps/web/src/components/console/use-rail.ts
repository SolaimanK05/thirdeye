"use client";

import { useMemo } from "react";
import { useModules } from "@/api/queries";
import { useFilters } from "@/state/filters";
import { useHere } from "@/state/here";
import { useInView } from "@/state/in-view";
import { useLayerCaps } from "@/state/layer-caps";
import { usePins } from "@/state/pins";
import { useStarred } from "@/state/starred";
import { buildDomains, countStarred } from "./rail";
import type { DomainGroup } from "./types";

type Rail =
  | { status: "loading"; domains: readonly DomainGroup[] }
  | { status: "error"; domains: readonly DomainGroup[] }
  | { status: "ready"; domains: readonly DomainGroup[] };

export function useRail(): Rail {
  const { data, isPending, isError } = useModules();
  const chosen = useFilters((state) => state.filters);
  const drawn = useInView((state) => state.counts);
  const hidden = useHere((state) => state.counts);
  const pins = usePins((state) => state.pins);
  const counts = useMemo(() => ({ ...drawn, ...hidden }), [hidden, drawn]);
  const caps = useLayerCaps((state) => state.caps);
  const stars = useStarred();
  const starred = stars.ready ? countStarred(stars.items) : undefined;
  const domains = data
    ? buildDomains(data, chosen, counts, caps, starred, pins)
    : [];
  if (data) return { status: "ready", domains };
  return {
    status: isPending ? "loading" : isError ? "error" : "ready",
    domains,
  };
}
