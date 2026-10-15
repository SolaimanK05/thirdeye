"use client";

import { useQueries } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { ApiRequestError, type EntityDetail } from "@/api/client";
import { entityQueryOptions, useStarEntity, useWatchlist } from "@/api/queries";
import type { StarItem, StarTarget } from "@/api/watchlist";
import { useStars } from "./stars";

export type Starred = {
  ready: boolean;
  writable: boolean;
  local: boolean;
  ids: ReadonlySet<string>;
  items: readonly StarItem[];
  isStarred: (id: string) => boolean;
  toggle: (target: StarTarget) => void;
  failed: boolean;
  pending: boolean;
  noteOpen: boolean;
  dismissNote: () => void;
};

type Lookup = { detail: EntityDetail | undefined; gone: boolean };

export function localItems(
  stars: readonly { id: string; moduleId: string; name: string }[],
  lookups: readonly (EntityDetail | undefined)[],
): StarItem[] {
  return stars.map((star, index) => {
    const detail = lookups[index];
    return {
      entity_id: star.id,
      module_id: star.moduleId,
      name: star.name,
      position: detail?.last_observation?.position ?? null,
      last_seen: detail?.last_seen ?? null,
    };
  });
}

export function useStarred(): Starred {
  const watchlist = useWatchlist();
  const mutation = useStarEntity();
  const stars = useStars((state) => state.stars);
  const noteOpen = useStars((state) => state.noteOpen);
  const toggleLocal = useStars((state) => state.toggle);
  const removeLocal = useStars((state) => state.remove);
  const dismissNote = useStars((state) => state.dismissNote);

  const writable = watchlist.data?.writable;
  const local = writable === false;
  const localStars = useMemo(() => Object.values(stars), [stars]);

  const lookups = useQueries({
    queries: local ? localStars.map((star) => entityQueryOptions(star.id)) : [],
    combine: (results): Lookup[] =>
      results.map((result) => ({
        detail: result.data,
        gone:
          result.error instanceof ApiRequestError &&
          result.error.status === 404,
      })),
  });

  useEffect(() => {
    if (!local) return;
    localStars.forEach((star, index) => {
      if (lookups[index]?.gone) removeLocal(star.id);
    });
  }, [local, localStars, lookups, removeLocal]);

  const items = useMemo<readonly StarItem[]>(() => {
    if (writable === true) return watchlist.data?.items ?? [];
    if (local) {
      return localItems(
        localStars,
        localStars.map((_, index) => lookups[index]?.detail),
      );
    }
    return [];
  }, [writable, local, watchlist.data, localStars, lookups]);

  const ids = useMemo<ReadonlySet<string>>(
    () =>
      new Set(
        local
          ? localStars.map((star) => star.id)
          : items.map((i) => i.entity_id),
      ),
    [local, localStars, items],
  );

  const isStarred = useCallback((id: string) => ids.has(id), [ids]);

  const { mutate, isPending, isError } = mutation;
  const toggle = useCallback(
    (target: StarTarget) => {
      if (writable === true) {
        if (!isPending) mutate({ target, starred: !ids.has(target.id) });
      } else if (writable === false) {
        toggleLocal({
          id: target.id,
          moduleId: target.moduleId,
          name: target.name,
        });
      }
    },
    [writable, isPending, mutate, ids, toggleLocal],
  );

  return {
    ready: writable !== undefined,
    writable: writable === true,
    local,
    ids,
    items,
    isStarred,
    toggle,
    failed: isError,
    pending: isPending,
    noteOpen: local && noteOpen,
    dismissNote,
  };
}
