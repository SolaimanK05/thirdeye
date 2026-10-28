"use client";

import { Star } from "lucide-react";
import { useModules, useWatchlist } from "@/api/queries";
import { renderedPosition } from "@/state/motion";
import { useSelection } from "@/state/selection";
import { useStarred } from "@/state/starred";
import { cx } from "./cx";
import { Disclosure } from "./disclosure";
import { toStarred } from "./rail";
import type { StarredEntity } from "./types";
import { useNow } from "./use-now";

const AGE_TONE: Record<StarredEntity["tone"], string> = {
  normal: "text-ink-2",
  stale: "text-amber",
  gap: "text-red",
};

export function StarredSection() {
  const watchlist = useWatchlist();
  const stars = useStarred();
  const modules = useModules();
  const select = useSelection((state) => state.select);
  const focusOn = useSelection((state) => state.focusOn);
  const now = useNow();

  const entities =
    stars.ready && now !== null
      ? toStarred(stars.items, modules.data ?? [], now)
      : [];

  return (
    <Disclosure
      title={
        <span className="flex items-center gap-1.5 text-amber">
          <Star size={13} aria-hidden="true" />
          <span className="sr-only">Starred</span>
          <span className="tabular-nums">{entities.length}</span>
        </span>
      }
      className="border-line border-b pb-3"
      summaryClassName="px-3"
    >
      {watchlist.isError ? (
        <p role="alert" className="px-3 text-red text-secondary">
          Couldn't load the watchlist.
        </p>
      ) : entities.length === 0 ? (
        <p className="px-3 text-ink-3 text-secondary">
          None yet. Select an entity, press s.
        </p>
      ) : (
        <ul>
          {entities.map((entity) => (
            <li key={entity.id}>
              <button
                type="button"
                onClick={() => {
                  select({
                    kind: "entity",
                    id: entity.id,
                    moduleId: entity.moduleId,
                  });
                  const at =
                    entity.position ??
                    renderedPosition(entity.moduleId, entity.id);
                  if (at) focusOn(at);
                }}
                className="grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-1 text-left transition-colors duration-120 ease-out hover-fine:bg-well"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-ink">{entity.name}</span>
                  <span className="text-ink-3 text-label tracking-normal">
                    {entity.module}
                  </span>
                </span>
                <span
                  className={cx(
                    "text-label tracking-normal tabular-nums",
                    AGE_TONE[entity.tone],
                  )}
                >
                  {entity.age}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Disclosure>
  );
}
