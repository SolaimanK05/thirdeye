"use client";

import { Menu } from "@base-ui/react/menu";
import { ChevronDown, Star } from "lucide-react";
import type { Ref } from "react";
import { isFilter } from "@/state/filters";
import { cx } from "./cx";
import { FILTER_LABEL } from "./status";
import type { Filter } from "./types";

export type FilterChoice = {
  value: Filter;
  label: string;
  detail: string;
  count?: number;
};

type Props = {
  name: string;
  value: Filter | "mixed";
  choices: readonly FilterChoice[];
  onChange: (filter: Filter) => void;
  dim: boolean;
  className: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerRef?: Ref<HTMLButtonElement>;
};

const TRIGGER_TONE: Record<Filter | "mixed", string> = {
  all: "text-ink",
  starred: "text-amber",
  none: "text-ink-3",
  mixed: "text-ink-2",
};

const CHOICE_TONE: Record<Filter, string> = {
  all: "data-checked:text-accent",
  starred: "text-amber",
  none: "data-checked:text-accent",
};

export function FilterMenu({
  name,
  value,
  choices,
  onChange,
  dim,
  className,
  open,
  onOpenChange,
  triggerRef,
}: Props) {
  const label = FILTER_LABEL[value];
  return (
    <Menu.Root open={open} onOpenChange={onOpenChange}>
      <Menu.Trigger
        ref={triggerRef}
        aria-label={`${name} filter: ${label.toLowerCase()}`}
        className={cx(
          "flex h-6.5 items-center justify-between gap-1 border border-line-2 px-1.5 text-label tracking-normal transition-colors duration-120 ease-out hover-fine:border-ink-3 data-popup-open:border-accent data-popup-open:bg-well xl:px-1.75",
          value === "all" && dim ? "text-ink-2" : TRIGGER_TONE[value],
          className,
        )}
      >
        {value === "starred" ? (
          <Star size={13} aria-hidden="true" />
        ) : (
          <span aria-hidden="true">{label}</span>
        )}
        <ChevronDown size={12} aria-hidden="true" className="text-ink-3" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} align="end" className="z-50">
          <Menu.Popup
            aria-label={`${name} filter`}
            className="w-64 origin-(--transform-origin) border outline-none border-line-2 bg-panel shadow-float transition-[opacity,scale] duration-140 ease-out data-ending-style:scale-97 data-starting-style:scale-97 data-ending-style:opacity-0 data-starting-style:opacity-0 data-ending-style:duration-100"
          >
            <Menu.RadioGroup
              value={value === "mixed" ? "" : value}
              onValueChange={(next) => {
                if (isFilter(next)) onChange(next);
              }}
            >
              {choices.map((choice) => (
                <Menu.RadioItem
                  key={choice.value}
                  value={choice.value}
                  closeOnClick
                  className={cx(
                    "grid min-h-11 cursor-default grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-x-2 border-line border-b px-3 py-1.5 text-ink text-label outline-none last:border-b-0 data-highlighted:bg-well",
                    CHOICE_TONE[choice.value],
                  )}
                >
                  <Menu.RadioItemIndicator
                    keepMounted
                    className="data-unchecked:invisible"
                  >
                    <span aria-hidden="true">›</span>
                  </Menu.RadioItemIndicator>
                  <span className="flex min-w-0 flex-col">
                    <span>{choice.label}</span>
                    <span className="text-ink-3 text-micro tracking-normal">
                      {choice.detail}
                    </span>
                  </span>
                  <span className="text-ink-3 tabular-nums">
                    {choice.count ?? ""}
                  </span>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
