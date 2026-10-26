"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import {
  isDefault,
  type RefineControl,
  type RefineValue,
  type RefineValues,
  summarise,
} from "@/modules/refine";
import { useRefineValues } from "@/modules/use-refine";
import { useRefine } from "@/state/refine";
import { useRefineStats } from "@/state/refine-stats";
import { formatCount } from "./count";
import { cx } from "./cx";
import {
  ChoicesField,
  LevelField,
  RangeField,
  WindowField,
} from "./refine-controls";
import type { ModuleRow } from "./types";

function numberValue(values: RefineValues, id: string, fallback: number) {
  const value = values[id];
  return typeof value === "number" ? value : fallback;
}

function Field({
  control,
  values,
  onChange,
}: {
  control: RefineControl;
  values: RefineValues;
  onChange: (value: RefineValue) => void;
}) {
  const value = values[control.id];
  return (
    <div className="flex flex-col gap-1">
      <span className="text-ink-3 text-micro tracking-[0.08em]">
        {control.label}
      </span>
      {control.kind === "range" && Array.isArray(value) ? (
        <RangeField
          control={control}
          value={[Number(value[0]), Number(value[1])]}
          onChange={onChange}
        />
      ) : null}
      {control.kind === "level" ? (
        <LevelField
          control={control}
          value={numberValue(values, control.id, control.initial)}
          onChange={onChange}
        />
      ) : null}
      {control.kind === "window" ? (
        <WindowField
          control={control}
          value={numberValue(values, control.id, control.initial)}
          onChange={onChange}
        />
      ) : null}
      {control.kind === "choices" ? (
        <ChoicesField
          control={control}
          value={
            Array.isArray(value) ? value.map(String) : [...control.initial]
          }
          onChange={onChange}
        />
      ) : null}
    </div>
  );
}

export function RefinePanel({ row }: { row: ModuleRow }) {
  const { controls, values } = useRefineValues(row.id);
  const stat = useRefineStats((state) => state.stats[row.id]);
  const set = useRefine((state) => state.set);
  const reset = useRefine((state) => state.reset);
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  if (controls.length === 0 || row.health === "missing-key") return null;
  const untouched = isDefault(controls, values);

  return (
    <div className="col-span-3 col-start-2 flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-7 w-full items-center gap-1.5 text-left text-ink-3 text-micro tracking-normal transition-colors duration-120 ease-out hover-fine:text-ink-2"
      >
        <span className="shrink-0 tracking-[0.08em]">FILTER</span>
        <span className="min-w-0 flex-1 truncate text-ink-2">
          {summarise(controls, values)}
        </span>
        {stat ? (
          <span className="shrink-0 tabular-nums">
            {formatCount(stat.kept)} of {formatCount(stat.total)}
          </span>
        ) : null}
        <ChevronDown
          size={12}
          aria-hidden="true"
          className={cx(
            "shrink-0 transition-transform duration-120 ease-out",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div
          id={bodyId}
          className="flex flex-col gap-2.5 border-line-2 border-l pt-1 pr-1 pb-2 pl-2.5"
        >
          {controls.map((control) => (
            <Field
              key={control.id}
              control={control}
              values={values}
              onChange={(value) => set(row.id, control.id, value)}
            />
          ))}
          <button
            type="button"
            disabled={untouched}
            onClick={() => reset(row.id)}
            className="min-h-7 self-start border border-line-2 px-2 text-ink-2 text-micro tracking-[0.08em] transition-colors duration-120 ease-out hover-fine:border-ink-3 disabled:text-ink-3 disabled:opacity-60"
          >
            RESET
          </button>
        </div>
      ) : null}
    </div>
  );
}
