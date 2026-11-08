import type { ReactNode } from "react";
import { Clock } from "./clock";
import { EyeMark } from "./eye-mark";
import { GlobeStyleMenu } from "./globe-style-menu";
import { MobileSearch } from "./mobile-search";
import { ModulesDrawer } from "./modules-drawer";
import { PublicBadge } from "./public-badge";
import { SearchField } from "./search-field";

type Props = {
  menu: ReactNode;
};

export function Header({ menu }: Props) {
  return (
    <header className="relative z-30 flex min-h-13 items-center gap-x-1 border-line border-b bg-ground px-1 py-1 [grid-area:header] lg:gap-x-4.5 lg:px-4">
      <ModulesDrawer>{menu}</ModulesDrawer>

      <div className="flex shrink-0 items-center gap-2.5 pl-1 lg:pl-0">
        <EyeMark className="text-accent drop-shadow-[0_0_4px_color-mix(in_oklab,var(--color-accent)_45%,transparent)]" />
        <h1 className="font-display text-accent text-clock text-shadow-glow tracking-[0.12em] lg:text-wordmark">
          THIRD EYE
        </h1>
        <PublicBadge />
      </div>

      <search className="hidden min-w-0 lg:block lg:max-w-155 lg:flex-[1_1_240px] xl:flex-[1_1_320px]">
        <SearchField id="console-search" hotkey />
      </search>

      <div className="ml-auto flex items-center lg:hidden">
        <MobileSearch />
      </div>

      <GlobeStyleMenu className="hidden lg:flex" />
      <div className="ml-auto hidden lg:block">
        <Clock />
      </div>
    </header>
  );
}
