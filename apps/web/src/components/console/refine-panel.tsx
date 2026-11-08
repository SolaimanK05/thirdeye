"use client";

import {
  isDefault,
  type PickControl,
  type RefineControl,
  type RefineValue,
  type RefineValues,
} from "@/modules/refine";
import { useRefineValues } from "@/modules/use-refine";
import { useRefine } from "@/state/refine";
import { usePickOptions } from "@/state/refine-options";
import {
  ChoicesField,
  LevelField,
  PickField,
  RangeField,
  WindowField,
} from "./refine-controls";
import type { ModuleRow } from "./types";

function numberValue(values: RefineValues, id: string, fallback: number) {
  const value = values[id];
  return typeof value === "number" ? value : fallback;
}

function PickControlField({
  moduleId,
  control,
  value,
  onChange,
}: {
  moduleId: string;
  control: PickControl;
  value: RefineValue | undefined;
  onChange: (value: RefineValue) => void;
}) {
  const options = usePickOptions(moduleId, control.id);
  return (
    <PickField
      control={control}
      value={Array.isArray(value) ? value.map(String) : []}
      options={options}
      onChange={onChange}
    />
  );
}

function Field({
  moduleId,
  control,
  values,
  onChange,
}: {
  moduleId: string;
  control: RefineControl;
  values: RefineValues;
  onChange: (value: RefineValue) => void;
}) {
  const value = values[control.id];
  return (
    <div className="flex flex-col gap-1">
      <span className="text-ink-3 text-secondary">{control.label}</span>
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
      {control.kind === "pick" ? (
        <PickControlField
          moduleId={moduleId}
          control={control}
          value={value}
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

export function RefineFields({ row }: { row: ModuleRow }) {
  const { controls, values } = useRefineValues(row.id);
  const set = useRefine((state) => state.set);
  const reset = useRefine((state) => state.reset);
  if (controls.length === 0 || row.health === "missing-key") return null;
  const untouched = isDefault(controls, values);

  return (
    <div className="flex flex-col gap-3">
      {controls.map((control) => (
        <Field
          key={control.id}
          moduleId={row.id}
          control={control}
          values={values}
          onChange={(value) => set(row.id, control.id, value)}
        />
      ))}
      <button
        type="button"
        disabled={untouched}
        onClick={() => reset(row.id)}
        className="min-h-7 self-start border border-line-2 px-2 text-ink-2 text-secondary transition-colors duration-120 ease-out hover-fine:border-ink-3 disabled:text-ink-3 disabled:opacity-60 max-lg:min-h-11"
      >
        RESET FILTERS
      </button>
    </div>
  );
}
