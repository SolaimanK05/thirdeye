import { connection } from "next/server";
import { ConsoleShell } from "@/components/console/console-shell";
import {
  CONSOLE_DEFAULTS,
  DEFAULT_INSTANCE_NAME,
} from "@/components/console/defaults";
import { Footer } from "@/components/console/footer";
import { GlobeArea } from "@/components/console/globe-area";
import { Header } from "@/components/console/header";
import { MobileMenu, ModuleRail } from "@/components/console/module-rail";
import { LiveSelection } from "@/components/console/selection-live";

export default async function Home() {
  await connection();
  const instance = process.env.INSTANCE_NAME?.trim() || DEFAULT_INSTANCE_NAME;
  const { zoomPercent, globeStyle, centre, alerts } = CONSOLE_DEFAULTS;

  return (
    <ConsoleShell
      initialZoom={zoomPercent}
      initialGlobeStyle={globeStyle}
      initialCentre={centre}
    >
      <Header
        instance={instance}
        alerts={alerts}
        menu={<MobileMenu instance={instance} />}
      />
      <ModuleRail />
      <GlobeArea />
      <LiveSelection />
      <Footer alerts={alerts} />
    </ConsoleShell>
  );
}
