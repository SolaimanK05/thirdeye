import asyncio
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager, suppress
from typing import Any

import psycopg
import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from thirdeye.config import Settings, get_settings
from thirdeye.db import SESSION_OPTIONS, Pool, create_pool
from thirdeye.errors import register_error_handlers
from thirdeye.layers import Connect, LayerCache, Loader, listen_for_layers
from thirdeye.logs import configure_logging
from thirdeye.reads import DbReader, SnapshotRecord
from thirdeye.registry import REGISTRY, Module, check_default_on, enabled
from thirdeye.routes import v1
from thirdeye.routes.health import APP_VERSION

log = structlog.get_logger()


def snapshot_loader(pool: Pool) -> Loader:
    async def load(module_id: str) -> SnapshotRecord | None:
        async with pool.connection() as conn:
            return await DbReader(conn).snapshot(module_id)

    return load


def listener_connect(settings: Settings) -> Connect:
    async def connect() -> psycopg.AsyncConnection[Any]:
        return await psycopg.AsyncConnection.connect(
            str(settings.database_url),
            autocommit=True,
            options=SESSION_OPTIONS,
            connect_timeout=int(settings.db_timeout_seconds),
            keepalives=1,
            keepalives_idle=30,
            keepalives_interval=10,
            keepalives_count=3,
        )

    return connect


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = app.state.settings
    pool = create_pool(settings)
    await pool.open()
    cache = LayerCache(snapshot_loader(pool))
    app.state.pool = pool
    app.state.layer_cache = cache
    listener = asyncio.create_task(
        listen_for_layers(listener_connect(settings), cache), name="layer-listener"
    )
    log.info("api.started", version=APP_VERSION, modules=settings.modules_enabled)
    try:
        yield
    finally:
        listener.cancel()
        with suppress(asyncio.CancelledError):
            await listener
        await pool.close()
        log.info("api.stopped")


def create_app(
    settings: Settings | None = None, registry: Mapping[str, Module] = REGISTRY
) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings)
    app = FastAPI(title="Third Eye API", version=APP_VERSION, lifespan=lifespan)
    app.state.settings = settings
    app.state.registry = registry
    app.state.enabled_modules = {
        m.id: m for m in enabled(settings.modules_enabled, registry)
    }
    app.state.default_on = check_default_on(
        (
            settings.modules_enabled
            if settings.modules_default_on is None
            else settings.modules_default_on
        ),
        registry,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "PUT", "DELETE"],
        allow_headers=["Content-Type"],
        expose_headers=["ETag", "Last-Modified"],
    )
    register_error_handlers(app)
    app.include_router(v1)
    return app
