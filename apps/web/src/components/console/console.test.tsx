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
  const { zoomPercent, globeStyle, centre } = CONSOLE_DEFAULTS;
  return (
    <ConsoleShell
      initialZoom={zoomPercent}
      initialGlobeStyle={globeStyle}
      initialCentre={centre}
    >
      <Header menu={<MobileMenu instance={DEFAULT_INSTANCE_NAME} />} />
      <ModuleRail />
      <GlobeArea />
      <LiveSelection />
      <Footer />
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

/** The label of the pressed button in the "<name> filter" switch, if any. */
function pressedOf(html: string, name: string): string | undefined {
  const start = html.indexOf(`aria-label="${name} filter"`);
  if (start < 0) return undefined;
  const group = html.slice(start, html.indexOf("</div>", start));
  const pressed = group.match(/<button[^>]*aria-pressed="true"[^>]*>/)?.[0];
  return pressed?.match(/aria-label="([^"]+)"/)?.[1]?.replace(" only", "");
}

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

  test("the selection panel has an overview and a source tab", () => {
    const markup = renderSelection();
    expect(markup).toContain("[ EARTHQUAKE ]");
    for (const tab of ["OVERVIEW", "SOURCE"]) {
      expect(markup).toMatch(new RegExp(`role="tab"[^>]*>${tab}<`));
    }
    expect(markup).not.toContain("<details");
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
      "motion-driver.ts",
      "trail-layer.ts",
    ]);
    expect(importing(/from "\.\/globe-vectors"/)).toEqual(["globe-canvas.tsx"]);
    expect(
      importing(
        /import \{[^}]*\bMarkerOverlay\b[^}]*\} from "\.\/marker-overlay"/,
      ),
    ).toEqual(["globe-canvas.tsx"]);
    expect(importing(/from "\.\/motion-driver"/)).toEqual(["globe-canvas.tsx"]);
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

  test("lists what the API sends as one card each, with no domain headings", () => {
    const html = renderWithModules([quakes, wildfires, aircraft]);
    expect(html).toContain("Earthquakes");
    expect(html).toContain("Aircraft");
    const text = visibleText(html);
    for (const heading of ["EARTH", "MOVERS", "INFRASTRUCTURE"]) {
      expect(text, heading).not.toContain(heading);
    }
    expect(count(html, /<h2[^>]*>(Earthquakes|Wildfires|Aircraft)</g)).toBe(3);
  });

  test("two tabs, Modules and Starred, each with its count", () => {
    const html = renderWithModules([quakes, aircraft]);
    expect(html).toContain('role="tablist"');
    const tabs = visibleText(html);
    expect(tabs).toMatch(/MODULES\s*2/);
    expect(tabs).toContain("STARRED");
  });

  test("a collapsed card shows no FILTER or DRAW lines and no range bar", () => {
    const text = visibleText(renderWithModules([quakes, aircraft, wildfires]));
    expect(text).not.toMatch(/\bFILTER\b/);
    expect(text).not.toMatch(/\bDRAW\b/);
    expect(text).not.toMatch(/auto (from|to|any)/);
  });

  test("a legend explains the three status colours", () => {
    const html = renderWithModules([quakes]);
    expect(html).toContain('aria-label="What the colours mean"');
    const text = visibleText(html);
    for (const label of ["Live", "Needs attention", "Off or no key"]) {
      expect(text, label).toContain(label);
    }
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
    expect(pressedOf(html, "Brand New Feed")).toBe("All");
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

  test("each status is a coloured square plus plain words", () => {
    const text = visibleText(renderWithModules([quakes, aircraft]));
    expect(text).toContain("Up to date");
    expect(text).toContain("Stale since 05:59Z");
    const html = renderWithModules([quakes, aircraft]);
    expect(html).toContain("bg-accent");
    expect(html).toContain("bg-amber");
  });

  test("a failed module says so and keeps its reason in a tooltip", () => {
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
    expect(visibleText(html)).toContain("Feed failed, last data kept");
    expect(html).toContain('title="HTTP 503"');
  });

  test("a module without its key says which key, links to how to add it and has no filter", () => {
    const html = renderWithModules([quakes, wildfires]);
    const text = visibleText(html);
    expect(text).toContain("Needs FIRMS_MAP_KEY");
    expect(text).toContain("How to add");
    expect(html).not.toContain('aria-label="Wildfires filter"');
    expect(pressedOf(html, "Earthquakes")).toBe("All");
  });

  test("filters start from the server default", () => {
    const html = renderWithModules([
      quakes,
      moduleInfo("quiet", "Q", { name: "Quiet", default_filter: "none" }),
    ]);
    expect(pressedOf(html, "Earthquakes")).toBe("All");
    expect(pressedOf(html, "Quiet")).toBe("Off");
  });

  test("the every-module switch reads the shared value when they agree", () => {
    const html = renderWithModules([quakes, aircraft]);
    expect(pressedOf(html, "Every module")).toBe("All");
    expect(visibleText(html)).toContain("drawn on the globe");
  });

  test("the every-module switch presses nothing when filters differ", () => {
    const html = renderWithModules([
      quakes,
      moduleInfo("quiet", "Q", { name: "Quiet", default_filter: "none" }),
    ]);
    expect(pressedOf(html, "Every module")).toBeUndefined();
  });

  test("says how many modules are drawn on the globe", () => {
    expect(
      visibleText(renderWithModules([quakes, aircraft, wildfires])),
    ).toContain("2 drawn on the globe");
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

describe("system states", () => {
  function renderWith(prepare: (client: QueryClient) => void) {
    const client = new QueryClient({
      defaultOptions: { queries: { retryOnMount: false } },
    });
    prepare(client);
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        {consoleTree()}
      </QueryClientProvider>,
    );
  }

  const apiDown = (client: QueryClient) =>
    client
      .getQueryCache()
      .build(client, { queryKey: queryKeys.modules })
      .setState({
        status: "error",
        error: new Error("down"),
        fetchStatus: "idle",
      });

  test("an unreachable API says so, offers a retry button and shows no skeleton", () => {
    const html = renderWith(apiDown);
    expect(html).toContain("API unreachable. Retrying.");
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Retry now<\/button>/);
    expect(html).not.toContain("Loading modules");
    expect(html).toContain('role="alert"');
  });

  test("the footer and the rail agree when the API is down", () => {
    expect(visibleText(renderWith(apiDown))).toContain("API unreachable");
  });

  test("a public instance shows the PUBLIC badge", () => {
    const html = renderWith((client) =>
      client.setQueryData(queryKeys.watchlist, { writable: false, items: [] }),
    );
    expect(visibleText(html)).toContain("Public");
  });

  test("a private instance, or one that has not answered yet, shows no badge", () => {
    const writable = renderWith((client) =>
      client.setQueryData(queryKeys.watchlist, { writable: true, items: [] }),
    );
    expect(visibleText(writable)).not.toContain("Public");
    expect(visibleText(renderWith(() => undefined))).not.toContain("Public");
  });

  test("a module with nothing in it says empty, and a waiting one says so", () => {
    const html = renderWithModules([
      moduleInfo(
        "earthquakes",
        "USGS",
        { name: "Earthquakes" },
        { state: "empty" },
      ),
      moduleInfo("ports", "NGA", { name: "Ports" }, { state: "pending" }),
    ]);
    const text = visibleText(html);
    expect(text).toContain("earthquakes empty");
    expect(text).toContain("ports waiting for first fetch");
  });
});

function renderSelection(onClose?: () => void) {
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
        onClose={onClose}
      />
    </ConsoleShell>,
  );
}

describe("selection panel", () => {
  test("a close button names its shortcut, and only exists when it can close", () => {
    const withClose = renderSelection(() => undefined);
    expect(withClose).toContain('aria-label="Close"');
    expect(withClose).toContain('aria-keyshortcuts="Escape"');
    expect(renderSelection()).not.toContain('aria-label="Close"');
  });

  test("prompts when nothing is selected", () => {
    const html = renderConsole();
    expect(html).toContain("Select something on the globe, or search.");
    expect(html).toContain("Tap something on the globe.");
  });

  test("shows provenance and every limitation word for word", () => {
    const html = renderSelection();
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
      "count-hint.tsx",
      "data-markers.tsx",
      "draw-limit-panel.tsx",
      "filter-switch.tsx",
      "globe-canvas.tsx",
      "globe-hud.tsx",
      "globe-style-menu.tsx",
      "globe-view.tsx",
      "layer-markers.tsx",
      "mobile-search.tsx",
      "module-details.tsx",
      "module-list.tsx",
      "module-status-lines.tsx",
      "modules-drawer.tsx",
      "perf-hud.tsx",
      "public-badge.tsx",
      "refine-controls.tsx",
      "refine-panel.tsx",
      "replay-bar.tsx",
      "satellite-markers.tsx",
      "satellites-notice-bar.tsx",
      "search-field.tsx",
      "selection-dock.tsx",
      "selection-live.tsx",
      "sidebar-toggle.tsx",
      "starred-section.tsx",
      "use-draw-state.ts",
      "use-now.ts",
      "use-rail.ts",
      "use-trails.ts",
      "zoom-control.tsx",
    ]);
  });
});
