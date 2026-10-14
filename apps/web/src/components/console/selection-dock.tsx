"use client";

import { ChevronUp } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useConsole } from "./console-shell";
import { cx } from "./cx";
import {
  CollapsedStrip,
  SidebarToggle,
  toggleClassName,
} from "./sidebar-toggle";

type Props = {
  kind: string | null;
  name: string | null;
  children: ReactNode;
};

const BODY_ID = "selection-details";

export function SelectionDock({ kind, name, children }: Props) {
  const [expanded, setExpanded] = useState(false);
  const collapsed = useConsole().collapsed.right;

  return (
    <aside
      aria-label="Selection"
      className="fixed inset-x-0 bottom-0 z-30 flex max-h-[75dvh] flex-col border-line-2 border-t bg-panel pb-[env(safe-area-inset-bottom)] lg:relative lg:z-auto lg:max-h-none lg:min-h-0 lg:border-line lg:border-t-0 lg:border-l lg:pb-0 lg:[grid-area:panel]"
    >
      {name ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={BODY_ID}
          onClick={() => setExpanded((value) => !value)}
          className="flex min-h-14 w-full shrink-0 items-center gap-3 px-4 py-2 text-left lg:hidden"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-ink-3 text-micro">{kind}</span>
            <span
              className={cx(
                "font-display text-accent text-clock",
                expanded ? "text-balance" : "truncate",
              )}
            >
              {name}
            </span>
          </span>
          <ChevronUp
            size={20}
            aria-hidden="true"
            className={cx(
              "shrink-0 text-ink-2 transition-transform duration-220 ease-out",
              expanded && "rotate-180",
            )}
          />
        </button>
      ) : (
        <p className="flex h-14 items-center px-4 text-ink-3 lg:hidden">
          Tap something on the globe.
        </p>
      )}

      <CollapsedStrip side="right" label="Selection" />
      <SidebarToggle
        side="right"
        label="Selection"
        controls={BODY_ID}
        className={toggleClassName("right", collapsed)}
      />

      <div
        id={BODY_ID}
        data-rail="right"
        className={cx(
          "min-h-0 overflow-y-auto overscroll-contain border-line border-t lg:flex-1 lg:border-t-0",
          expanded ? "block" : "hidden",
          collapsed ? "lg:hidden" : "lg:block",
        )}
      >
        {children}
      </div>
    </aside>
  );
}
