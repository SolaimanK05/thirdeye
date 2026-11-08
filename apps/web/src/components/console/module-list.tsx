"use client";

import { Tabs } from "@base-ui/react/tabs";
import { useQueryClient } from "@tanstack/react-query";
import { type RefObject, useEffect, useRef } from "react";
import { queryKeys } from "@/api/queries";
import { useFilters } from "@/state/filters";
import { usePins } from "@/state/pins";
import { useStarred } from "@/state/starred";
import { useConsole } from "./console-shell";
import { formatCount } from "./count";
import { CountHint } from "./count-hint";
import { cx } from "./cx";
import { FilterSwitch } from "./filter-switch";
import { isTyping } from "./hotkeys";
import { ModuleDetails } from "./module-details";
import { StarredList } from "./starred-section";
import {
  canShowHere,
  everyModuleFilter,
  isShown,
  type ModuleStatus,
  moduleStatus,
  railCounts,
  STATUS_LEGEND,
  type StatusState,
} from "./status";
import type { DomainGroup, ModuleRow, ZoomLevel } from "./types";
import { useRail } from "./use-rail";

/** Where the keys behind each "Needs ..." line are explained. */
const KEYS_HELP_URL =
  "https://github.com/SolaimanK05/thirdeye/blob/main/apps/api/.env.example";

const SQUARE: Record<StatusState, string> = {
  live: "bg-accent",
  attention: "bg-amber",
  off: "border border-ink-3",
};

const STATUS_TEXT: Record<StatusState, string> = {
  live: "text-accent",
  attention: "text-amber",
  off: "text-ink-2",
};

const SKELETON_ROWS = ["a", "b", "c"] as const;

const TAB =
  "min-h-11 flex-1 border-transparent border-b-2 px-2 text-center text-secondary text-ink-3 tracking-[0.12em] transition-colors duration-120 ease-out hover-fine:text-ink-2 data-active:border-accent data-active:text-accent lg:min-h-10";

function StatusSquare({ state }: { state: StatusState }) {
  return (
    <span
      aria-hidden="true"
      className={cx("size-1.5 shrink-0", SQUARE[state])}
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
    <p role={role} className={cx("px-4 py-3 text-secondary", tone)}>
      {children}
    </p>
  );
}

function ApiDown() {
  const queryClient = useQueryClient();
  return (
    <div
      role="alert"
      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-3 text-secondary"
    >
      <p className="text-red">API unreachable. Retrying.</p>
      <button
        type="button"
        onClick={() =>
          void queryClient.refetchQueries({ queryKey: queryKeys.modules })
        }
        className="text-accent underline-offset-2 hover-fine:underline max-lg:min-h-11"
      >
        Retry now
      </button>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div role="status" className="flex flex-col gap-5 px-4 py-4">
      <span className="sr-only">Loading modules</span>
      {SKELETON_ROWS.map((key) => (
        <span
          key={key}
          aria-hidden="true"
          className="flex animate-pulse flex-col gap-2.5 motion-reduce:animate-none"
        >
          <span className="h-4 w-2/5 bg-well" />
          <span className="h-6.5 w-full border border-line-2" />
        </span>
      ))}
    </div>
  );
}

/** Press g to put keyboard focus on the every-module switch. */
function useFocusHotkey(group: RefObject<HTMLDivElement | null>) {
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
      const element = group.current;
      if (!element?.checkVisibility()) return;
      event.preventDefault();
      const pressed = element.querySelector<HTMLElement>(
        '[aria-pressed="true"]',
      );
      (pressed ?? element.querySelector<HTMLElement>("button"))?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [group]);
}

function EveryModuleSwitch({ domains }: { domains: readonly DomainGroup[] }) {
  const setFilters = useFilters((state) => state.setFilters);
  const group = useRef<HTMLDivElement>(null);
  useFocusHotkey(group);
  const rows = domains
    .flatMap((domain) => domain.modules)
    .filter((row) => row.health !== "missing-key");

  return (
    <FilterSwitch
      name="Every module"
      value={everyModuleFilter(domains)}
      onChange={(filter) =>
        setFilters(
          rows.map((row) => row.id),
          filter,
        )
      }
      prominent
      fill
      groupRef={group}
    />
  );
}

function Legend() {
  return (
    <ul
      aria-label="What the colours mean"
      className="flex flex-wrap gap-x-4 gap-y-1.5 px-4 py-4 text-ink-3 text-secondary"
    >
      {STATUS_LEGEND.map((entry) => (
        <li key={entry.state} className="flex items-center gap-1.5">
          <StatusSquare state={entry.state} />
          {entry.label}
        </li>
      ))}
    </ul>
  );
}

function ModulesPanel() {
  const { level: zoom, over } = useConsole();
  const { status, domains } = useRail();
  const { drawn } = railCounts(domains, zoom, over);
  const rows = domains.flatMap((domain) => domain.modules);

  if (status === "loading") return <SkeletonRows />;
  if (status === "error") return <ApiDown />;
  if (rows.length === 0) {
    return (
      <RailMessage role="status">
        No modules enabled. Set MODULES_ENABLED.
      </RailMessage>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2.5 border-line border-b px-4 py-3">
        <div className="flex items-baseline justify-between gap-3 text-secondary">
          <span className="whitespace-nowrap text-ink-2">
            <span className="tabular-nums">{drawn}</span> drawn on the globe
          </span>
          <kbd
            title="Press g to jump to this switch"
            className="shrink-0 text-ink-3"
          >
            [g]
          </kbd>
        </div>
        <EveryModuleSwitch domains={domains} />
      </div>
      <ul>
        {rows.map((row) => (
          <ModuleCard
            key={row.id}
            row={row}
            zoom={zoom}
            over={over.has(row.id)}
          />
        ))}
      </ul>
      <Legend />
    </>
  );
}

function ModuleCard({
  row,
  zoom,
  over,
}: {
  row: ModuleRow;
  zoom: ZoomLevel;
  over: boolean;
}) {
  const setFilter = useFilters((state) => state.setFilter);
  const status = moduleStatus(row, zoom, over);
  const shown = isShown(row, zoom, over);

  if (row.health === "missing-key") {
    return (
      <li className="flex flex-col gap-2 border-line border-b px-4 py-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="min-w-0 truncate text-body text-ink-3">{row.name}</h2>
          <a
            href={KEYS_HELP_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`How to add the ${row.missingKey ?? "API"} key for ${row.name}`}
            className="shrink-0 text-accent text-secondary underline-offset-2 hover-fine:underline max-lg:flex max-lg:min-h-11 max-lg:items-center"
          >
            How to add
          </a>
        </div>
        <StatusLine status={status} />
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2.5 border-line border-b px-4 py-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <h2
          className={cx(
            "min-w-0 truncate text-body",
            shown ? "font-medium text-ink" : "text-ink-3",
          )}
        >
          {row.name}
        </h2>
        <div className="flex shrink-0 items-baseline gap-1.5">
          <CountHint name={row.name} inView={row.inView} />
          <span
            className={cx(
              "font-display text-count tabular-nums",
              shown ? "text-ink" : "text-ink-3",
            )}
          >
            {formatCount(row.inView ?? row.loaded)}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <StatusLine status={status} />
        <FilterSwitch
          name={row.name}
          value={row.filter}
          onChange={(filter) => setFilter(row.id, filter)}
        />
      </div>

      <HereControls row={row} zoom={zoom} over={over} />
      <ModuleDetails row={row} />
    </li>
  );
}

function StatusLine({ status }: { status: ModuleStatus }) {
  return (
    <span
      title={status.detail}
      className={cx(
        "flex min-w-0 items-center gap-1.5 text-secondary",
        status.failed ? "text-red" : STATUS_TEXT[status.state],
      )}
    >
      <StatusSquare state={status.state} />
      <span className="min-w-0 break-words">{status.text}</span>
    </span>
  );
}

function HereControls({
  row,
  zoom,
  over,
}: {
  row: ModuleRow;
  zoom: ZoomLevel;
  over: boolean;
}) {
  const showHere = canShowHere(row, zoom, over);
  if (!showHere && row.pinned === undefined) return null;
  return showHere ? (
    <HereButton
      label="SHOW HERE"
      name={`Show ${row.name} here`}
      onClick={() => usePins.getState().pin(row.id, zoom)}
    />
  ) : (
    <HereButton
      label="AUTO"
      name={`Return ${row.name} to automatic`}
      accent
      onClick={() => usePins.getState().unpin(row.id)}
    />
  );
}

function HereButton({
  label,
  name,
  accent = false,
  onClick,
}: {
  label: string;
  name: string;
  accent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={name}
      onClick={onClick}
      className={cx(
        "min-h-7 self-start border px-2.5 text-secondary tracking-[0.06em] transition-colors duration-120 ease-out focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-2 max-lg:min-h-11",
        accent
          ? "border-accent bg-accent/10 text-accent hover-fine:bg-accent hover-fine:text-ground"
          : "border-accent text-accent hover-fine:bg-accent hover-fine:text-ground",
      )}
    >
      {label}
    </button>
  );
}

export function ModuleList() {
  const { status, domains } = useRail();
  const stars = useStarred();
  const modules = domains.reduce(
    (sum, domain) => sum + domain.modules.length,
    0,
  );

  return (
    <Tabs.Root defaultValue="modules" className="flex min-h-0 flex-1 flex-col">
      <Tabs.List
        aria-label="Sidebar"
        className="flex border-line border-b lg:in-data-[rail=left]:pr-11"
      >
        <Tabs.Tab value="modules" className={TAB}>
          MODULES{" "}
          <span className="tabular-nums">
            {status === "ready" ? modules : ""}
          </span>
        </Tabs.Tab>
        <Tabs.Tab value="starred" className={TAB}>
          STARRED{" "}
          <span className="tabular-nums">
            {stars.ready ? stars.items.length : ""}
          </span>
        </Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="modules">
        <ModulesPanel />
      </Tabs.Panel>
      <Tabs.Panel value="starred">
        <StarredList />
      </Tabs.Panel>
    </Tabs.Root>
  );
}
