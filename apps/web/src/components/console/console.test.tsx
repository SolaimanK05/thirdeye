import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Providers } from "@/app/providers";
import { quakeSelection } from "@/modules/earthquakes/selection";
import { QUAKE_DETAIL } from "@/modules/earthquakes/test-data";
import { ConsoleShell } from "./console-shell";
import { Footer } from "./footer";
import { GlobeArea } from "./globe-area";
import { Header } from "./header";
import { MobileMenu, ModuleRail } from "./module-rail";
import { SAMPLE } from "./sample";
import { LiveSelection } from "./selection-live";
import { SelectionDetails } from "./selection-panel";
import { ZoomControl } from "./zoom-control";

const HERE = fileURLToPath(new URL(".", import.meta.url));

const render = (node: ReactNode) =>
  renderToStaticMarkup(<Providers>{node}</Providers>);

function renderConsole() {
  return render(
    <ConsoleShell
      initialZoom={SAMPLE.zoomPercent}
      initialGlobeStyle={SAMPLE.globeStyle}
      initialCentre={SAMPLE.centre}
    >
      <Header
        instance={SAMPLE.instance}
        sampleData={SAMPLE.sampleData}
        alerts={SAMPLE.alerts}
        menu={
          <MobileMenu
            domains={SAMPLE.domains}
            starred={SAMPLE.starred}
            instance={SAMPLE.instance}
            sampleData={SAMPLE.sampleData}
          />
        }
      />
      <ModuleRail domains={SAMPLE.domains} starred={SAMPLE.starred} />
      <GlobeArea hud={SAMPLE.hud} />
      <LiveSelection />
      <Footer alerts={SAMPLE.alerts} />
    </ConsoleShell>,
  );
}

const count = (html: string, pattern: RegExp) =>
  html.match(pattern)?.length ?? 0;

const visibleText = (html: string) =>
  html
    .replace(/<svg[\s\S]*?<\/svg>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

describe("console structure", () => {
  const html = renderConsole();

  test("has one of each landmark and a single h1", () => {
    expect(count(html, /<header[\s>]/g)).toBe(1);
    expect(count(html, /<nav aria-label="Modules"/g)).toBe(1);
    expect(count(html, /<main[\s>]/g)).toBe(1);
    expect(count(html, /<aside aria-label="Selection"/g)).toBe(1);
    expect(count(html, /<footer[\s>]/g)).toBe(1);
    expect(count(html, /<h1[\s>]/g)).toBe(1);
  });

  test("every button declares its type", () => {
    const buttons = count(html, /<button[\s>]/g);
    expect(buttons).toBeGreaterThan(10);
    expect(count(html, /<button[^>]*\stype="button"/g)).toBe(buttons);
  });

  test("the search box has a label", () => {
    expect(html).toContain('<label for="console-search"');
    expect(html).toContain('id="console-search"');
  });

  test("the clock renders a placeholder on the server", () => {
    expect(html).toContain("--:--:--Z");
  });

  test("text uses no middle-dot separators", () => {
    expect(visibleText(html)).not.toContain("·");
    expect(visibleText(renderSelection())).not.toContain("·");
  });

  test("the phone layout has a menu button and a search button", () => {
    expect(html).toContain('aria-label="Open modules"');
    expect(html).toContain('aria-label="Search"');
  });
});

describe("sidebars", () => {
  const html = renderConsole();

  test("both sidebars start open with a collapse button each", () => {
    expect(html).toContain('data-left="open"');
    expect(html).toContain('data-right="open"');
    expect(html).toContain('aria-label="Collapse Modules"');
    expect(html).toContain('aria-label="Collapse Selection"');
    expect(
      count(html, /aria-label="Collapse [^"]+" aria-expanded="true"/g),
    ).toBe(2);
  });

  test("there is no hide-everything button any more", () => {
    expect(html).not.toContain("HIDE");
  });

  test("every section is a disclosure with a heading and a chevron", () => {
    const rail = [
      "[ MODULES ]",
      "EARTH",
      "MOVERS",
      "INFRASTRUCTURE",
      "Starred",
    ];
    const panel = ["[ EVENT ]", "[ DETAILS ]", "[ PROVENANCE ]"];
    for (const [markup, sections] of [
      [html, rail],
      [renderSelection(), panel],
    ] as const) {
      const summaries = markup.match(/<summary[\s\S]*?<\/summary>/g) ?? [];
      for (const title of sections) {
        const summary = summaries.find((s) => s.includes(title));
        expect(summary, title).toBeDefined();
        expect(summary, title).toMatch(/<h[23][\s>]/);
        expect(summary, title).toContain("lucide-chevron-down");
      }
      expect(count(markup, /<details open=""/g)).toBe(sections.length);
    }
  });
});

describe("zoom control", () => {
  const html = renderConsole();

  test("starts at 100% with icon buttons on either side", () => {
    expect(html).toContain('aria-label="Zoom in"');
    expect(html).toContain('aria-label="Zoom out"');
    expect(html).toContain('role="spinbutton"');
    expect(html).toContain('value="100"');
    expect(html).toContain('aria-valuetext="100 percent, global"');
  });

  test("the HUD shows the matching altitude, centre and scale", () => {
    expect(html).toContain("7,240 km, GLOBAL");
    expect(html).toContain("11.0°N 86.0°E");
    expect(html).toContain("1,000 km");
  });

  test("a different starting zoom moves everything with it", () => {
    const zoomed = render(
      <ConsoleShell
        initialZoom={400}
        initialGlobeStyle="GREEN"
        initialCentre={SAMPLE.centre}
      >
        <GlobeArea hud={SAMPLE.hud} />
      </ConsoleShell>,
    );
    expect(zoomed).toContain("1,810 km, REGIONAL");
    expect(zoomed).toContain("200 km");
  });
});

describe("globe", () => {
  test("the server renders a placeholder, never Cesium", () => {
    const html = renderConsole();
    expect(html).toContain("globe-placeholder");
    expect(html).not.toContain("cesium-widget");
  });

  test("Cesium is only reached through the client-only canvas", () => {
    const sources = readdirSync(HERE).filter(
      (file) => /\.tsx?$/.test(file) && !file.includes(".test."),
    );
    const importing = (pattern: RegExp) =>
      sources.filter((file) =>
        pattern.test(readFileSync(join(HERE, file), "utf8")),
      );
    expect(importing(/from "cesium"|import "cesium/)).toEqual([
      "globe-canvas.tsx",
      "globe-vectors.ts",
      "marker-overlay.ts",
    ]);
    expect(importing(/from "\.\/globe-vectors"/)).toEqual(["globe-canvas.tsx"]);
    expect(
      importing(
        /import \{[^}]*\bMarkerOverlay\b[^}]*\} from "\.\/marker-overlay"/,
      ),
    ).toEqual(["globe-canvas.tsx"]);
    expect(readFileSync(join(HERE, "globe-view.tsx"), "utf8")).toMatch(
      /ssr: false/,
    );
  });
});

describe("globe style", () => {
  test("the menu button names the current style", () => {
    const html = renderConsole();
    expect(html).toContain('aria-label="Globe style: green"');
    expect(html).toContain(">GREEN<");
  });
});

describe("module rail", () => {
  const html = renderConsole();

  test("health glyphs carry a text label for screen readers", () => {
    expect(html).toContain('<span aria-hidden="true">[+]</span>');
    expect(html).toContain('<span class="sr-only">fresh</span>');
    expect(html).toContain(
      '<span class="sr-only">stale, serving last good</span>',
    );
  });

  test("a module without its key says which key and has no filter", () => {
    expect(html).toContain("needs FIRMS_MAP_KEY");
    expect(html).toContain("NO KEY");
    expect(html).not.toContain('aria-label="Wildfires filter');
    expect(html).toContain('aria-label="Earthquakes filter: all"');
  });

  test("summarises modules on and drawn", () => {
    expect(html).toContain("5 on, 5 drawn");
  });

  test("notes describe zoom in percent", () => {
    expect(html).toContain("auto, any zoom");
    expect(html).toContain("auto from 60%");
    expect(html).toContain("auto to 199%");
  });
});

function renderSelection() {
  return render(
    <ConsoleShell
      initialZoom={100}
      initialGlobeStyle="GREEN"
      initialCentre={SAMPLE.centre}
    >
      <SelectionDetails
        selection={quakeSelection(
          QUAKE_DETAIL,
          Date.parse("2026-10-14T06:05:00Z"),
        )}
      />
    </ConsoleShell>,
  );
}

describe("selection panel", () => {
  test("prompts when nothing is selected", () => {
    const html = renderConsole();
    expect(html).toContain("Select something on the globe, or search.");
    expect(html).toContain("Tap something on the globe.");
  });

  test("shows provenance and every limitation word for word", () => {
    const html = renderSelection();
    expect(html).toContain("[ PROVENANCE ]");
    expect(html).toContain("LIMITS");
    for (const limitation of QUAKE_DETAIL.provenance?.limitations ?? []) {
      expect(html).toContain(limitation);
    }
  });

  test("the phone sheet starts collapsed", () => {
    const html = renderConsole();
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="selection-details"');
  });

  test("each value carries a confidence tag with its meaning", () => {
    const html = renderSelection();
    expect(html).toContain('title="observed by a sensor"');
    expect(html).toContain('title="derived (computed)"');
  });
});

describe("live data placeholders", () => {
  const html = renderConsole();

  test("the footer waits for the API instead of showing sample health", () => {
    expect(html).toContain("connecting to API");
    expect(html).not.toContain("opensky cooldown");
  });

  test("no attribution is invented before the modules load", () => {
    expect(html).not.toContain("Data:");
    expect(html).not.toContain("AISStream.io");
  });
});

describe("client boundary", () => {
  test("console pieces refuse to render outside the shell", () => {
    expect(() => renderToStaticMarkup(<ZoomControl />)).toThrow(
      /inside ConsoleShell/,
    );
  });

  test("layout pieces stay server components", () => {
    const serverOnly = [
      "disclosure.tsx",
      "footer.tsx",
      "globe-area.tsx",
      "header.tsx",
      "module-rail.tsx",
      "search-field.tsx",
      "selection-panel.tsx",
    ];
    for (const file of serverOnly) {
      const source = readFileSync(join(HERE, file), "utf8");
      expect(source, file).not.toMatch(/^["']use client["']/);
    }
  });

  test("client components are small leaves", () => {
    const clientFiles = readdirSync(HERE)
      .filter((file) => /\.tsx?$/.test(file) && !file.includes(".test."))
      .filter((file) =>
        /^["']use client["']/.test(readFileSync(join(HERE, file), "utf8")),
      )
      .sort();
    expect(clientFiles).toEqual([
      "attribution.tsx",
      "clock.tsx",
      "console-shell.tsx",
      "globe-canvas.tsx",
      "globe-hud.tsx",
      "globe-style-menu.tsx",
      "globe-view.tsx",
      "layer-markers.tsx",
      "mobile-search.tsx",
      "module-list.tsx",
      "module-status-lines.tsx",
      "modules-drawer.tsx",
      "selection-dock.tsx",
      "selection-live.tsx",
      "sidebar-toggle.tsx",
      "use-now.ts",
      "zoom-control.tsx",
    ]);
  });
});
