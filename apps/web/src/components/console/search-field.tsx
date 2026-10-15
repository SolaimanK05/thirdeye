"use client";

import { Autocomplete } from "@base-ui/react/autocomplete";
import { Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SearchHit } from "@/api/client";
import { MIN_SEARCH_LENGTH, useModules, useSearch } from "@/api/queries";
import { useSelection } from "@/state/selection";
import { useStarred } from "@/state/starred";
import { cx } from "./cx";
import { isPlainKey } from "./hotkeys";
import { useDebounced } from "./use-debounced";

const DEBOUNCE_MS = 200;

export function searchStatus({
  text,
  settled,
  pending,
  failed,
  count,
}: {
  text: string;
  settled: boolean;
  pending: boolean;
  failed: boolean;
  count: number;
}): string | null {
  if (text.length < MIN_SEARCH_LENGTH) return null;
  if (!settled || pending) return "Searching…";
  if (failed) return "Search unavailable. Is the API running?";
  if (count === 0) return EMPTY_TEXT;
  return `${count} ${count === 1 ? "match" : "matches"} across modules`;
}

export const EMPTY_TEXT =
  "No match in enabled modules. Names, IMO, MMSI, ICAO24, callsign and place are searched.";

function hitKey(hit: SearchHit): string {
  return `${hit.kind}:${hit.id}`;
}

export function SearchField({
  id,
  className,
  hotkey = false,
  focusOnMount = false,
  onPick,
}: {
  id: string;
  className?: string;
  hotkey?: boolean;
  focusOnMount?: boolean;
  onPick?: () => void;
}) {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const select = useSelection((state) => state.select);
  const focusOn = useSelection((state) => state.focusOn);
  const stars = useStarred();
  const modules = useModules();
  const moduleNames = new Map(
    (modules.data ?? []).map((module) => [module.id, module.name]),
  );

  const trimmed = text.trim();
  const settled = useDebounced(trimmed, DEBOUNCE_MS);
  const search = useSearch(settled);
  const hits =
    settled.length >= MIN_SEARCH_LENGTH && search.data
      ? search.data.results
      : [];
  const status = searchStatus({
    text: trimmed,
    settled: settled === trimmed,
    pending: search.isFetching,
    failed: search.isError,
    count: hits.length,
  });

  useEffect(() => {
    if (focusOnMount) input.current?.focus();
  }, [focusOnMount]);

  useEffect(() => {
    if (!hotkey) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isPlainKey(event, "/") || !input.current?.checkVisibility()) return;
      event.preventDefault();
      input.current.focus();
      input.current.select();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hotkey]);

  const pick = (hit: SearchHit) => {
    select(
      hit.kind === "event"
        ? { kind: "event", id: hit.id, moduleId: hit.module_id }
        : { kind: "entity", id: hit.id, moduleId: hit.module_id },
    );
    if (hit.position) focusOn(hit.position);
    input.current?.blur();
    onPick?.();
  };

  return (
    <Autocomplete.Root
      items={hits}
      value={text}
      onValueChange={setText}
      itemToStringValue={(hit) => hit.label}
      filter={null}
      mode="none"
      autoHighlight
    >
      <div
        ref={anchor}
        className={cx(
          "flex h-8.5 items-center gap-2 border border-line-2 bg-well px-2.5 focus-within:outline focus-within:outline-1 focus-within:outline-accent focus-within:outline-offset-2",
          className,
        )}
      >
        <span aria-hidden="true" className="text-accent">
          &gt;
        </span>
        <label htmlFor={id} className="sr-only">
          Search all modules
        </label>
        <Autocomplete.Input
          ref={input}
          id={id}
          type="search"
          name="q"
          autoComplete="off"
          spellCheck={false}
          maxLength={80}
          placeholder="ship, aircraft, place"
          className="h-8 min-w-0 flex-1 bg-transparent text-ink focus-visible:outline-none"
        />
        <span
          aria-hidden="true"
          className="h-3.75 w-2 bg-accent/90 motion-safe:animate-blink"
        />
        {hotkey && (
          <kbd className="hidden border border-line-2 px-1.5 text-ink-3 text-label tracking-normal lg:inline">
            /
          </kbd>
        )}
      </div>

      <Autocomplete.Portal hidden={status === null}>
        <Autocomplete.Positioner
          anchor={anchor}
          sideOffset={4}
          align="start"
          className="z-50"
        >
          <Autocomplete.Popup
            aria-busy={search.isFetching || undefined}
            className="w-(--anchor-width) min-w-64 origin-(--transform-origin) border border-line-2 bg-panel shadow-float outline-none"
          >
            <Autocomplete.Status>
              {status && (
                <p className="border-line border-b px-3 py-2 text-ink-3 text-secondary last:border-b-0">
                  {status}
                </p>
              )}
            </Autocomplete.Status>
            <Autocomplete.List className="max-h-[60dvh] overflow-y-auto">
              {(hit: SearchHit) => {
                const starred =
                  hit.kind === "entity" && stars.ready
                    ? stars.isStarred(hit.id)
                    : hit.starred;
                return (
                  <Autocomplete.Item
                    key={hitKey(hit)}
                    value={hit}
                    onClick={() => pick(hit)}
                    className="grid min-h-11 cursor-default grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 border-line border-b px-3 py-1.5 text-ink outline-none last:border-b-0 data-highlighted:bg-well"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{hit.label}</span>
                      <span className="truncate text-ink-3 text-label tracking-normal">
                        {hit.detail ?? hit.category.replaceAll("-", " ")}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      {starred && (
                        <span className="text-amber">
                          <Star
                            size={13}
                            fill="currentColor"
                            aria-hidden="true"
                          />
                          <span className="sr-only">Starred</span>
                        </span>
                      )}
                      <span className="border border-line-2 px-1 text-ink-3 text-micro uppercase tracking-normal">
                        {moduleNames.get(hit.module_id) ?? hit.module_id}
                      </span>
                    </span>
                  </Autocomplete.Item>
                );
              }}
            </Autocomplete.List>
            {hits.length > 0 && (
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-line border-t px-3 py-2 text-ink-3 text-label tracking-normal">
                <span className="flex items-center gap-1.5">
                  <kbd className="border border-line-2 px-1.5">Enter</kbd>
                  select
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="flex gap-0.5">
                    <kbd className="border border-line-2 px-1.5">↑</kbd>
                    <kbd className="border border-line-2 px-1.5">↓</kbd>
                  </span>
                  move
                </span>
                <span>Results are tagged by source module</span>
              </p>
            )}
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
