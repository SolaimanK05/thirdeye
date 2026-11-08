"use client";

import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import type { ReactNode } from "react";
import { type Side, useConsole } from "./console-shell";
import { cx } from "./cx";

const ICONS = {
  left: { close: PanelLeftClose, open: PanelLeftOpen },
  right: { close: PanelRightClose, open: PanelRightOpen },
} as const;

export function SidebarToggle({
  side,
  label,
  controls,
  className,
}: {
  side: Side;
  label: string;
  controls: string;
  className?: string;
}) {
  const { collapsed, toggleSide } = useConsole();
  const isCollapsed = collapsed[side];
  const Icon = isCollapsed ? ICONS[side].open : ICONS[side].close;

  return (
    <button
      type="button"
      aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${label}`}
      aria-expanded={!isCollapsed}
      aria-controls={controls}
      title={`${isCollapsed ? "Expand" : "Collapse"} ${label}`}
      onClick={() => toggleSide(side)}
      className={cx(
        "flex size-8 shrink-0 items-center justify-center text-ink-3 transition-colors duration-120 ease-out hover-fine:text-accent",
        className,
      )}
    >
      <Icon size={16} strokeWidth={1.75} />
    </button>
  );
}

export function CollapsedStrip({ side, label }: { side: Side; label: string }) {
  const { collapsed } = useConsole();
  if (!collapsed[side]) return null;

  return (
    <div
      aria-hidden="true"
      className="hidden h-full flex-col items-center pt-11 lg:flex"
    >
      <span className="text-ink-3 text-label [writing-mode:vertical-rl]">
        {label.toUpperCase()}
      </span>
    </div>
  );
}

export function toggleClassName(side: Side, isCollapsed: boolean): string {
  return cx(
    "absolute top-0.5 z-10 hidden bg-panel lg:flex",
    isCollapsed || side === "right"
      ? "left-1"
      : "right-[calc(var(--rail-gutter)+0.25rem)]",
  );
}

export function SidebarBody({
  side,
  id,
  label,
  className,
  children,
}: {
  side: Side;
  id: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const { collapsed } = useConsole();

  return (
    <>
      <SidebarToggle
        side={side}
        label={label}
        controls={id}
        className={toggleClassName(side, collapsed[side])}
      />
      <div
        id={id}
        data-rail={side}
        className={cx(
          "rail-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain",
          collapsed[side] && "lg:hidden",
          className,
        )}
      >
        {children}
      </div>
    </>
  );
}
