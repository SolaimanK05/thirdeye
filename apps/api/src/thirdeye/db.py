from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Request
from psycopg import AsyncConnection
from psycopg.rows import TupleRow
from psycopg_pool import AsyncConnectionPool

from thirdeye.config import Settings

type Pool = AsyncConnectionPool[AsyncConnection[TupleRow]]

SESSION_OPTIONS = "-c TimeZone=UTC"


def create_pool(settings: Settings) -> Pool:
    return AsyncConnectionPool(
        conninfo=str(settings.database_url),
        min_size=settings.db_pool_min_size,
        max_size=settings.db_pool_max_size,
        timeout=settings.db_timeout_seconds,
        kwargs={"options": SESSION_OPTIONS},
        check=AsyncConnectionPool.check_connection,
        open=False,
        name="thirdeye",
    )


def get_pool(request: Request) -> Pool:
    pool: Pool = request.app.state.pool
    return pool


async def get_conn(
    pool: Annotated[Pool, Depends(get_pool)],
) -> AsyncIterator[AsyncConnection[TupleRow]]:
    async with pool.connection() as conn:
        yield conn


Conn = Annotated[AsyncConnection[TupleRow], Depends(get_conn)]
