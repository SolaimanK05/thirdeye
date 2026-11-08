# Third Eye API and worker

Python 3.14, FastAPI, psycopg and structlog. The package is `thirdeye`, in `src/thirdeye`.

Two processes share this code:

| Process | Command | Job |
|---|---|---|
| Worker | `make dev-worker` | Polls the sources, normalises what they return and writes it to Postgres. Also runs the daily clean-up. |
| API | `make dev-api` | Reads Postgres and serves it to the web app. Interactive docs are at http://localhost:8000/docs. |

Run both from the repo root. `make worker-once` polls every module once and exits, which is handy for a first look at the data. With `RUN_WORKER=true` the API starts the worker inside its own process, so you only run one.

Settings come from the environment or `apps/api/.env`. Copy [`.env.example`](.env.example), which lists every one with its default.

## Modules

A module is a folder in `src/thirdeye/modules/<id>` with a manifest (what it is, its refresh rate, zoom range, key variables and a provenance block: source, licence, freshness, limitations), a source that fetches, and records that turn the raw feed into entities or events. `MODULES_ENABLED` decides which of them run.

| Module | Folder | Kind | Fetch |
|---|---|---|---|
| Earthquakes | `earthquakes` | events | poll |
| Wildfires | `wildfires` | events | poll |
| Aircraft | `aircraft` | entities (movers) | poll, within a credit budget |
| Vessels | `vessels` | entities (movers) | live websocket |
| Satellites | `satellites` | entities | daily download |
| Ports | `ports` | entities | file import |

The worker backs off after a failed poll and records the module's health, so a feed that is down shows up as stale in the interface instead of breaking it. Provider limits are handled by a governor: aircraft polling spreads a daily credit budget across the day and honours rate-limit replies.

## Routes

Everything is under `/v1`.

| Route | Returns |
|---|---|
| `GET /health` | Whether the API and its database are up |
| `GET /modules` | Each module with its provenance and health (fresh, stale, failed) |
| `GET /layers/{module}` | A module's rows for a bounding box, with ETag caching |
| `GET /movers/{module}/snapshot` | Aircraft or vessels as one [TEF1](../../contracts/frames/README.md) frame |
| `GET /movers/{module}/frames/{version}` | The delta frame for one version |
| `GET /satellites/elements` | Orbital elements and catalogue data, computed on in the browser |
| `GET /stream` | Server-sent events: `hello`, `layer`, `snapshot`, `delta`. Resumable with `Last-Event-ID` |
| `GET /entities/{id}` | One entity |
| `GET /entities/{id}/fixes` | Recent positions of one entity |
| `GET /events/{id}` | One event |
| `GET /search` | Search across every enabled module |
| `GET /watchlist` | Starred entities |
| `PUT`, `DELETE /watchlist/{id}` | Star or unstar |

## Data

Postgres with PostGIS. The schema is in [`supabase/migrations`](../../supabase/migrations) and each module has one source row in [`supabase/seed.sql`](../../supabase/seed.sql). The worker keeps it small: once a day it prunes old events and the positions of entities you starred (`RETENTION_EVENT_DAYS`, `RETENTION_STARRED_HOURS`, `RETENTION_HOUR_UTC`), and each moving module prunes its own observations.

## Commands

```bash
make import-ports FILE=path/to/file   # load the NGA World Port Index
make api-types                        # export the OpenAPI schema and regenerate the web types
cd apps/api && uv run pytest          # tests
cd apps/api && uv run mypy src tests  # strict type check
cd apps/api && uv run ruff check .    # lint
```

`make api-types` matters: CI fails if the generated types in `apps/web/src/api` do not match the API.
