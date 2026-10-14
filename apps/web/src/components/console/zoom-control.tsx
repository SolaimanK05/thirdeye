"use client";

import { ZoomIn, ZoomOut } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { useConsole } from "./console-shell";
import { cx } from "./cx";
import {
  parseZoom,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomIn,
  zoomLevelFor,
  zoomOut,
} from "./zoom";

const BUTTON =
  "flex h-10 w-full items-center justify-center text-ink transition-colors duration-120 ease-out enabled:hover-fine:text-accent disabled:text-line-2";

export function ZoomControl({ className }: { className?: string }) {
  const { zoomPercent, setZoomPercent } = useConsole();
  const [draft, setDraft] = useState(String(zoomPercent));
  const [shown, setShown] = useState(zoomPercent);

  if (shown !== zoomPercent) {
    setShown(zoomPercent);
    setDraft(String(zoomPercent));
  }

  const commit = () => {
    const next = parseZoom(draft, zoomPercent);
    setDraft(String(next));
    setZoomPercent(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      commit();
    } else if (event.key === "Escape") {
      setDraft(String(zoomPercent));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setZoomPercent(zoomIn(zoomPercent));
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setZoomPercent(zoomOut(zoomPercent));
    }
  };

  return (
    <fieldset
      className={cx(
        "flex w-15 flex-col border border-line-2 bg-panel",
        className,
      )}
    >
      <legend className="sr-only">Zoom</legend>
      <button
        type="button"
        aria-label="Zoom in"
        disabled={zoomPercent >= ZOOM_MAX}
        onClick={() => setZoomPercent(zoomIn(zoomPercent))}
        className={BUTTON}
      >
        <ZoomIn size={18} strokeWidth={1.75} />
      </button>
      <label className="flex h-9 items-center justify-center gap-px border-line border-y focus-within:outline focus-within:outline-1 focus-within:outline-accent focus-within:outline-offset-2">
        <span className="sr-only">Zoom percentage</span>
        <input
          type="text"
          role="spinbutton"
          inputMode="numeric"
          enterKeyHint="done"
          autoComplete="off"
          maxLength={5}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          aria-valuenow={zoomPercent}
          aria-valuemin={ZOOM_MIN}
          aria-valuemax={ZOOM_MAX}
          aria-valuetext={`${zoomPercent} percent, ${zoomLevelFor(zoomPercent).name.toLowerCase()}`}
          onBlur={commit}
          onKeyDown={onKeyDown}
          className="w-9 bg-transparent text-right text-ink text-label tracking-normal tabular-nums focus-visible:outline-none"
        />
        <span
          aria-hidden="true"
          className="text-ink-3 text-label tracking-normal"
        >
          %
        </span>
      </label>
      <button
        type="button"
        aria-label="Zoom out"
        disabled={zoomPercent <= ZOOM_MIN}
        onClick={() => setZoomPercent(zoomOut(zoomPercent))}
        className={BUTTON}
      >
        <ZoomOut size={18} strokeWidth={1.75} />
      </button>
    </fieldset>
  );
}
