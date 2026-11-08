"use client";

import { Slider } from "@base-ui/react/slider";
import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { useId, useState } from "react";
import type {
  ChoicesControl,
  LevelControl,
  PickControl,
  RangeControl,
  RefineValue,
  WindowControl,
} from "@/modules/refine";
import { MAX_PICKED } from "@/modules/refine";
import type { PickOption } from "@/state/refine-options";
import { cx } from "./cx";

type ControlProps<C, V> = {
  control: C;
  value: V;
  onChange: (value: RefineValue) => void;
};

const THUMB =
  "relative block size-3.5 border border-accent bg-panel outline-none before:absolute before:-inset-2.5 data-dragging:bg-accent data-focused:ring-1 data-focused:ring-accent";

export const CHIP =
  "min-h-7 max-lg:min-h-11 flex-1 border border-line-2 px-1.5 text-ink-3 text-secondary tracking-normal transition-colors duration-120 ease-out hover-fine:border-ink-3 data-pressed:border-accent data-pressed:text-accent";

function Track({ children }: { children: React.ReactNode }) {
  return (
    <Slider.Control className="flex h-7 w-full touch-none items-center select-none">
      <Slider.Track className="relative h-0.5 w-full bg-line-2">
        <Slider.Indicator className="bg-accent" />
        {children}
      </Slider.Track>
    </Slider.Control>
  );
}

function Readout({ left, right }: { left: string; right?: string }) {
  return (
    <span className="flex items-baseline justify-between gap-2 whitespace-nowrap text-ink-2 text-secondary tracking-normal tabular-nums">
      <span>{left}</span>
      {right ? <span>{right}</span> : null}
    </span>
  );
}

export function RangeField({
  control,
  value,
  onChange,
}: ControlProps<RangeControl, readonly [number, number]>) {
  const [low, high] = value;
  const openEnd = high >= control.max;
  const { format, unit, secondary } = control;
  return (
    <div className="flex flex-col gap-0.5">
      <Readout
        left={`${format(low)} ${unit}`}
        right={`${format(high)}${openEnd ? "+" : ""} ${unit}`}
      />
      {secondary ? (
        <span className="text-ink-3 text-secondary tracking-normal tabular-nums">
          {`${format(secondary.convert(low))} to ${format(secondary.convert(high))}${openEnd ? "+" : ""} ${secondary.unit}`}
        </span>
      ) : null}
      <Slider.Root
        value={[low, high]}
        min={control.min}
        max={control.max}
        step={control.step}
        thumbAlignment="edge"
        onValueChange={(next) => {
          if (Array.isArray(next) && next.length === 2) {
            onChange([next[0], next[1]]);
          }
        }}
      >
        <Track>
          <Slider.Thumb
            index={0}
            aria-label={`${control.label} from`}
            getAriaValueText={(_text, value) => `${format(value)} ${unit}`}
            className={THUMB}
          />
          <Slider.Thumb
            index={1}
            aria-label={`${control.label} to`}
            getAriaValueText={(_text, value) => `${format(value)} ${unit}`}
            className={THUMB}
          />
        </Track>
      </Slider.Root>
    </div>
  );
}

export function LevelField({
  control,
  value,
  onChange,
}: ControlProps<LevelControl, number>) {
  const live = control.target !== "server";
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? value;
  const index = Math.max(0, control.stops.indexOf(shown));
  const at = (position: number) => control.stops[position] ?? control.stops[0];
  return (
    <div className="flex flex-col gap-0.5">
      <Readout
        left={shown <= control.stops[0] ? "any" : control.format(shown)}
      />
      <Slider.Root
        value={index}
        min={0}
        max={control.stops.length - 1}
        step={1}
        thumbAlignment="edge"
        onValueChange={(next) => {
          if (typeof next !== "number") return;
          if (live) onChange(at(next));
          else setDraft(at(next));
        }}
        onValueCommitted={(next) => {
          if (typeof next === "number" && !live) onChange(at(next));
          setDraft(null);
        }}
      >
        <Track>
          <Slider.Thumb
            aria-label={control.label}
            getAriaValueText={(_text, position) =>
              control.format(at(Number(position)))
            }
            className={THUMB}
          />
        </Track>
      </Slider.Root>
    </div>
  );
}

export const BULK_CHOICES_FROM = 5;

export function ChoicesField({
  control,
  value,
  onChange,
}: ControlProps<ChoicesControl, readonly string[]>) {
  const bulk = control.options.length >= BULK_CHOICES_FROM;
  return (
    <div className="flex flex-col gap-1">
      <ToggleGroup
        multiple
        value={[...value]}
        onValueChange={(next) => onChange(next)}
        aria-label={control.label}
        className="grid grid-cols-2 gap-1"
      >
        {control.options.map((option) => (
          <Toggle key={option.value} value={option.value} className={cx(CHIP)}>
            {option.label}
          </Toggle>
        ))}
      </ToggleGroup>
      {bulk ? (
        <div className="flex gap-1">
          <button
            type="button"
            className={cx(CHIP, "hover-fine:text-ink-2 disabled:opacity-60")}
            aria-label={`Select every ${control.label.toLowerCase()} option`}
            disabled={value.length === control.options.length}
            onClick={() => onChange(control.options.map((o) => o.value))}
          >
            ALL
          </button>
          <button
            type="button"
            className={cx(CHIP, "hover-fine:text-ink-2 disabled:opacity-60")}
            aria-label={`Clear every ${control.label.toLowerCase()} option`}
            disabled={value.length === 0}
            onClick={() => onChange([])}
          >
            NONE
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function WindowField({
  control,
  value,
  onChange,
}: ControlProps<WindowControl, number>) {
  return (
    <ToggleGroup
      value={[String(value)]}
      onValueChange={(next) => {
        const [chosen] = next;
        if (chosen !== undefined) onChange(Number(chosen));
      }}
      aria-label={control.label}
      className="flex gap-1"
    >
      {control.options.map((option) => (
        <Toggle
          key={option.value}
          value={String(option.value)}
          className={cx(CHIP)}
        >
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

export const PICK_ROWS = 40;

/** The options that match what was typed, most numerous first, and how many were cut. */
export function matchOptions(
  options: readonly PickOption[],
  query: string,
  limit = PICK_ROWS,
): { shown: readonly PickOption[]; hidden: number } {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const found = options.filter((option) => {
    const text = `${option.label} ${option.value}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
  return {
    shown: found.slice(0, limit),
    hidden: Math.max(0, found.length - limit),
  };
}

export function PickField({
  control,
  value,
  options,
  onChange,
}: ControlProps<PickControl, readonly string[]> & {
  options: readonly PickOption[];
}) {
  const [query, setQuery] = useState("");
  const listId = useId();
  const name = control.format ?? String;
  const picked = new Set(value);
  const { shown, hidden } = matchOptions(options, query);
  const toggle = (item: string) => {
    if (picked.has(item)) onChange(value.filter((v) => v !== item));
    else if (value.length < MAX_PICKED) onChange([...value, item]);
  };
  return (
    <div className="flex flex-col gap-1">
      {value.length > 0 ? (
        <ul
          className="flex flex-wrap gap-1"
          aria-label={`Picked ${control.noun}`}
        >
          {value.map((item) => (
            <li key={item}>
              <button
                type="button"
                className="flex min-h-7 max-lg:min-h-11 items-center gap-1 border border-accent px-1.5 text-accent text-secondary"
                aria-label={`Remove ${name(item)}`}
                onClick={() => toggle(item)}
              >
                {name(item)}
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className={cx(CHIP, "min-h-7 px-2")}
              onClick={() => onChange([])}
            >
              CLEAR
            </button>
          </li>
        </ul>
      ) : null}
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={`Find ${control.noun}, ${options.length.toLocaleString("en-US")} to pick from`}
        aria-label={`Find ${control.noun}`}
        aria-controls={listId}
        autoComplete="off"
        spellCheck={false}
        className="min-h-7 max-lg:min-h-11 w-full border border-line-2 bg-transparent px-1.5 text-ink text-secondary outline-none placeholder:text-ink-3 focus:border-accent"
      />
      <ul
        id={listId}
        aria-label={`${control.label} options`}
        className="flex max-h-44 flex-col overflow-y-auto border border-line-2"
      >
        {shown.map((option) => (
          <li key={option.value}>
            <button
              type="button"
              aria-pressed={picked.has(option.value)}
              onClick={() => toggle(option.value)}
              className="flex min-h-7 max-lg:min-h-11 w-full items-center justify-between gap-2 px-1.5 text-left text-ink-3 text-secondary hover-fine:text-ink aria-pressed:text-accent"
            >
              <span className="truncate">
                {picked.has(option.value) ? "✓ " : ""}
                {option.label}
              </span>
              <span className="shrink-0 tabular-nums">
                {option.count.toLocaleString("en-US")}
              </span>
            </button>
          </li>
        ))}
        {shown.length === 0 ? (
          <li className="px-1.5 py-1 text-ink-3 text-secondary">
            {options.length === 0 ? "Loading the list" : "Nothing matches"}
          </li>
        ) : null}
      </ul>
      {hidden > 0 ? (
        <span className="text-ink-3 text-secondary">
          {hidden.toLocaleString("en-US")} more, type to narrow
        </span>
      ) : null}
    </div>
  );
}
