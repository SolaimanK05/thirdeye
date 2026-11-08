"use client";

import { Drawer } from "@base-ui/react/drawer";
import { Menu, X } from "lucide-react";
import type { ReactNode } from "react";

export function ModulesDrawer({ children }: { children: ReactNode }) {
  return (
    <Drawer.Root swipeDirection="left">
      <Drawer.Trigger
        aria-label="Open modules"
        className="flex size-11 shrink-0 items-center justify-center text-ink-2 transition-colors duration-120 ease-out hover-fine:text-accent lg:hidden"
      >
        <Menu size={22} />
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Backdrop className="fixed inset-0 z-40 bg-space/70 transition-opacity duration-220 ease-out data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Drawer.Viewport className="fixed inset-0 z-50 flex justify-start">
          <Drawer.Popup className="flex h-full w-[min(320px,88vw)] translate-x-(--drawer-swipe-movement-x) flex-col border-line-2 border-r bg-panel transition-transform duration-220 ease-out data-ending-style:-translate-x-full data-starting-style:-translate-x-full data-swiping:transition-none">
            <Drawer.Content className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center justify-between border-line border-b py-1 pr-1 pl-3">
                <Drawer.Title className="text-ink-3 text-label">
                  CONSOLE
                </Drawer.Title>
                <Drawer.Close
                  aria-label="Close"
                  className="flex size-11 items-center justify-center text-ink-2 hover-fine:text-accent"
                >
                  <X size={20} />
                </Drawer.Close>
              </div>
              <div className="rail-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {children}
              </div>
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
