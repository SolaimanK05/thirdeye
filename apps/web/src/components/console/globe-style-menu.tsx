"use client";

import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown, Globe } from "lucide-react";
import { useConsole } from "./console-shell";
import { cx } from "./cx";
import type { GlobeStyle } from "./types";

const STYLES: readonly GlobeStyle[] = ["GREEN", "NATURAL", "BLACK"];

const isGlobeStyle = (value: unknown): value is GlobeStyle =>
  STYLES.includes(value as GlobeStyle);

export function GlobeStyleMenu({ className }: { className?: string }) {
  const { globeStyle, setGlobeStyle } = useConsole();

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`Globe style: ${globeStyle.toLowerCase()}`}
        className={cx(
          "flex h-8.5 shrink-0 items-center gap-2 border border-line-2 px-2.5 text-ink transition-colors duration-120 ease-out hover-fine:border-ink-3 data-popup-open:border-accent data-popup-open:bg-well",
          className,
        )}
      >
        <Globe size={16} strokeWidth={1.5} className="text-accent" />
        <span className="text-label">{globeStyle}</span>
        <ChevronDown size={14} className="text-ink-3" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end" className="z-50">
          <Menu.Popup className="w-36 origin-(--transform-origin) border border-line-2 bg-panel shadow-float transition-[opacity,scale] duration-140 ease-out data-ending-style:scale-97 data-starting-style:scale-97 data-ending-style:opacity-0 data-starting-style:opacity-0 data-ending-style:duration-100">
            <Menu.RadioGroup
              value={globeStyle}
              onValueChange={(value) => {
                if (isGlobeStyle(value)) setGlobeStyle(value);
              }}
            >
              {STYLES.map((style) => (
                <Menu.RadioItem
                  key={style}
                  value={style}
                  closeOnClick
                  className="grid min-h-10 cursor-default grid-cols-[14px_minmax(0,1fr)] items-center gap-2.5 border-line border-b px-3 text-ink text-label outline-none last:border-b-0 data-checked:text-accent data-highlighted:bg-well"
                >
                  <Menu.RadioItemIndicator
                    keepMounted
                    className="data-unchecked:invisible"
                  >
                    <Check size={14} />
                  </Menu.RadioItemIndicator>
                  <span>{style}</span>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
