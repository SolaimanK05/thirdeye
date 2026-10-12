from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from thirdeye.config import Settings, get_settings
from thirdeye.db import create_pool
from thirdeye.errors import register_error_handlers
from thirdeye.logs import configure_logging
from thirdeye.routes import v1
from thirdeye.routes.health import APP_VERSION

log = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = app.state.settings
    pool = create_pool(settings)
    await pool.open()
    app.state.pool = pool
    log.info("api.started", version=APP_VERSION, modules=settings.modules_enabled)
    try:
        yield
    finally:
        await pool.close()
        log.info("api.stopped")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings)
    app = FastAPI(title="Third Eye API", version=APP_VERSION, lifespan=lifespan)
    app.state.settings = settings
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "PUT", "DELETE"],
        allow_headers=["Content-Type"],
    )
    register_error_handlers(app)
    app.include_router(v1)
    return app


app = create_app()
