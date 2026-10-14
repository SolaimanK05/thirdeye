import { ConsoleShell } from "@/components/console/console-shell";
import { Footer } from "@/components/console/footer";
import { GlobeArea } from "@/components/console/globe-area";
import { Header } from "@/components/console/header";
import { MobileMenu, ModuleRail } from "@/components/console/module-rail";
import { SAMPLE } from "@/components/console/sample";
import { LiveSelection } from "@/components/console/selection-live";

export default function Home() {
  const snapshot = SAMPLE;

  return (
    <ConsoleShell
      initialZoom={snapshot.zoomPercent}
      initialGlobeStyle={snapshot.globeStyle}
      initialCentre={snapshot.centre}
    >
      <Header
        instance={snapshot.instance}
        sampleData={snapshot.sampleData}
        alerts={snapshot.alerts}
        menu={
          <MobileMenu
            domains={snapshot.domains}
            starred={snapshot.starred}
            instance={snapshot.instance}
            sampleData={snapshot.sampleData}
          />
        }
      />
      <ModuleRail domains={snapshot.domains} starred={snapshot.starred} />
      <GlobeArea hud={snapshot.hud} />
      <LiveSelection />
      <Footer alerts={snapshot.alerts} />
    </ConsoleShell>
  );
}
