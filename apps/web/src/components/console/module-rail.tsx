import { Clock } from "./clock";
import { GlobeStyleMenu } from "./globe-style-menu";
import { ModuleList } from "./module-list";
import { ModuleStatusLines } from "./module-status-lines";
import { CollapsedStrip, SidebarBody } from "./sidebar-toggle";
import type { ConsoleSnapshot } from "./types";

type Props = Pick<ConsoleSnapshot, "domains" | "starred">;

export function ModuleRail({ domains, starred }: Props) {
  return (
    <nav
      aria-label="Modules"
      className="relative hidden min-h-0 flex-col border-line border-r bg-panel [grid-area:rail] lg:flex"
    >
      <CollapsedStrip side="left" label="Modules" />
      <SidebarBody side="left" id="modules-rail" label="Modules">
        <ModuleList domains={domains} starred={starred} />
      </SidebarBody>
    </nav>
  );
}

type MenuProps = Pick<
  ConsoleSnapshot,
  "domains" | "starred" | "instance" | "sampleData"
>;

export function MobileMenu({
  domains,
  starred,
  instance,
  sampleData,
}: MenuProps) {
  return (
    <>
      <div className="flex items-center justify-between gap-3 border-line border-b px-3 py-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-ink-3 text-micro uppercase">{instance}</span>
          {sampleData && (
            <span className="self-start border border-amber px-1.5 py-0.5 text-amber text-micro leading-none">
              SAMPLE
            </span>
          )}
        </div>
        <Clock />
      </div>
      <div className="flex items-center justify-between gap-3 border-line border-b px-3 py-2.5">
        <span className="text-ink-3 text-label">GLOBE</span>
        <GlobeStyleMenu />
      </div>
      <nav aria-label="Modules">
        <ModuleList domains={domains} starred={starred} />
      </nav>
      <ModuleStatusLines className="border-line border-t px-3 py-3" />
    </>
  );
}
