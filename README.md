<div align="center">

# Third Eye

[![CI](https://github.com/SolaimanK05/thirdeye/actions/workflows/ci.yml/badge.svg)](https://github.com/SolaimanK05/thirdeye/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)
![Python 3.14](https://img.shields.io/badge/Python-3.14-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![CesiumJS](https://img.shields.io/badge/CesiumJS-6CADDF?logo=cesium&logoColor=white)
![PostGIS](https://img.shields.io/badge/Postgres-PostGIS-4169E1?logo=postgresql&logoColor=white)

A self-hosted OSINT console that puts public data feeds on one 3D globe, with a single search box across all of them.

<div align="center">

**Project is in Early Development !!!**

</div>

</div>

## What it will do

Third Eye pulls in live public data and draws it on a CesiumJS globe. That means ships from AIS, aircraft from ADS-B and satellites from their orbital elements, along with earthquakes, wildfires and ports.

Each data source is a module that you can switch on or off. Modules share one globe, one search and one alert engine. They all write into the same data model, so a search covers every module at once, and you can star anything regardless of where it came from.

You also pick what each module draws:

| Setting | What you see |
|---|---|
| All | Everything the module reports |
| Starred | Only the things you've starred |
| None | Nothing on the globe, though the module keeps running and can still alert |

Every panel tells you where its data came from, how old it is and what the source can't tell you. AIS is a good example. Ships broadcast it themselves and can turn it off, and the interface points that out.

Version one will have six modules: earthquakes, ports, wildfires, aircraft, vessels and satellites.

## What it won't do

Third Eye won't do face recognition, follow people or vehicles from one camera to the next, look up named people, or show who owns private homes. None of that is planned for later either, so please don't open issues asking for it.

## Stack

| Part | Tools |
|---|---|
| Web | Next.js 16, React 19, TypeScript, Tailwind CSS 4, CesiumJS |
| API | Python 3.14, FastAPI, and a worker process for ingest and alerts |
| Data | Postgres with PostGIS, hosted on Supabase |

There's no Redis and no message broker. Everything runs on free tiers.

## Running it locally

You'll need Node 24, pnpm 12, [uv](https://docs.astral.sh/uv/) and `make`. uv installs Python 3.14 itself. I develop on Ubuntu 24.04 under WSL2.

```bash
git clone https://github.com/SolaimanK05/thirdeye.git
cd thirdeye
pnpm --dir apps/web install
(cd apps/api && uv sync)
lefthook install   # optional: checks staged files with Biome and Ruff before each commit
```

| Command | What it does |
|---|---|
| `make dev-web` | Web app on http://localhost:3000 |
| `make dev-api` | API on http://localhost:8000 |
| `make lint` | Biome for the web app, Ruff for the API |
| `make typecheck` | `tsc` and strict mypy |
| `make test` | Vitest and pytest |

CI runs `lint`, `typecheck` and `test` on every push.

## Licence

MIT, see [LICENSE](LICENSE). Third-party data feeds have their own terms, and the interface will credit each source wherever its data appears.

## Credits

Two projects taught me a lot of what's in here:

- [God's Eye View](https://github.com/bilawalsidhu/gods-eye-view), for the render-delay interpolation technique and the sensor-style shaders
- [World Monitor](https://github.com/koala73/worldmonitor), for keeping ingest separate from the API
