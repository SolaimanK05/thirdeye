"use client";

import { useEffect, useRef, useState } from "react";
import { useFilters } from "@/state/filters";
import { useConsole } from "./console-shell";
import { formatCount } from "./count";
import { cx } from "./cx";
import { Disclosure } from "./disclosure";
import { type FilterChoice, FilterMenu } from "./filter-menu";
import { isTyping } from "./hotkeys";
import { RefinePanel } from "./refine-panel";
import { StarredSection } from "./starred-section";
import {
  drawsAnything,
  everyModuleFilter,
  HEALTH,
  inRange,
  isOn,
  type ModuleNote,
  moduleNote,
  railCounts,
} from "./status";
import type { DomainGroup, Filter, ModuleRow, ZoomLevel } from "./types";
import { useRail } from "./use-rail";
import { zoomLevelFor } from "./zoom";

const NOTE_TONE: Record<ModuleNote["tone"], string> = {
  "ink-3": "text-ink-3",
  "ink-2": "text-ink-2",
  red: "text-red",
  amber: "text-amber",
};

const SKELETON_ROWS = ["a", "b", "c"] as const;

function rowChoices(row: ModuleRow): FilterChoice[] {
  return [
    {
      value: "all",
      label: "ALL",
      detail: "Draw everything in range",
      count: row.loaded,
    },
    {
      value: "starred",
      label: "STARRED",
      detail:
        row.starredCount > 0
          ? "Only starred items"
          : "Nothing starred in this module",
      count: row.starredCount,
    },
    {
      value: "none",
      label: "NONE",
      detail: "Hide it. Still loads and keeps alerting",
    },
  ];
}

function everyChoices(rows: readonly ModuleRow[]): FilterChoice[] {
  const count = (filter: Filter) =>
    rows.filter((row) => row.filter === filter).length;
  return [
    {
      value: "all",
      label: "ALL EVERYWHERE",
      detail: "Every module draws everything",
      count: count("all"),
    },
    {
      value: "starred",
      label: "STARRED EVERYWHERE",
      detail: "Every module draws starred items only",
      count: count("starred"),
    },
    {
      value: "none",
      label: "NONE EVERYWHERE",
      detail: "Hide everything. Modules keep loading",
      count: count("none"),
    },
  ];
}

function EveryModuleFilter({ domains }: { domains: readonly DomainGroup[] }) {
  const setFilters = useFilters((state) => state.setFilters);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const rows = domains
    .flatMap((domain) => domain.modules)
    .filter((row) => row.health !== "missing-key");
  const value = everyModuleFilter(domains);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "g" ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        isTyping(event.target) ||
        document.querySelector('[role="menu"]')
      ) {
        return;
      }
      if (!trigger.current?.checkVisibility()) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <FilterMenu
      name="Every module"
      value={value}
      choices={everyChoices(rows)}
      onChange={(filter) =>
        setFilters(
          rows.map((row) => row.id),
          filter,
        )
      }
      dim={value === "mixed"}
      className="w-28 xl:w-30"
      open={open}
      onOpenChange={setOpen}
      triggerRef={trigger}
    />
  );
}

function RailMessage({
  role,
  tone = "text-ink-3",
  children,
}: {
  role: "status" | "alert";
  tone?: string;
  children: string;
}) {
  return (
    <p role={role} className={cx("px-3 pb-2 text-secondary", tone)}>
      {children}
    </p>
  );
}

function SkeletonRows() {
  return (
    <div role="status" className="flex flex-col gap-3 px-3 py-2">
      <span className="sr-only">Loading modules</span>
      {SKELETON_ROWS.map((key) => (
        <span
          key={key}
          aria-hidden="true"
          className="grid animate-pulse grid-cols-[24px_minmax(0,1fr)_80px] items-center gap-x-2 motion-reduce:animate-none"
        >
          <span className="h-3 bg-well" />
          <span className="h-3 w-3/5 bg-well" />
          <span className="h-6.5 border border-line-2" />
        </span>
      ))}
    </div>
  );
}

export function ModuleList() {
  const { zoomPercent } = useConsole();
  const zoom = zoomLevelFor(zoomPercent).level;
  const { status, domains } = useRail();
  const { on, drawn } = railCounts(domains, zoom, zoomPercent);

  return (
    <>
      <Disclosure
        title="[ MODULES ]"
        meta={
          <span className="text-ink-3 text-label tracking-normal tabular-nums">
            {status === "ready" && domains.length > 0
              ? `${on} on, ${drawn} drawn`
              : ""}
          </span>
        }
        className="border-line border-b"
        summaryClassName="px-3 pt-1 lg:in-data-[rail=left]:pr-11"
        titleClassName="whitespace-nowrap"
      >
        {status === "loading" && <SkeletonRows />}
        {status === "error" && (
          <RailMessage role="alert" tone="text-red">
            API unreachable. Retrying.
          </RailMessage>
        )}
        {status === "ready" && domains.length === 0 && (
          <RailMessage role="status">
            No modules enabled. Set MODULES_ENABLED.
          </RailMessage>
        )}

        {status === "ready" && domains.length > 0 && (
          <div className="flex items-center justify-between gap-2 px-3 pt-1 pb-2.5">
            <span className="whitespace-nowrap text-ink-2 text-label tracking-normal xl:tracking-[0.08em]">
              EVERY MODULE <kbd className="text-ink-3">[g]</kbd>
            </span>
            <EveryModuleFilter domains={domains} />
          </div>
        )}

        {domains.map((domain) => (
          <Disclosure
            key={domain.label}
            title={domain.label}
            heading="h3"
            meta={<span aria-hidden="true" className="h-px flex-1 bg-line" />}
            className="border-line border-t pb-1"
            summaryClassName="px-3"
            titleClassName="tracking-[0.14em]"
          >
            <ul>
              {domain.modules.map((row) => (
                <ModuleRowItem
                  key={row.id}
                  row={row}
                  zoom={zoom}
                  percent={zoomPercent}
                />
              ))}
            </ul>
          </Disclosure>
        ))}
      </Disclosure>

      <StarredSection />
    </>
  );
}

function ModuleRowItem({
  row,
  zoom,
  percent,
}: {
  row: ModuleRow;
  zoom: ZoomLevel;
  percent: number;
}) {
  const health = HEALTH[row.health];
  const note = moduleNote(row, zoom, percent);
  const on = isOn(row);
  const shown = drawsAnything(row) && inRange(row, zoom, percent);

  return (
    <li className="grid grid-cols-[24px_minmax(0,1fr)_32px_88px] items-center gap-x-1.5 gap-y-1 py-1.5 pr-2.5 pl-3 transition-colors duration-120 ease-out hover-fine:bg-well lg:grid-cols-[22px_minmax(0,1fr)_28px_80px] xl:grid-cols-[24px_minmax(0,1fr)_32px_88px]">
      <span
        title={health.label}
        className={cx("text-label tracking-normal tabular-nums", health.tone)}
      >
        <span aria-hidden="true">{health.glyph}</span>
        <span className="sr-only">{health.label}</span>
      </span>

      <span className={cx("truncate", shown ? "text-ink" : "text-ink-3")}>
        {row.name}
      </span>

      <span className="text-right text-ink-3 text-label tracking-normal tabular-nums">
        {shown && row.inView ? formatCount(row.inView) : ""}
      </span>

      {row.health === "missing-key" ? (
        <span className="h-6.5 border border-line-2 border-dashed text-center text-ink-3 text-micro leading-6">
          NO KEY
        </span>
      ) : (
        <RowFilter row={row} dim={!shown} />
      )}

      <span className="col-span-3 col-start-2 flex min-w-0 items-center gap-1.5">
        <RangeBars row={row} zoom={zoom} on={on} />
        <span
          title={note.text}
          className={cx(
            "min-w-0 truncate text-micro tracking-[0.03em]",
            NOTE_TONE[note.tone],
          )}
        >
          {note.text}
        </span>
      </span>

      <RefinePanel row={row} />
    </li>
  );
}

function RangeBars({
  row,
  zoom,
  on,
}: {
  row: ModuleRow;
  zoom: ZoomLevel;
  on: boolean;
}) {
  const levels: ZoomLevel[] = [1, 2, 3, 4];
  return (
    <span aria-hidden="true" className="flex shrink-0 gap-0.5">
      {levels.map((level) => {
        const covered =
          row.zoomRange !== null &&
          level >= row.zoomRange[0] &&
          level <= row.zoomRange[1];
        const current = level === zoom;
        return (
          <span
            key={level}
            className={cx(
              "block h-2.25 w-1.25",
              covered && current && on && "bg-accent",
              covered && !(current && on) && "bg-ink-3",
              covered && !current && "opacity-65",
              !covered && "border",
              !covered && (current ? "border-ink-2" : "border-line-2"),
            )}
          />
        );
      })}
    </span>
  );
}

function RowFilter({ row, dim }: { row: ModuleRow; dim: boolean }) {
  const setFilter = useFilters((state) => state.setFilter);
  return (
    <FilterMenu
      name={row.name}
      value={row.filter}
      choices={rowChoices(row)}
      onChange={(filter) => setFilter(row.id, filter)}
      dim={dim}
      className="w-full"
    />
  );
}
