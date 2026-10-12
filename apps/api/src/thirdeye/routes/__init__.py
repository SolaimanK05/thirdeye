from fastapi import APIRouter

from thirdeye.routes import health

v1 = APIRouter(prefix="/v1")
v1.include_router(health.router)
