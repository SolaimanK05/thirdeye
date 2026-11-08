"use client";

import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import type { Ref } from "react";
import { isFilter } from "@/state/filters";
import { cx } from "./cx";
import type { Filter } from "./types";

const OPTIONS: readonly { value: Filter; label: string; name: string }[] = [
  { value: "all", label: "All", name: "All" },
  { value: "starred", label: "Starred", name: "Starred only" },
  { value: "none", label: "Off", name: "Off" },
];

type Props = {
  /** What the switch controls, spoken as "<name> filter". */
  name: string;
  /** `mixed` presses nothing: the modules it covers disagree. */
  value: Filter | "mixed";
  onChange: (filter: Filter) => void;
  /** The wide, green-when-pressed look used for the every-module switch. */
  prominent?: boolean;
  /** Stretch the three buttons to the width of the row. */
  fill?: boolean;
  groupRef?: Ref<HTMLDivElement>;
};

/** An All / Starred / Off switch. Pressing the pressed button changes nothing. */
export function FilterSwitch({
  name,
  value,
  onChange,
  prominent = false,
  fill = false,
  groupRef,
}: Props) {
  return (
    <ToggleGroup
      ref={groupRef}
      aria-label={`${name} filter`}
      value={value === "mixed" ? [] : [value]}
      onValueChange={(next) => {
        const [picked] = next;
        if (isFilter(picked)) onChange(picked);
      }}
      className={cx("flex border border-line-2", fill ? "w-full" : "shrink-0")}
    >
      {OPTIONS.map((option) => (
        <Toggle
          key={option.value}
          value={option.value}
          aria-label={option.name}
          className={cx(
            fill && "flex-1",
            "px-2 py-1 text-secondary text-ink-2 transition-colors duration-120 ease-out first:border-0 not-first:border-line-2 not-first:border-l hover-fine:text-ink max-lg:min-h-11 max-lg:px-3",
            prominent
              ? "data-pressed:bg-accent data-pressed:text-ground"
              : "data-pressed:bg-line-2 data-pressed:text-ink",
          )}
        >
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
