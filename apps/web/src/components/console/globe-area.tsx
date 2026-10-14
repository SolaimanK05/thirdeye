import { Attribution } from "./attribution";
import { cx } from "./cx";
import { GLOBE_CREDITS_ID } from "./globe-config";
import { GlobeHud } from "./globe-hud";
import { GlobeView } from "./globe-view";

const CORNERS = [
  "top-2 left-2 border-t border-l lg:top-3.5 lg:left-3.5",
  "top-2 right-2 border-t border-r lg:top-3.5 lg:right-3.5",
  "bottom-18 left-2 border-b border-l lg:bottom-3.5 lg:left-3.5",
  "bottom-18 right-2 border-r border-b lg:right-3.5 lg:bottom-3.5",
];

export function GlobeArea() {
  return (
    <main className="relative min-h-0 overflow-hidden bg-space [container-type:size] [grid-area:globe]">
      <h2 className="sr-only">Globe</h2>
      <div
        aria-hidden="true"
        className="starfield absolute inset-0 opacity-90"
      />
      <GlobeView />

      {CORNERS.map((corner) => (
        <span
          key={corner}
          aria-hidden="true"
          className={cx("absolute size-4.5 border-ink-3", corner)}
        />
      ))}

      <GlobeHud />

      <div className="absolute right-4 bottom-20 z-5 flex max-w-[60%] flex-col items-end gap-1.5 lg:right-6 lg:bottom-5.5 lg:max-w-[46%]">
        <div id={GLOBE_CREDITS_ID} className="globe-credits" />
        <Attribution />
      </div>
    </main>
  );
}
