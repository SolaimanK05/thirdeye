unexport PYTHONPATH
.PHONY: dev-web dev-api dev-worker lint typecheck test
dev-web:
	pnpm --dir apps/web dev
dev-api:
	cd apps/api && uv run fastapi dev src/thirdeye/main.py
dev-worker:
	@echo "Does not exist yet."
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
