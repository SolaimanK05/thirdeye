# Third Eye web app

Next.js 16 (Turbopack and the React Compiler), React 19, TypeScript, Tailwind CSS 4 and [Base UI](https://base-ui.com/). Biome formats and lints it, Vitest tests it.

```bash
pnpm install     # once
make dev-web     # http://localhost:3000, from the repo root
```

The API address comes from `NEXT_PUBLIC_API_URL` in `.env.local`. It is read when the app is built, so rebuild after changing it.

## What it does not need

The globe is [CesiumJS](https://cesium.com/platform/cesiumjs/) with no map tile servers: the country outlines come from the `world-atlas` package and Cesium's own assets, both copied into `public/` by `scripts/copy-assets.mjs` on `dev` and `build`. The browser talks only to your API, and a test (`no-upstream-urls.test.ts`) fails if a feed URL ever appears in the source.

## How the data flows

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../assets/diagrams/web-flow-dark.svg">
  <img alt="The API feeds a data worker and an SGP4 worker, which feed the WebGL2 markers" src="../../assets/diagrams/web-flow-light.svg">
</picture>

Live positions never go through React state, which would not keep up with tens of thousands of markers.

- **Data worker** (`src/workers/data.worker.ts`, `src/data`): holds each moving module's state in typed arrays, applies deltas, applies the refine filters and the draw limit, and hands the renderer the segments to draw. Aircraft and vessels are drawn a fixed delay behind the data and interpolated, so they glide.
- **SGP4 worker** (`src/workers/sgp4.worker.ts`, `src/modules/satellites`): takes the orbital elements once and computes every satellite's position each second with [satellite.js](https://github.com/shashwatak/satellite-js).
- **Markers** (`src/components/console/gpu`, `canvas-renderer.ts`): a WebGL2 layer on its own canvas above the globe, and a 2D canvas renderer that takes over when WebGL2 is not available.
- **State** (`src/state`): small zustand stores for filters, refine values, draw limits, selection, stars, replay and view. Server data is fetched with TanStack Query.

## Layout

```text
src/
  app/                  Next.js entry
  api/                  typed client (OpenAPI types), TEF1 decoder, SSE
  components/console/   the console: rail, globe, markers, panels, search, replay
  data/                 data worker core, columnar state, protocol
  modules/              one folder per module: refine controls, rendering, selection facts
  state/                zustand stores
  workers/              data and SGP4 worker entries
  perf/                 benchmark and metrics helpers
```

A module on the web side declares its refine controls declaratively (`src/modules/refine.ts`: range, level, choices, window and searchable pick lists), and the refine panel renders whatever the module declares.

## Commands

```bash
pnpm exec biome check         # lint and format check
pnpm exec tsc --noEmit        # types (run `pnpm exec next typegen` first)
pnpm exec vitest run          # tests
pnpm run api:types            # regenerate src/api/schema.ts from src/api/openapi.json
```

From the repo root, `make lint`, `make typecheck` and `make test` run these together with the API's checks.
