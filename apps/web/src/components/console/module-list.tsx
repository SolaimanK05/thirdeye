"use client";

import { ChevronDown, Star } from "lucide-react";
import { useConsole } from "./console-shell";
import { cx } from "./cx";
import { Disclosure } from "./disclosure";
import {
  everyModuleFilter,
  FILTER_LABEL,
  HEALTH,
  inRange,
  isOn,
  type ModuleNote,
  moduleNote,
  railCounts,
} from "./status";
import type {
  ConsoleSnapshot,
  Filter,
  ModuleRow,
  StarredEntity,
  ZoomLevel,
} from "./types";
import { zoomLevelFor } from "./zoom";

type Props = Pick<ConsoleSnapshot, "domains" | "starred">;

const NOTE_TONE: Record<ModuleNote["tone"], string> = {
  "ink-3": "text-ink-3",
  "ink-2": "text-ink-2",
  red: "text-red",
  amber: "text-amber",
};

const AGE_TONE: Record<StarredEntity["tone"], string> = {
  normal: "text-ink-2",
  stale: "text-amber",
  gap: "text-red",
};

export function ModuleList({ domains, starred }: Props) {
  const { zoomPercent } = useConsole();
  const zoom = zoomLevelFor(zoomPercent).level;
  const { on, drawn } = railCounts(domains, zoom);
  const every = everyModuleFilter(domains);

  return (
    <>
      <Disclosure
        title="[ MODULES ]"
        meta={
          <span className="text-ink-3 text-label tracking-normal tabular-nums">
            {on} on, {drawn} drawn
          </span>
        }
        className="border-line border-b"
        summaryClassName="px-3 pt-1 lg:in-data-[rail=left]:pr-11"
        titleClassName="whitespace-nowrap"
      >
        <div className="flex items-center justify-between gap-2 px-3 pt-1 pb-2.5">
          <span className="whitespace-nowrap text-ink-2 text-label tracking-normal xl:tracking-[0.08em]">
            EVERY MODULE <kbd className="text-ink-3">[g]</kbd>
          </span>
          <FilterButton
            name="Every module"
            value={every}
            dim={every === "mixed"}
            className="w-28 xl:w-30"
          />
        </div>

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
                <ModuleRowItem key={row.id} row={row} zoom={zoom} />
              ))}
            </ul>
          </Disclosure>
        ))}
      </Disclosure>

      <Disclosure
        title={
          <span className="flex items-center gap-1.5 text-amber">
            <Star size={13} aria-hidden="true" />
            <span className="sr-only">Starred</span>
            <span className="tabular-nums">{starred.length}</span>
          </span>
        }
        className="border-line border-b pb-3"
        summaryClassName="px-3"
      >
        {starred.length === 0 ? (
          <p className="px-3 text-ink-3 text-secondary">
            None yet. Select something, press s.
          </p>
        ) : (
          <ul>
            {starred.map((entity) => (
              <li key={entity.id}>
                <button
                  type="button"
                  className="grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-1 text-left transition-colors duration-120 ease-out hover-fine:bg-well"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-ink">{entity.name}</span>
                    <span className="text-ink-3 text-label tracking-normal">
                      {entity.module}
                    </span>
                  </span>
                  <span
                    className={cx(
                      "text-label tracking-normal tabular-nums",
                      AGE_TONE[entity.tone],
                    )}
                  >
                    {entity.age}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Disclosure>
    </>
  );
}

function ModuleRowItem({ row, zoom }: { row: ModuleRow; zoom: ZoomLevel }) {
  const health = HEALTH[row.health];
  const note = moduleNote(row, zoom);
  const on = isOn(row);
  const shown = on && inRange(row, zoom);

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
        {shown && row.inView ? row.inView : ""}
      </span>

      {row.health === "missing-key" ? (
        <span className="h-6.5 border border-line-2 border-dashed text-center text-ink-3 text-micro leading-6">
          NO KEY
        </span>
      ) : (
        <FilterButton
          name={row.name}
          value={row.filter}
          dim={!shown}
          className="w-full"
        />
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

const FILTER_TONE: Record<Filter | "mixed", string> = {
  all: "text-ink",
  starred: "text-amber",
  none: "text-ink-3",
  mixed: "text-ink-2",
};

function FilterButton({
  name,
  value,
  dim,
  className,
}: {
  name: string;
  value: Filter | "mixed";
  dim: boolean;
  className: string;
}) {
  const label = FILTER_LABEL[value];
  return (
    <button
      type="button"
      aria-label={`${name} filter: ${label.toLowerCase()}`}
      className={cx(
        "flex h-6.5 items-center justify-between gap-1 border border-line-2 px-1.5 text-label tracking-normal transition-colors duration-120 ease-out hover-fine:border-ink-3 xl:px-1.75",
        value === "all" && dim ? "text-ink-2" : FILTER_TONE[value],
        className,
      )}
    >
      {value === "starred" ? (
        <Star size={13} aria-hidden="true" />
      ) : (
        <span aria-hidden="true">{label}</span>
      )}
      <ChevronDown size={12} aria-hidden="true" className="text-ink-3" />
    </button>
  );
}
