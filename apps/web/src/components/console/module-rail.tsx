import { Clock } from "./clock";
import { GlobeStyleMenu } from "./globe-style-menu";
import { ModuleList } from "./module-list";
import { ModuleStatusLines } from "./module-status-lines";
import { CollapsedStrip, SidebarBody } from "./sidebar-toggle";
import type { ConsoleSnapshot } from "./types";

export function ModuleRail() {
  return (
    <nav
      aria-label="Modules"
      className="relative hidden min-h-0 flex-col border-line border-r bg-panel [grid-area:rail] lg:flex"
    >
      <CollapsedStrip side="left" label="Modules" />
      <SidebarBody side="left" id="modules-rail" label="Modules">
        <ModuleList />
      </SidebarBody>
    </nav>
  );
}

type MenuProps = Pick<ConsoleSnapshot, "instance">;

export function MobileMenu({ instance }: MenuProps) {
  return (
    <>
      <div className="flex items-center justify-between gap-3 border-line border-b px-3 py-3">
        <span className="text-ink-3 text-micro uppercase">{instance}</span>
        <Clock />
      </div>
      <div className="flex items-center justify-between gap-3 border-line border-b px-3 py-2.5">
        <span className="text-ink-3 text-label">GLOBE</span>
        <GlobeStyleMenu />
      </div>
      <nav aria-label="Modules">
        <ModuleList />
      </nav>
      <ModuleStatusLines className="border-line border-t px-3 py-3" />
    </>
  );
}
