import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { ModuleInfo } from "@/api/client";
import { queryKeys } from "@/api/queries";
import { moduleInfo } from "@/api/test-data";
import { Providers } from "@/app/providers";
import { quakeSelection } from "@/modules/earthquakes/selection";
import { QUAKE_DETAIL } from "@/modules/earthquakes/test-data";
import { ConsoleShell } from "./console-shell";
import { CONSOLE_DEFAULTS, DEFAULT_INSTANCE_NAME } from "./defaults";
import { Footer } from "./footer";
import { GlobeArea } from "./globe-area";
import { Header } from "./header";
import { MobileMenu, ModuleRail } from "./module-rail";
import { LiveSelection } from "./selection-live";
import { SelectionDetails } from "./selection-panel";
import { ZoomControl } from "./zoom-control";

const HERE = fileURLToPath(new URL(".", import.meta.url));

const render = (node: ReactNode) =>
  renderToStaticMarkup(<Providers>{node}</Providers>);

function consoleTree() {
  const { zoomPercent, globeStyle, centre, alerts } = CONSOLE_DEFAULTS;
  return (
    <ConsoleShell
      initialZoom={zoomPercent}
      initialGlobeStyle={globeStyle}
      initialCentre={centre}
    >
      <Header
        instance={DEFAULT_INSTANCE_NAME}
        alerts={alerts}
        menu={<MobileMenu instance={DEFAULT_INSTANCE_NAME} />}
      />
      <ModuleRail />
      <GlobeArea />
      <LiveSelection />
      <Footer alerts={alerts} />
    </ConsoleShell>
  );
}

function renderConsole() {
  return render(consoleTree());
}

function renderWithModules(modules: readonly ModuleInfo[]) {
  const client = new QueryClient();
  client.setQueryData(queryKeys.modules, [...modules]);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>{consoleTree()}</QueryClientProvider>,
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
    expect(buttons).toBeGreaterThan(5);
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
    const rail = ["[ MODULES ]", "Starred"];
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
        initialCentre={CONSOLE_DEFAULTS.centre}
      >
        <GlobeArea />
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
  const quakes = moduleInfo("earthquakes", "USGS", {
    name: "Earthquakes",
    cadence_seconds: 60,
  });
  const wildfires = moduleInfo(
    "wildfires",
    "FIRMS",
    {
      name: "Wildfires",
      requires_key: true,
      key_env: "FIRMS_MAP_KEY",
      zoom_range: { min: 2, max: 4 },
    },
    { state: "missing_key", fetched_at: null, record_count: 0 },
  );
  const aircraft = moduleInfo(
    "aircraft",
    "OpenSky",
    { name: "Aircraft", domain: "movers", zoom_range: { min: 2, max: 4 } },
    { state: "stale" },
  );

  test("before the API answers it shows a skeleton, not invented modules", () => {
    const html = renderConsole();
    expect(html).toContain("Loading modules");
    expect(html).not.toContain("Earthquakes");
    expect(html).not.toContain("FIRMS_MAP_KEY");
    expect(html).not.toContain("SAMPLE");
    expect(html).not.toContain("EVERY MODULE");
  });

  test("lists what the API sends, grouped under its domain", () => {
    const html = renderWithModules([quakes, wildfires, aircraft]);
    expect(html).toContain("Earthquakes");
    expect(html).toContain("Aircraft");
    const summaries = html.match(/<summary[\s\S]*?<\/summary>/g) ?? [];
    for (const title of ["EARTH", "MOVERS"]) {
      expect(
        summaries.some((s) => s.includes(title)),
        title,
      ).toBe(true);
    }
    expect(visibleText(html)).not.toContain("INFRASTRUCTURE");
  });

  test("a module the frontend has never heard of appears with no code change", () => {
    const html = renderWithModules([
      quakes,
      moduleInfo("brand-new", "Somebody", {
        name: "Brand New Feed",
        domain: "street",
      }),
    ]);
    expect(html).toContain("Brand New Feed");
    expect(html).toContain('aria-label="Brand New Feed filter: all"');
    expect(visibleText(html)).toContain("STREET");
  });

  test("modules that are not enabled are not listed", () => {
    const html = renderWithModules([
      quakes,
      moduleInfo("off", "Off", { name: "Switched Off", enabled: false }),
    ]);
    expect(html).not.toContain("Switched Off");
  });

  test("every button in the loaded rail declares its type", () => {
    const html = renderWithModules([quakes, aircraft, wildfires]);
    const buttons = count(html, /<button[\s>]/g);
    expect(buttons).toBeGreaterThan(5);
    expect(count(html, /<button[^>]*\stype="button"/g)).toBe(buttons);
  });

  test("health glyphs carry a text label for screen readers", () => {
    const html = renderWithModules([quakes, aircraft]);
    expect(html).toContain('<span aria-hidden="true">[+]</span>');
    expect(html).toContain('<span class="sr-only">fresh</span>');
    expect(html).toContain('<span aria-hidden="true">[!]</span>');
    expect(html).toContain(
      '<span class="sr-only">stale, serving last good</span>',
    );
  });

  test("a failed module shows [E] and its reason", () => {
    const html = renderWithModules([
      moduleInfo(
        "x",
        "X",
        { name: "Broken" },
        {
          state: "failed",
          reason: "HTTP 503",
        },
      ),
    ]);
    expect(html).toContain('<span aria-hidden="true">[E]</span>');
    expect(visibleText(html)).toContain("HTTP 503");
  });

  test("a module without its key says which key and has no filter", () => {
    const html = renderWithModules([quakes, wildfires]);
    expect(html).toContain('<span aria-hidden="true">[K]</span>');
    expect(html).toContain("needs FIRMS_MAP_KEY");
    expect(html).toContain("NO KEY");
    expect(html).not.toContain('aria-label="Wildfires filter');
    expect(html).toContain('aria-label="Earthquakes filter: all"');
  });

  test("filters start from the server default", () => {
    const html = renderWithModules([
      quakes,
      moduleInfo("quiet", "Q", { name: "Quiet", default_filter: "none" }),
    ]);
    expect(html).toContain('aria-label="Earthquakes filter: all"');
    expect(html).toContain('aria-label="Quiet filter: none"');
  });

  test("the global control reads the shared value when they agree", () => {
    const html = renderWithModules([quakes, aircraft]);
    expect(html).toContain('aria-label="Every module filter: all"');
    expect(html).toContain("EVERY MODULE");
  });

  test("summarises modules on and drawn", () => {
    expect(renderWithModules([quakes, aircraft, wildfires])).toContain(
      "2 on, 2 drawn",
    );
  });

  test("notes describe zoom in percent", () => {
    const html = renderWithModules([quakes, aircraft]);
    expect(html).toContain("auto, any zoom");
    expect(html).toContain("last good 05:59:12Z");
  });

  test("an API with nothing enabled says how to enable something", () => {
    expect(renderWithModules([])).toContain("No modules enabled");
  });

  test("the sample badge and sample numbers are gone", () => {
    const html = renderWithModules([quakes]);
    expect(html).not.toContain("SAMPLE");
    expect(html).not.toContain("entities");
    expect(html).not.toContain("contacts");
  });
});

function renderSelection() {
  return render(
    <ConsoleShell
      initialZoom={100}
      initialGlobeStyle="GREEN"
      initialCentre={CONSOLE_DEFAULTS.centre}
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
      "rail.ts",
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
      "filter-menu.tsx",
      "globe-canvas.tsx",
      "globe-hud.tsx",
      "globe-style-menu.tsx",
      "globe-view.tsx",
      "layer-markers.tsx",
      "mobile-search.tsx",
      "module-list.tsx",
      "module-status-lines.tsx",
      "modules-drawer.tsx",
      "search-field.tsx",
      "selection-dock.tsx",
      "selection-live.tsx",
      "sidebar-toggle.tsx",
      "starred-section.tsx",
      "use-now.ts",
      "use-rail.ts",
      "zoom-control.tsx",
    ]);
  });
});
