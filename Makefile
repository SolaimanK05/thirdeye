unexport PYTHONPATH
.PHONY: dev-web dev-api dev-worker worker-once import-ports api-types lint typecheck test
dev-web:
	pnpm --dir apps/web dev
dev-api:
	cd apps/api && uv run fastapi dev src/thirdeye/main.py
dev-worker:
	cd apps/api && uv run python -m thirdeye.worker
worker-once:
	cd apps/api && uv run python -m thirdeye.worker --once
import-ports:
	@test -n "$(FILE)" || { echo "usage: make import-ports FILE=path/to/ports.csv"; exit 2; }
	cd apps/api && uv run python -m thirdeye.importer ports "$(abspath $(FILE))"
api-types:
	cd apps/api && uv run python -m thirdeye.openapi ../web/src/api/openapi.json
	pnpm --dir apps/web run api:types
lint:
	cd apps/api && uv lock --check
	pnpm --dir apps/web exec biome check
	cd apps/api && uv run ruff check .
	cd apps/api && uv run ruff format --check .
typecheck:
	cd apps/api && uv run mypy src tests
	pnpm --dir apps/web exec next typegen
	pnpm --dir apps/web exec tsc --noEmit
test:
	pnpm --dir apps/web exec vitest run
	cd apps/api && uv run pytest
