# Third Eye API (and, with RUN_WORKER=true, the worker) in one small image.
#
#   docker build -t thirdeye-api apps/api
#   docker run --rm -p 8000:8000 --env-file apps/api/.env thirdeye-api
#
# The hosting platform sets PORT; 8000 is the fallback for a local run.

FROM ghcr.io/astral-sh/uv:python3.14-trixie-slim AS builder

# Bytecode compiled once at build time, packages copied (not linked) so the
# virtual environment can be moved to the final image, no dev tools, and the
# interpreter of this image is the one the final image has.
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_NO_DEV=1 \
    UV_PYTHON_DOWNLOADS=0

WORKDIR /app

# Dependencies first: this layer only changes when the lock file does.
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --locked --no-install-project --no-editable

COPY pyproject.toml uv.lock README.md ./
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-editable


FROM python:3.14-slim-trixie

RUN groupadd --system --gid 999 nonroot \
 && useradd --system --gid 999 --uid 999 --no-create-home nonroot

COPY --from=builder --chown=nonroot:nonroot /app/.venv /app/.venv

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    LOG_FORMAT=json

USER nonroot
WORKDIR /app
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\", \"8000\")}/v1/health', timeout=4)"]

# Shell form on purpose: $PORT is read at start. exec keeps uvicorn as PID 1 so
# it gets SIGTERM and shuts the worker down cleanly.
CMD ["sh", "-c", "exec uvicorn thirdeye.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
