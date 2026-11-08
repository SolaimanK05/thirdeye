from typing import Protocol
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import TupleRow

STAR = """
insert into watchlist_entry (entity_id)
select e.id from entity e where e.id = %s
on conflict (entity_id) do nothing
returning entity_id
"""

EXISTS = "select 1 from entity where id = %s"

UNSTAR = "delete from watchlist_entry where entity_id = %s"


class Writer(Protocol):
    async def star(self, entity_id: UUID) -> bool: ...

    async def unstar(self, entity_id: UUID) -> None: ...


class DbWriter:
    def __init__(self, conn: AsyncConnection[TupleRow]) -> None:
        self.conn = conn

    async def star(self, entity_id: UUID) -> bool:
        async with self.conn.transaction(), self.conn.cursor() as cur:
            await cur.execute(STAR, (entity_id,))
            if await cur.fetchone() is not None:
                return True
            await cur.execute(EXISTS, (entity_id,))
            return await cur.fetchone() is not None

    async def unstar(self, entity_id: UUID) -> None:
        async with self.conn.transaction(), self.conn.cursor() as cur:
            await cur.execute(UNSTAR, (entity_id,))
