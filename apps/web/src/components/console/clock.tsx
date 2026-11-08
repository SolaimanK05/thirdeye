"use client";

import { useSyncExternalStore } from "react";
import { formatUtc, msUntilNextSecond } from "./time";

function subscribe(onTick: () => void) {
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    timer = setTimeout(() => {
      onTick();
      schedule();
    }, msUntilNextSecond(Date.now()));
  };
  schedule();
  return () => clearTimeout(timer);
}

const currentSecond = () => Math.floor(Date.now() / 1000);
const serverSecond = () => null;

export function Clock() {
  const second = useSyncExternalStore(subscribe, currentSecond, serverSecond);
  const parts = second === null ? null : formatUtc(new Date(second * 1000));

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <time
        dateTime={parts?.iso}
        className="font-display text-clock text-accent text-shadow-glow tabular-nums"
      >
        {parts?.time ?? "--:--:--Z"}
      </time>
      <span className="text-micro text-ink-3 tabular-nums">
        {parts?.date ?? "--- -- --- ----"}
      </span>
    </div>
  );
}
