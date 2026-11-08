"use client";

import { Popover } from "@base-ui/react/popover";
import { CircleHelp } from "lucide-react";

/** What the number beside a layer's name counts, which depends on whether it is drawn. */
export function countHint(name: string, inView: number | undefined): string {
  return inView === undefined
    ? `Everything the server holds for ${name.toLowerCase()}. Turn the layer on and this becomes the number in view.`
    : `Only what is in view now: ${name.toLowerCase()} on the visible side of the globe that pass your filters and the draw limit. Switch the layer off to see the full total the server holds.`;
}

export function CountHint({
  name,
  inView,
}: {
  name: string;
  inView: number | undefined;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={150}
        closeDelay={100}
        aria-label={`What the ${name.toLowerCase()} number means`}
        className="relative flex size-4 shrink-0 items-center justify-center self-center text-ink-3 outline-none transition-colors duration-120 ease-out before:absolute before:size-8 hover-fine:text-ink focus-visible:text-accent data-popup-open:text-accent max-lg:size-6"
      >
        <CircleHelp size={14} strokeWidth={1.5} aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="end" className="z-50">
          <Popover.Popup className="w-60 origin-(--transform-origin) border border-line-2 bg-panel px-3 py-2 text-ink-2 text-secondary shadow-float transition-[opacity,scale] duration-140 ease-out data-ending-style:scale-97 data-starting-style:scale-97 data-ending-style:opacity-0 data-starting-style:opacity-0 data-ending-style:duration-100">
            <Popover.Description>{countHint(name, inView)}</Popover.Description>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
