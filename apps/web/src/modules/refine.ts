export type RangeControl = {
  kind: "range";
  id: string;
  label: string;
  short: string;
  min: number;
  max: number;
  step: number;
  initial: readonly [number, number];
  unit: string;
  format: (value: number) => string;
  secondary?: { unit: string; convert: (value: number) => number };
};

export type LevelControl = {
  kind: "level";
  id: string;
  label: string;
  short: string;
  stops: readonly number[];
  initial: number;
  format: (value: number) => string;
  target?: "server";
};

export type ChoiceOption = { value: string; label: string };

export type ChoicesControl = {
  kind: "choices";
  id: string;
  label: string;
  short: string;
  options: readonly ChoiceOption[];
  initial: readonly string[];
};

export type WindowControl = {
  kind: "window";
  id: string;
  label: string;
  short: string;
  options: readonly { value: number; label: string }[];
  initial: number;
};

export type RefineControl =
  | RangeControl
  | LevelControl
  | ChoicesControl
  | WindowControl;

export type RefineValue =
  | number
  | readonly [number, number]
  | readonly string[];

export type RefineValues = Readonly<Record<string, RefineValue>>;

export type Reading = number | string | null;

export type RefineSpec<Row> = {
  controls: readonly RefineControl[];
  read: Readonly<Record<string, (row: Row, nowMs: number) => Reading>>;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function snap(control: RangeControl, value: number): number {
  const clamped = Math.min(control.max, Math.max(control.min, value));
  const steps = Math.round((clamped - control.min) / control.step);
  return Math.min(control.max, control.min + steps * control.step);
}

function nearest(stops: readonly number[], value: number): number {
  return stops.reduce((best, stop) =>
    Math.abs(stop - value) < Math.abs(best - value) ? stop : best,
  );
}

export function defaultValues(
  controls: readonly RefineControl[],
): RefineValues {
  return Object.fromEntries(
    controls.map((control) => [control.id, control.initial]),
  );
}

function resolveOne(control: RefineControl, stored: unknown): RefineValue {
  switch (control.kind) {
    case "range": {
      if (
        Array.isArray(stored) &&
        stored.length === 2 &&
        isFiniteNumber(stored[0]) &&
        isFiniteNumber(stored[1])
      ) {
        const low = snap(control, stored[0]);
        const high = snap(control, stored[1]);
        return low <= high ? [low, high] : [high, low];
      }
      return control.initial;
    }
    case "level":
      return isFiniteNumber(stored)
        ? nearest(control.stops, stored)
        : control.initial;
    case "window":
      return control.options.some((option) => option.value === stored) &&
        isFiniteNumber(stored)
        ? stored
        : control.initial;
    case "choices": {
      if (!Array.isArray(stored)) return control.initial;
      const chosen = new Set(stored);
      return control.options
        .filter((option) => chosen.has(option.value))
        .map((option) => option.value);
    }
  }
}

export function resolveValues(
  controls: readonly RefineControl[],
  stored: unknown,
): RefineValues {
  const source =
    typeof stored === "object" && stored !== null && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    controls.map((control) => [
      control.id,
      resolveOne(control, source[control.id]),
    ]),
  );
}

function sameValue(a: RefineValue, b: RefineValue): boolean {
  if (typeof a === "number" || typeof b === "number") return a === b;
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

export function isDefault(
  controls: readonly RefineControl[],
  values: RefineValues,
): boolean {
  return controls.every((control) =>
    sameValue(values[control.id] ?? control.initial, control.initial),
  );
}

function rangeOf(value: RefineValue | undefined, control: RangeControl) {
  return Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
    ? ([value[0], value[1]] as const)
    : control.initial;
}

function passesControl(
  control: RefineControl,
  value: RefineValue | undefined,
  reading: Reading,
): boolean {
  switch (control.kind) {
    case "range": {
      const [low, high] = rangeOf(value, control);
      if (typeof reading !== "number") return low <= control.min;
      return reading >= low && (high >= control.max || reading <= high);
    }
    case "level": {
      const floor = typeof value === "number" ? value : control.initial;
      if (typeof reading !== "number") return floor <= control.stops[0];
      return reading >= floor;
    }
    case "window": {
      const span = typeof value === "number" ? value : control.initial;
      return span === 0 || typeof reading !== "number" || reading <= span;
    }
    case "choices": {
      const chosen = Array.isArray(value)
        ? (value as readonly string[])
        : control.initial;
      if (reading === null) return chosen.length === control.options.length;
      return chosen.includes(String(reading));
    }
  }
}

export function passes<Row>(
  spec: RefineSpec<Row>,
  values: RefineValues,
  row: Row,
  nowMs: number,
): boolean {
  return spec.controls.every((control) => {
    const read = spec.read[control.id];
    if (read === undefined) return true;
    return passesControl(control, values[control.id], read(row, nowMs));
  });
}

export type Refined<Row> = { rows: Row[]; kept: number; total: number };

export function refineRows<Row extends { id: string }>(
  rows: readonly Row[],
  spec: RefineSpec<Row> | undefined,
  values: RefineValues,
  nowMs: number,
  keep: ReadonlySet<string> = new Set(),
): Refined<Row> {
  if (spec === undefined) {
    return { rows: [...rows], kept: rows.length, total: rows.length };
  }
  const kept = rows.filter(
    (row) => keep.has(row.id) || passes(spec, values, row, nowMs),
  );
  return { rows: kept, kept: kept.length, total: rows.length };
}

export function serverFloor(
  controls: readonly RefineControl[],
  values: RefineValues,
): number {
  let floor = 0;
  for (const control of controls) {
    if (control.kind !== "level" || control.target !== "server") continue;
    const value = values[control.id];
    if (typeof value === "number") floor = Math.max(floor, value);
  }
  return floor;
}

function describeRange(control: RangeControl, value: RefineValue): string {
  const [low, high] = rangeOf(value, control);
  const { format, unit } = control;
  if (low <= control.min && high >= control.max) return "any";
  if (low === high) return `${format(low)} ${unit}`;
  if (high >= control.max) return `${format(low)}+ ${unit}`;
  if (low <= control.min) return `to ${format(high)} ${unit}`;
  return `${format(low)} to ${format(high)} ${unit}`;
}

function describeControl(
  control: RefineControl,
  value: RefineValue | undefined,
): string {
  switch (control.kind) {
    case "range":
      return describeRange(control, value ?? control.initial);
    case "level": {
      const floor = typeof value === "number" ? value : control.initial;
      return floor <= control.stops[0] ? "any" : control.format(floor);
    }
    case "window": {
      const span = typeof value === "number" ? value : control.initial;
      return (
        control.options.find((option) => option.value === span)?.label ?? "any"
      );
    }
    case "choices": {
      const chosen = Array.isArray(value)
        ? (value as readonly string[])
        : control.initial;
      if (chosen.length === control.options.length) return "all";
      if (chosen.length === 0) return "none";
      return control.options
        .filter((option) => chosen.includes(option.value))
        .map((option) => option.label)
        .join(" ");
    }
  }
}

export function summarise(
  controls: readonly RefineControl[],
  values: RefineValues,
): string {
  return controls
    .map(
      (control) =>
        `${control.short} ${describeControl(control, values[control.id])}`,
    )
    .join(", ");
}
