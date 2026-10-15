"use client";

import { useModules, useWatchlist } from "@/api/queries";
import { useFilters } from "@/state/filters";
import { useInView } from "@/state/in-view";
import { useLayerCaps } from "@/state/layer-caps";
import { buildDomains, countStarred } from "./rail";
import type { DomainGroup } from "./types";

type Rail =
  | { status: "loading"; domains: readonly DomainGroup[] }
  | { status: "error"; domains: readonly DomainGroup[] }
  | { status: "ready"; domains: readonly DomainGroup[] };

export function useRail(): Rail {
  const { data, isPending, isError } = useModules();
  const chosen = useFilters((state) => state.filters);
  const counts = useInView((state) => state.counts);
  const caps = useLayerCaps((state) => state.caps);
  const watchlist = useWatchlist().data;
  const starred = watchlist ? countStarred(watchlist.items) : undefined;
  const domains = data ? buildDomains(data, chosen, counts, caps, starred) : [];
  if (data) return { status: "ready", domains };
  return {
    status: isPending ? "loading" : isError ? "error" : "ready",
    domains,
  };
}
