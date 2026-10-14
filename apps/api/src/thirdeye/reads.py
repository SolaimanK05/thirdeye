from datetime import datetime
from typing import Literal, Protocol
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import TupleRow, class_row
from pydantic import BaseModel, ConfigDict, JsonValue

from thirdeye.ontology import Confidence, EntityKind, SourceReliability


class Record(BaseModel):
    model_config = ConfigDict(frozen=True)


class SnapshotRecord(Record):
    payload: list[dict[str, JsonValue]]
    fetched_at: datetime


class HealthRecord(Record):
    module_id: str
    status: Literal["ok", "failed"]
    fetched_at: datetime
    record_count: int
    reason: str | None


class SourceRecord(Record):
    source_id: str
    source_module_id: str
    source_url: str
    source_licence: str
    source_reliability: SourceReliability


class EventRecord(SourceRecord):
    id: str
    module_id: str
    category: str
    geometry: dict[str, JsonValue]
    lon: float
    lat: float
    t_start: datetime
    t_end: datetime | None
    severity: float | None
    attrs: dict[str, JsonValue]
    retrieved_at: datetime
    confidence: Confidence


class EntityRecord(SourceRecord):
    id: UUID
    kind: EntityKind
    names: list[str]
    identifiers: dict[str, JsonValue]
    attrs: dict[str, JsonValue]
    first_seen: datetime
    last_seen: datetime
    retrieved_at: datetime
    obs_t: datetime | None
    obs_lon: float | None
    obs_lat: float | None
    obs_sog: float | None
    obs_cog: float | None
    obs_alt: float | None
    obs_confidence: Confidence | None


SOURCE_COLUMNS = """
    s.id as source_id,
    s.module_id as source_module_id,
    s.url as source_url,
    s.licence as source_licence,
    s.reliability::text as source_reliability
"""

SNAPSHOT = """
select payload, fetched_at from layer_snapshot where module_id = %s
"""

HEALTH = """
select module_id, status::text as status, fetched_at, record_count, reason
from module_health
"""

EVENT = f"""
select
    e.id, e.module_id, e.category,
    st_asgeojson(e.geom)::jsonb as geometry,
    st_x(st_pointonsurface(e.geom)) as lon,
    st_y(st_pointonsurface(e.geom)) as lat,
    e.t_start, e.t_end, e.severity, e.attrs, e.retrieved_at,
    e.confidence::text as confidence,
    {SOURCE_COLUMNS}
from event e
join source s on s.id = e.source_id
where e.id = %s
"""

ENTITY = f"""
select
    e.id, e.kind::text as kind, e.names, e.identifiers, e.attrs,
    e.first_seen, e.last_seen, e.retrieved_at,
    o.t as obs_t,
    st_x(o.geom) as obs_lon,
    st_y(o.geom) as obs_lat,
    o.sog as obs_sog,
    o.cog as obs_cog,
    o.alt as obs_alt,
    o.confidence::text as obs_confidence,
    {SOURCE_COLUMNS}
from entity e
join source s on s.id = e.source_id
left join lateral (
    select t, geom, sog, cog, alt, confidence
    from observation
    where entity_id = e.id
    order by t desc
    limit 1
) o on true
where e.id = %s
"""


class Reader(Protocol):
    async def snapshot(self, module_id: str) -> SnapshotRecord | None: ...

    async def health(self) -> dict[str, HealthRecord]: ...

    async def event(self, event_id: str) -> EventRecord | None: ...

    async def entity(self, entity_id: UUID) -> EntityRecord | None: ...


class DbReader:
    def __init__(self, conn: AsyncConnection[TupleRow]) -> None:
        self.conn = conn

    async def snapshot(self, module_id: str) -> SnapshotRecord | None:
        async with self.conn.cursor(row_factory=class_row(SnapshotRecord)) as cur:
            await cur.execute(SNAPSHOT, (module_id,))
            return await cur.fetchone()

    async def health(self) -> dict[str, HealthRecord]:
        async with self.conn.cursor(row_factory=class_row(HealthRecord)) as cur:
            await cur.execute(HEALTH)
            return {row.module_id: row for row in await cur.fetchall()}

    async def event(self, event_id: str) -> EventRecord | None:
        async with self.conn.cursor(row_factory=class_row(EventRecord)) as cur:
            await cur.execute(EVENT, (event_id,))
            return await cur.fetchone()

    async def entity(self, entity_id: UUID) -> EntityRecord | None:
        async with self.conn.cursor(row_factory=class_row(EntityRecord)) as cur:
            await cur.execute(ENTITY, (entity_id,))
            return await cur.fetchone()
