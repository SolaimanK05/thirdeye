"use client";

import { useCallback, useEffect } from "react";
import { ApiRequestError } from "@/api/client";
import {
  useEntity,
  useEvent,
  useStarEntity,
  useWatchlist,
} from "@/api/queries";
import { entitySelection } from "@/modules/entity";
import { selectionFor } from "@/modules/registry";
import { type SelectedItem, useSelection } from "@/state/selection";
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

function EntitySelection({
  item,
}: {
  item: Extract<SelectedItem, { kind: "entity" }>;
}) {
  const focusOn = useSelection((state) => state.focusOn);
  const entity = useEntity(item.id);
  const watchlist = useWatchlist();
  const now = useNow();

  const { mutate, isPending, isError } = useStarEntity();
  const canStar = watchlist.data?.writable === true;
  const starred =
    watchlist.data?.items.some((entry) => entry.entity_id === item.id) ?? false;

  const toggle = useCallback(() => {
    if (canStar && !isPending) {
      mutate({ entityId: item.id, starred: !starred });
    }
  }, [canStar, isPending, mutate, item.id, starred]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isPlainKey(event, "s")) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  if (entity.data && now !== null) {
    const selection = entitySelection(entity.data, now, { starred, canStar });
    const position = entity.data.last_observation?.position;
    return (
      <SelectionDock kind={selection.kind} name={selection.name}>
        <SelectionDetails
          selection={selection}
          onAction={(action) => {
            if (action === "star") toggle();
            if (action === "center" && position) focusOn(position);
          }}
        />
        {isError && (
          <p role="alert" className="px-4 pb-3 text-red text-secondary">
            Couldn't update the watchlist.
          </p>
        )}
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
