"use client";

import { Pause, Play, Star } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useModules } from "@/api/queries";
import { moversFromKey, moversKey } from "@/motion/movers";
import { DAY_MS } from "@/motion/trail";
import { isLive, REPLAY_SECONDS, useReplay } from "@/state/replay";
import { useStarred } from "@/state/starred";
import { cx } from "./cx";
import { useTrails } from "./use-trails";

const HOURS = Array.from({ length: 25 }, (_, hour) => hour);
const TICK_LABELS = ["−24h", "−18h", "−12h", "−6h"];
const STEP_MS = 60_000;

/** How far back, in words: "Live", "−3 h 20 min". */
export function backLabel(back: number): string {
  if (back <= 0) return "Live";
  const minutes = Math.round(back / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `−${rest} min`;
  return rest === 0 ? `−${hours} h` : `−${hours} h ${rest} min`;
}

/** Advances the replay clock one frame at a time while it plays. */
function useReplayClock(playing: boolean) {
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      useReplay.getState().tick(now - last);
      last = now;
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing]);
}

export function ReplayBar() {
  const { data: modules } = useModules();
  const moverKey = moversKey(modules);
  const movers = useMemo(
    () => new Set(moversFromKey(moverKey).keys()),
    [moverKey],
  );
  const trails = useTrails(movers);
  const { local, items } = useStarred();
  const starredMovers = items.some((item) => movers.has(item.module_id));
  const back = useReplay((state) => state.back);
  const playing = useReplay((state) => state.playing);
  const live = isLive({ back, playing });
  const ready = trails.length > 0;
  useReplayClock(playing);

  useEffect(() => {
    if (!ready) useReplay.getState().live();
  }, [ready]);

  const label = backLabel(back);
  return (
    <div className="flex min-w-0 flex-[999_1_320px] items-center gap-3">
      <button
        type="button"
        aria-label={playing ? "Pause replay" : "Play replay"}
        disabled={!ready}
        onClick={() =>
          playing ? useReplay.getState().pause() : useReplay.getState().play()
        }
        className="flex size-7.5 shrink-0 items-center justify-center border border-line-2 text-ink transition-colors duration-120 ease-out hover-fine:text-accent disabled:cursor-not-allowed disabled:text-ink-3 disabled:hover-fine:text-ink-3"
      >
        {playing ? (
          <Pause size={12} fill="currentColor" />
        ) : (
          <Play size={12} fill="currentColor" />
        )}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between gap-2 text-ink-3 text-micro">
          <span className="flex items-center gap-1">
            {ready ? (
              <>
                24H
                <Star size={10} aria-hidden="true" />
                <span>ONLY</span>
                <span className="sr-only">starred</span>
              </>
            ) : starredMovers ? (
              "Collecting history for your starred ships and aircraft"
            ) : (
              "Star a ship or aircraft to replay its last 24 hours"
            )}
          </span>
          <span className="flex items-center gap-2">
            {local && ready && (
              <span title="Stars live in your browser here, so the server keeps only the last hour of movement for them">
                last hour only
              </span>
            )}
            {playing && <span>{REPLAY_SECONDS} s = 24 h</span>}
            {!live && (
              <button
                type="button"
                onClick={() => useReplay.getState().live()}
                className="border border-accent px-1.5 text-accent hover-fine:bg-accent hover-fine:text-ground"
              >
                LIVE
              </button>
            )}
          </span>
        </div>
        <div className="relative h-4.5">
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-2 h-px bg-line-2"
          />
          {HOURS.map((hour) => (
            <span
              aria-hidden="true"
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
          <span
            aria-hidden="true"
            style={{ left: `${((DAY_MS - back) / DAY_MS) * 99.4}%` }}
            className="absolute top-0 h-4.5 w-0.5 bg-accent shadow-glow"
          />
          <input
            type="range"
            aria-label="Replay position"
            aria-valuetext={label}
            min={0}
            max={DAY_MS}
            step={STEP_MS}
            value={DAY_MS - back}
            disabled={!ready}
            onChange={(event) =>
              useReplay.getState().scrubTo(DAY_MS - Number(event.target.value))
            }
            className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          />
        </div>
        <div className="flex justify-between text-ink-3 text-micro tracking-normal tabular-nums">
          {TICK_LABELS.map((tick) => (
            <span key={tick}>{tick}</span>
          ))}
          <span className={live ? "text-accent" : "text-amber"}>{label}</span>
        </div>
      </div>
    </div>
  );
}
