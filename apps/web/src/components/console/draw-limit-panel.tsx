"use client";

import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { useId, useState } from "react";
import {
  DRAW_PRESETS,
  type DrawLimit,
  defaultLimit,
  parseLimit,
} from "@/modules/draw-limit";
import { ENTITY_VIEWS, MODULE_VIEWS } from "@/modules/registry";
import { useDrawLimit, useDrawLimits } from "@/state/draw-limits";
import { useRendererKind } from "@/state/renderer-kind";
import { formatCount } from "./count";
import { cx } from "./cx";
import { CHIP } from "./refine-controls";
import type { ModuleRow } from "./types";

const ALL = "all";

function chipValue(limit: DrawLimit): string {
  return limit === null ? ALL : String(limit);
}

/** "draw all" or "draw 3,000", for the one-line summary of a module. */
export function drawSummary(limit: DrawLimit, fromRenderer = false): string {
  const base = limit === null ? "draw all" : `draw ${formatCount(limit)}`;
  return fromRenderer ? `${base} (2D default)` : base;
}

function isPreset(limit: DrawLimit): boolean {
  return limit === null || DRAW_PRESETS.includes(limit);
}

export function drawsAnything(moduleId: string): boolean {
  return (
    ENTITY_VIEWS[moduleId] !== undefined || MODULE_VIEWS[moduleId] !== undefined
  );
}

export function DrawLimitFields({ row }: { row: ModuleRow }) {
  const { limit, chosen } = useDrawLimit(row.id);
  const kind = useRendererKind((state) => state.kind);
  const setLimit = useDrawLimits((state) => state.setLimit);
  const reset = useDrawLimits((state) => state.reset);
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const inputId = useId();
  if (!drawsAnything(row.id) || row.health === "missing-key") return null;

  const typed = isPreset(limit) ? "" : String(limit);

  const commit = () => {
    if (draft === null) return;
    const parsed = parseLimit(draft);
    if (parsed === undefined) {
      setInvalid(draft.trim() !== "");
      if (draft.trim() === "") setDraft(null);
      return;
    }
    setInvalid(false);
    setDraft(null);
    setLimit(row.id, parsed);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-ink-3 text-secondary">MOST MARKERS DRAWN</span>
        <ToggleGroup
          value={[chipValue(limit)]}
          onValueChange={(next) => {
            const [picked] = next;
            if (picked === undefined) return;
            setDraft(null);
            setInvalid(false);
            setLimit(row.id, picked === ALL ? null : Number(picked));
          }}
          aria-label="Draw limit"
          className="grid grid-cols-4 gap-1"
        >
          <Toggle value={ALL} className={CHIP}>
            ALL
          </Toggle>
          {DRAW_PRESETS.map((preset) => (
            <Toggle key={preset} value={String(preset)} className={CHIP}>
              {formatCount(preset)}
            </Toggle>
          ))}
        </ToggleGroup>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={inputId} className="text-ink-3 text-secondary">
          OR TYPE A NUMBER
        </label>
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          placeholder="e.g. 7,500"
          aria-invalid={invalid}
          value={draft ?? typed}
          onChange={(event) => {
            setDraft(event.target.value);
            setInvalid(false);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            if (event.key === "Escape") {
              setDraft(null);
              setInvalid(false);
            }
          }}
          className={cx(
            "min-h-7 border bg-transparent px-1.5 text-ink text-secondary tabular-nums outline-none placeholder:text-ink-3 focus:border-accent",
            invalid ? "border-amber" : "border-line-2",
          )}
        />
        {invalid ? (
          <span role="alert" className="text-amber text-secondary">
            Enter a whole number, or ALL.
          </span>
        ) : null}
      </div>
      <p className="text-ink-3 text-secondary leading-snug tracking-normal">
        Starred and selected markers always stay. The rest are kept by
        importance, never at random.
      </p>
      <button
        type="button"
        disabled={!chosen}
        onClick={() => {
          setDraft(null);
          setInvalid(false);
          reset(row.id);
        }}
        className="min-h-7 self-start border border-line-2 px-2 text-ink-2 text-secondary transition-colors duration-120 ease-out hover-fine:border-ink-3 disabled:text-ink-3 disabled:opacity-60 max-lg:min-h-11"
      >
        {defaultLimit(kind) === null ? "RESET TO ALL" : "RESET TO DEFAULT"}
      </button>
    </div>
  );
}
