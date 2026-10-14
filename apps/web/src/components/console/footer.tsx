import { Bell, Play, Star } from "lucide-react";
import { cx } from "./cx";
import { ModuleStatusLines } from "./module-status-lines";
import { HEALTH } from "./status";
import type { ConsoleSnapshot, StatusLine } from "./types";

type Props = Pick<ConsoleSnapshot, "alerts">;

const HOURS = Array.from({ length: 25 }, (_, hour) => hour);
const TICK_LABELS = ["−24h", "−18h", "−12h", "−6h"];

export function Footer({ alerts }: Props) {
  return (
    <footer className="hidden min-h-16 items-center gap-x-5 border-line border-t bg-ground px-4 py-2 [grid-area:footer] lg:flex">
      <AlertsButton
        alerts={alerts}
        withLatest
        className="min-h-11 min-w-0 flex-[0_1_280px] border border-line-2 px-2.5 xl:flex-[0_1_360px]"
      />

      <div className="flex min-w-0 flex-[999_1_320px] items-center gap-3">
        <button
          type="button"
          aria-label="Play timeline"
          className="flex size-7.5 shrink-0 items-center justify-center border border-line-2 text-ink transition-colors duration-120 ease-out hover-fine:text-accent"
        >
          <Play size={12} fill="currentColor" />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center justify-between gap-2 text-ink-3 text-micro">
            <span className="flex items-center gap-1">
              24H
              <Star size={10} aria-hidden="true" />
              <span>ONLY</span>
              <span className="sr-only">starred</span>
            </span>
            <span>1×</span>
          </div>
          <div aria-hidden="true" className="relative h-4.5">
            <div className="absolute inset-x-0 top-2 h-px bg-line-2" />
            {HOURS.map((hour) => (
              <span
                key={hour}
                style={{ left: `${(hour / 24) * 100}%` }}
                className={cx(
                  "absolute w-px bg-ink-3",
                  hour % 6 === 0
                    ? "top-0.5 h-3.5 opacity-90"
                    : "top-1.25 h-2 opacity-50",
                )}
              />
            ))}
            <span className="absolute top-0 left-[99.4%] h-4.5 w-0.5 bg-accent shadow-glow" />
          </div>
          <div className="flex justify-between text-ink-3 text-micro tracking-normal tabular-nums">
            {TICK_LABELS.map((label) => (
              <span key={label}>{label}</span>
            ))}
            <span className="text-accent">T−30s</span>
          </div>
        </div>
      </div>

      <ModuleStatusLines className="items-end" />
    </footer>
  );
}

export function AlertsButton({
  alerts,
  withLatest = false,
  className,
}: {
  alerts: ConsoleSnapshot["alerts"];
  withLatest?: boolean;
  className?: string;
}) {
  const active = alerts.count > 0;
  return (
    <button
      type="button"
      className={cx(
        "flex items-center gap-2 text-left transition-colors duration-120 ease-out hover-fine:bg-well",
        className,
      )}
    >
      <span className="sr-only">Alerts</span>
      <span className="relative flex shrink-0 items-center">
        <Bell
          size={16}
          strokeWidth={1.75}
          aria-hidden="true"
          className={active ? "text-red" : "text-ink-3"}
        />
        {active && (
          <span
            aria-hidden="true"
            className="-top-0.5 -right-0.5 absolute size-1.5 rounded-full bg-red motion-safe:animate-ping"
          />
        )}
      </span>
      <span
        className={cx(
          "text-label tracking-normal tabular-nums",
          active ? "text-red" : "text-ink-3",
        )}
      >
        {alerts.count}
      </span>
      {withLatest && (
        <span className="truncate text-ink-2 text-secondary">
          {alerts.latest ?? "No alerts"}
        </span>
      )}
    </button>
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
