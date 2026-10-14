import type { ReactNode } from "react";
import { Clock } from "./clock";
import { EyeMark } from "./eye-mark";
import { AlertsButton } from "./footer";
import { GlobeStyleMenu } from "./globe-style-menu";
import { MobileSearch } from "./mobile-search";
import { ModulesDrawer } from "./modules-drawer";
import { SearchField } from "./search-field";
import type { ConsoleSnapshot } from "./types";

type Props = Pick<ConsoleSnapshot, "instance" | "sampleData" | "alerts"> & {
  menu: ReactNode;
};

export function Header({ instance, sampleData, alerts, menu }: Props) {
  return (
    <header className="relative z-30 flex min-h-13 items-center gap-x-1 border-line border-b bg-ground px-1 py-1 [grid-area:header] lg:gap-x-4.5 lg:px-4">
      <ModulesDrawer>{menu}</ModulesDrawer>

      <div className="flex shrink-0 items-center gap-2.5 pl-1 lg:pl-0">
        <EyeMark className="text-accent drop-shadow-[0_0_4px_color-mix(in_oklab,var(--color-accent)_45%,transparent)]" />
        <h1 className="font-display text-accent text-clock text-shadow-glow tracking-[0.12em] lg:text-wordmark">
          THIRD EYE
        </h1>
        <span className="hidden border-line border-l pl-2.5 text-ink-3 text-micro uppercase xl:inline">
          {instance}
        </span>
        {sampleData && (
          <span className="hidden border border-amber px-1.5 py-0.5 text-amber text-micro leading-none lg:inline">
            SAMPLE
          </span>
        )}
      </div>

      <search className="hidden min-w-0 lg:block lg:max-w-155 lg:flex-[1_1_240px] xl:flex-[1_1_320px]">
        <SearchField id="console-search" />
      </search>

      <div className="ml-auto flex items-center lg:hidden">
        <MobileSearch />
        <AlertsButton
          alerts={alerts}
          className="size-11 justify-center gap-1"
        />
      </div>

      <GlobeStyleMenu className="hidden lg:flex" />
      <div className="ml-auto hidden lg:block">
        <Clock />
      </div>
    </header>
  );
}
