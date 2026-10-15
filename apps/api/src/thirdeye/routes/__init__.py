from fastapi import APIRouter

from thirdeye.errors import ERROR_RESPONSES
from thirdeye.routes import (
    entities,
    events,
    health,
    layers,
    modules,
    search,
    watchlist,
)

v1 = APIRouter(prefix="/v1", responses=ERROR_RESPONSES)
v1.include_router(health.router)
v1.include_router(modules.router)
v1.include_router(layers.router)
v1.include_router(events.router)
v1.include_router(entities.router)
v1.include_router(watchlist.router)
v1.include_router(search.router)
