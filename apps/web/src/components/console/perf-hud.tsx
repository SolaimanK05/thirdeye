"use client";

import { useEffect, useState } from "react";
import type { HubStats } from "@/data/stats";
import { hudRows } from "@/perf/format";
import { perfMetrics } from "@/perf/metrics";
import type { OverlayStats } from "./markers";

const REFRESH_MS = 500;

type Props = {
  stats: () => OverlayStats;
  renderer: () => "canvas" | "webgl2";
  data?: () => HubStats | null;
};

function supportsLongTasks(): boolean {
  return (
    typeof PerformanceObserver !== "undefined" &&
    PerformanceObserver.supportedEntryTypes.includes("longtask")
  );
}

export function PerfHud({ stats, renderer, data }: Props) {
  const [snapshot, setSnapshot] = useState(() => perfMetrics.snapshot());
  const [loaded, setLoaded] = useState(0);
  const [kind, setKind] = useState(renderer);
  const [hub, setHub] = useState<HubStats | null>(null);

  useEffect(() => {
    const observable = supportsLongTasks();
    perfMetrics.enable(observable);
    let frame = requestAnimationFrame(function tick(at) {
      perfMetrics.frame(at);
      frame = requestAnimationFrame(tick);
    });
    const observer = observable
      ? new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            perfMetrics.longTask(
              entry.startTime + entry.duration,
              entry.duration,
            );
          }
        })
      : null;
    observer?.observe({ type: "longtask", buffered: false });
    const timer = setInterval(() => {
      setSnapshot(perfMetrics.snapshot());
      setLoaded(stats().markers);
      setKind(renderer());
      setHub(data?.() ?? null);
    }, REFRESH_MS);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      clearInterval(timer);
      perfMetrics.disable();
    };
  }, [stats, renderer, data]);

  return (
    <section
      aria-label="Performance"
      className="pointer-events-none absolute top-24 left-4 z-6 w-62 border border-line-2 bg-panel px-2.5 py-2 text-label text-ink-3 tracking-[0.04em] tabular-nums lg:top-28 lg:left-6"
    >
      <dl className="m-0 flex flex-col gap-0.5">
        {hudRows(snapshot, loaded, kind, hub).map((row) => (
          <div key={row.key} className="flex justify-between gap-3">
            <dt>{row.label}</dt>
            <dd data-perf={row.key} className="m-0 text-right text-ink-2">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
