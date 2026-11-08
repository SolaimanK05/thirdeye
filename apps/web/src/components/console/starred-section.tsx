"use client";

import { useModules, useWatchlist } from "@/api/queries";
import { renderedPosition } from "@/state/motion";
import { useSelection } from "@/state/selection";
import { useStarred } from "@/state/starred";
import { cx } from "./cx";
import { toStarred } from "./rail";
import type { StarredEntity } from "./types";
import { useNow } from "./use-now";

const AGE_TONE: Record<StarredEntity["tone"], string> = {
  normal: "text-ink-2",
  stale: "text-amber",
  gap: "text-red",
};

export function StarredList() {
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

  if (watchlist.isError) {
    return (
      <p role="alert" className="px-4 py-3 text-red text-secondary">
        Couldn't load the watchlist.
      </p>
    );
  }
  if (entities.length === 0) {
    return (
      <p className="px-4 py-3 text-ink-3 text-secondary">
        None yet. Select something on the globe, then press s.
      </p>
    );
  }

  return (
    <ul>
      {entities.map((entity) => (
        <li key={entity.id} className="border-line border-b">
          <button
            type="button"
            onClick={() => {
              select({
                kind: "entity",
                id: entity.id,
                moduleId: entity.moduleId,
              });
              const at =
                entity.position ?? renderedPosition(entity.moduleId, entity.id);
              if (at) focusOn(at);
            }}
            className="grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-left transition-colors duration-120 ease-out hover-fine:bg-well max-lg:min-h-14"
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-body text-ink">{entity.name}</span>
              <span className="text-ink-3 text-secondary">{entity.module}</span>
            </span>
            <span
              className={cx(
                "text-secondary tabular-nums",
                AGE_TONE[entity.tone],
              )}
            >
              {entity.age}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
