"use client";

import { Slider } from "@base-ui/react/slider";
import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { useState } from "react";
import type {
  ChoicesControl,
  LevelControl,
  RangeControl,
  RefineValue,
  WindowControl,
} from "@/modules/refine";
import { cx } from "./cx";

type ControlProps<C, V> = {
  control: C;
  value: V;
  onChange: (value: RefineValue) => void;
};

const THUMB =
  "relative block size-3.5 border border-accent bg-panel outline-none before:absolute before:-inset-2.5 data-dragging:bg-accent data-focused:ring-1 data-focused:ring-accent";

const CHIP =
  "min-h-7 flex-1 border border-line-2 px-1.5 text-ink-3 text-micro tracking-normal transition-colors duration-120 ease-out hover-fine:border-ink-3 data-pressed:border-accent data-pressed:text-accent";

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
    <span className="flex items-baseline justify-between gap-2 whitespace-nowrap text-ink-2 text-micro tracking-normal tabular-nums">
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
        <span className="text-ink-3 text-micro tracking-normal tabular-nums">
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

export function ChoicesField({
  control,
  value,
  onChange,
}: ControlProps<ChoicesControl, readonly string[]>) {
  return (
    <ToggleGroup
      multiple
      value={[...value]}
      onValueChange={(next) => onChange(next)}
      aria-label={control.label}
      className="grid grid-cols-2 gap-1"
    >
      {control.options.map((option) => (
        <Toggle key={option.value} value={option.value} className={CHIP}>
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
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
