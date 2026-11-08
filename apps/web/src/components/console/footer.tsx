import { cx } from "./cx";
import { ModuleStatusLines } from "./module-status-lines";
import { ReplayBar } from "./replay-bar";
import { HEALTH } from "./status";
import type { StatusLine } from "./types";

export function Footer() {
  return (
    <footer className="hidden min-h-16 items-center gap-x-5 border-line border-t bg-ground px-4 py-2 [grid-area:footer] lg:flex">
      <ReplayBar />

      <ModuleStatusLines className="items-end" />
    </footer>
  );
}

export function StatusLines({
  status,
  className,
}: {
  status: readonly StatusLine[];
  className?: string;
}) {
  return (
    <ul
      className={cx(
        "flex flex-col gap-0.75 text-ink-3 text-label tracking-normal tabular-nums",
        className,
      )}
    >
      {status.map((line) => (
        <li key={line.text}>
          <span aria-hidden="true" className={HEALTH[line.health].tone}>
            {HEALTH[line.health].glyph}
          </span>
          <span className="sr-only">{HEALTH[line.health].label}:</span>{" "}
          {line.text}
        </li>
      ))}
    </ul>
  );
}
