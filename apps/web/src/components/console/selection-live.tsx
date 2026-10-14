"use client";

import { ApiRequestError } from "@/api/client";
import { useEvent } from "@/api/queries";
import { selectionFor } from "@/modules/registry";
import { useSelection } from "@/state/selection";
import { SelectionDock } from "./selection-dock";
import { SelectionDetails, SelectionMessage } from "./selection-panel";
import { useNow } from "./use-now";

export function LiveSelection() {
  const selected = useSelection((state) => state.selected);
  const focusOn = useSelection((state) => state.focusOn);
  const event = useEvent(selected?.id ?? null);
  const now = useNow();

  if (!selected) {
    return (
      <SelectionDock kind={null} name={null}>
        <SelectionMessage desktopOnly>
          Select something on the globe, or search.
        </SelectionMessage>
      </SelectionDock>
    );
  }

  if (event.data && now !== null) {
    const selection = selectionFor(event.data, now, selected.cluster);
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

  const message = event.isError
    ? event.error instanceof ApiRequestError && event.error.status === 404
      ? "This event is no longer in the database."
      : "Couldn't load this event. Is the API running?"
    : "Loading…";

  return (
    <SelectionDock
      kind="EVENT"
      name={event.isError ? "Unavailable" : "Loading…"}
    >
      <SelectionMessage>{message}</SelectionMessage>
    </SelectionDock>
  );
}
