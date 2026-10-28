"use client";

import { useCallback, useEffect } from "react";
import { ApiRequestError, type EntityDetail } from "@/api/client";
import { useEntity, useEntityFixes, useEvent, useModules } from "@/api/queries";
import type { StarTarget } from "@/api/watchlist";
import { entityName } from "@/modules/entity";
import {
  ENTITY_VIEWS,
  entitySelectionFor,
  selectionFor,
} from "@/modules/registry";
import { renderedPosition } from "@/state/motion";
import { useOrbit } from "@/state/orbit";
import { type SelectedItem, useSelection } from "@/state/selection";
import { useStarred } from "@/state/starred";
import { isPlainKey } from "./hotkeys";
import { SelectionDock } from "./selection-dock";
import { SelectionDetails, SelectionMessage } from "./selection-panel";
import { useNow } from "./use-now";

type Kind = SelectedItem["kind"];

function Unavailable({
  kind,
  loading,
  message,
}: {
  kind: Kind;
  loading: boolean;
  message: string;
}) {
  return (
    <SelectionDock
      kind={kind.toUpperCase()}
      name={loading ? "Loading…" : "Unavailable"}
    >
      <SelectionMessage>{message}</SelectionMessage>
    </SelectionDock>
  );
}

function failure(error: unknown, kind: Kind): string {
  const noun = kind === "event" ? "event" : "entity";
  return error instanceof ApiRequestError && error.status === 404
    ? `This ${noun} is no longer in the database.`
    : `Couldn't load this ${noun}. Is the API running?`;
}

function EventSelection({
  item,
}: {
  item: Extract<SelectedItem, { kind: "event" }>;
}) {
  const focusOn = useSelection((state) => state.focusOn);
  const event = useEvent(item.id);
  const now = useNow();

  if (event.data && now !== null) {
    const selection = selectionFor(event.data, now, item.cluster);
    const { position } = event.data;
    return (
      <SelectionDock kind={selection.kind} name={selection.name}>
        <SelectionDetails
          selection={selection}
          onAction={(action) => {
            if (action === "center") focusOn(position);
          }}
        />
      </SelectionDock>
    );
  }

  return (
    <Unavailable
      kind="event"
      loading={!event.isError}
      message={event.isError ? failure(event.error, "event") : "Loading…"}
    />
  );
}

function starTarget(moduleId: string, detail: EntityDetail): StarTarget {
  return {
    id: detail.id,
    moduleId,
    name: entityName(detail),
    kind: detail.kind,
    position: detail.last_observation?.position ?? null,
    lastSeen: detail.last_seen,
  };
}

function EntitySelection({
  item,
}: {
  item: Extract<SelectedItem, { kind: "entity" }>;
}) {
  const focusOn = useSelection((state) => state.focusOn);
  const following = useSelection((state) => state.following);
  const toggleFollow = useSelection((state) => state.toggleFollow);
  const entity = useEntity(item.id);
  const stars = useStarred();
  const now = useNow();
  const orbit = useOrbit((state) =>
    state.sample?.id === item.id ? state.sample : null,
  );
  const detail = entity.data;
  const history = ENTITY_VIEWS[item.moduleId]?.history;
  const fixes = useEntityFixes(item.id, history !== undefined);
  const modules = useModules();
  const moduleInfo = modules.data?.find((m) => m.id === item.moduleId);
  const health = moduleInfo?.health;
  const mover =
    moduleInfo?.enabled === true && moduleInfo.render_delay_seconds != null;
  const computed = ENTITY_VIEWS[item.moduleId]?.computed === true;
  const followable = mover || (computed && moduleInfo?.enabled === true);
  const hasFix =
    detail?.last_observation != null || (computed && orbit !== null);
  const moduleStale = health?.state === "stale" || health?.state === "cooldown";
  const { toggle: toggleStar, noteOpen, dismissNote } = stars;

  const ready = stars.ready;
  const toggle = useCallback(() => {
    if (detail && ready) toggleStar(starTarget(item.moduleId, detail));
  }, [detail, ready, toggleStar, item.moduleId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isPlainKey(event, "s")) {
        event.preventDefault();
        toggle();
      } else if (isPlainKey(event, "f") && followable && hasFix) {
        event.preventDefault();
        toggleFollow();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle, toggleFollow, followable, hasFix]);

  useEffect(() => dismissNote, [dismissNote]);

  if (detail && now !== null) {
    const selection = entitySelectionFor(item.moduleId, detail, now, {
      starred: stars.isStarred(item.id),
      canStar: stars.ready,
      canFollow: followable,
      following,
      stale: moduleStale,
      orbit,
    });
    const chart = history && fixes.data ? history(fixes.data.fixes) : undefined;
    const position = detail.last_observation?.position;
    return (
      <SelectionDock kind={selection.kind} name={selection.name}>
        {stars.failed && (
          <p role="alert" className="px-4 pt-3 text-red text-secondary">
            Couldn't update the watchlist.
          </p>
        )}
        {noteOpen && (
          <p
            role="status"
            className="flex items-start justify-between gap-3 px-4 pt-3 text-secondary text-ink-2"
          >
            <span>Stars on this instance are saved in this browser only.</span>
            <button
              type="button"
              onClick={dismissNote}
              className="min-h-11 shrink-0 text-accent underline-offset-2 hover:underline"
            >
              Got it
            </button>
          </p>
        )}
        <SelectionDetails
          selection={chart ? { ...selection, chart } : selection}
          onAction={(action) => {
            if (action === "star") toggle();
            if (action === "follow") toggleFollow();
            const at = renderedPosition(item.moduleId, item.id) ?? position;
            if (action === "center" && at) focusOn(at);
          }}
        />
      </SelectionDock>
    );
  }

  return (
    <Unavailable
      kind="entity"
      loading={!entity.isError}
      message={entity.isError ? failure(entity.error, "entity") : "Loading…"}
    />
  );
}

export function LiveSelection() {
  const selected = useSelection((state) => state.selected);

  if (!selected) {
    return (
      <SelectionDock kind={null} name={null}>
        <SelectionMessage desktopOnly>
          Select something on the globe, or search.
        </SelectionMessage>
      </SelectionDock>
    );
  }

  return selected.kind === "event" ? (
    <EventSelection key={selected.id} item={selected} />
  ) : (
    <EntitySelection key={selected.id} item={selected} />
  );
}
