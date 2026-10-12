from importlib.metadata import version
from typing import Annotated, Literal

import psycopg
import structlog
from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel

from thirdeye.db import Pool, get_pool

APP_VERSION = version("thirdeye")

log = structlog.get_logger()

router = APIRouter(tags=["health"])


class Health(BaseModel):
    status: Literal["ok", "error"]
    db: Literal["ok", "error"]
    version: str


@router.get("/health")
async def health(
    pool: Annotated[Pool, Depends(get_pool)], response: Response
) -> Health:
    try:
        async with pool.connection() as conn:
            await conn.execute("select 1")
    except psycopg.Error as exc:
        log.warning("health.db_unavailable", error=str(exc))
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return Health(status="error", db="error", version=APP_VERSION)
    return Health(status="ok", db="ok", version=APP_VERSION)
