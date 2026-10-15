from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal, Protocol
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import TupleRow, class_row
from pydantic import BaseModel, ConfigDict, JsonValue

from thirdeye.ontology import Confidence, EntityKind, SourceReliability


def escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


class Record(BaseModel):
    model_config = ConfigDict(frozen=True)


class SnapshotRecord(Record):
    payload: list[dict[str, JsonValue]]
    fetched_at: datetime


DEFAULT_LIMIT = 3000
MAX_LIMIT = 10000


@dataclass(frozen=True, slots=True)
class Viewport:
    west: float
    south: float
    east: float
    north: float
    limit: int = DEFAULT_LIMIT
    cell: float | None = None
    min_severity: float = 0.0

    @property
    def wraps(self) -> bool:
        return self.west > self.east


WORLD = Viewport(-180.0, -90.0, 180.0, 90.0)


class ViewRecord(Record):
    rows: list[dict[str, JsonValue]]
    matched: int
    fetched_at: datetime


class WatchRecord(Record):
    entity_id: UUID
    kind: EntityKind
    names: list[str]
    identifiers: dict[str, JsonValue]
    module_id: str
    added_at: datetime
    last_seen: datetime
    lon: float | None
    lat: float | None


class SearchRecord(Record):
    kind: Literal["event", "entity"]
    id: str
    module_id: str
    category: str
    label: str | None
    severity: float | None
    t: datetime | None
    lon: float | None
    lat: float | None
    starred: bool
    identifiers: dict[str, JsonValue] | None = None


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

CURRENT_ROWS = """
    from layer_snapshot s
    join event e on e.module_id = s.module_id
    where s.module_id = %(module_id)s
      and e.retrieved_at = s.fetched_at
      and e.t_start >= s.fetched_at - make_interval(secs => %(lookback)s)
      and (
          e.geom && st_makeenvelope(%(west_a)s, %(south)s, %(east_a)s, %(north)s, 4326)
          or e.geom && st_makeenvelope(%(west_b)s, %(south)s, %(east_b)s, %(north)s, 4326)
      )
"""

VIEW = f"""
select
    m.id, m.category,
    st_x(st_pointonsurface(m.geom)) as lon,
    st_y(st_pointonsurface(m.geom)) as lat,
    m.t_start, m.t_end, m.severity, m.confidence::text as confidence,
    m.attrs, 1 as members, m.matched, m.fetched_at
from (
    select
        e.id, e.category, e.geom, e.t_start, e.t_end, e.severity,
        e.confidence, e.attrs, s.fetched_at,
        count(*) over () as matched
    {CURRENT_ROWS}
      and coalesce(e.severity, 0) >= %(min_severity)s
    order by e.severity desc nulls last, e.t_start desc, e.id
    limit %(limit)s
) m
order by m.severity desc nulls last, m.t_start desc, m.id
"""

CLUSTERED_VIEW = f"""
select
    m.id, m.category,
    st_x(st_pointonsurface(m.geom)) as lon,
    st_y(st_pointonsurface(m.geom)) as lat,
    m.t_start, m.t_end, m.total as severity, m.confidence::text as confidence,
    m.attrs, m.members, m.matched, m.fetched_at
from (
    select c.*, count(*) over () as matched
    from (
        select distinct on (k.cx, k.cy)
            k.id, k.category, k.geom, k.t_start, k.t_end, k.confidence,
            k.attrs, k.fetched_at,
            sum(coalesce(k.severity, 0)) over (partition by k.cx, k.cy) as total,
            count(*) over (partition by k.cx, k.cy) as members
        from (
            select
                e.id, e.category, e.geom, e.t_start, e.t_end, e.severity,
                e.confidence, e.attrs, s.fetched_at,
                floor(st_x(st_pointonsurface(e.geom)) / %(cell)s) as cx,
                floor(st_y(st_pointonsurface(e.geom)) / %(cell)s) as cy
            {CURRENT_ROWS}
        ) k
        order by k.cx, k.cy, k.severity desc nulls last, k.t_start desc, k.id
    ) c
    where c.total >= %(min_severity)s
    order by c.total desc, c.id
    limit %(limit)s
) m
order by m.total desc, m.id
"""

WATCHLIST = """
select
    w.entity_id, e.kind::text as kind, e.names, e.identifiers,
    s.module_id, w.added_at, e.last_seen, o.lon, o.lat
from watchlist_entry w
join entity e on e.id = w.entity_id
join source s on s.id = e.source_id
left join lateral (
    select st_x(geom) as lon, st_y(geom) as lat
    from observation
    where entity_id = e.id
    order by t desc
    limit 1
) o on true
order by w.added_at desc, e.id
"""

SEARCH_EVENTS = """
select
    'event' as kind, e.id, e.module_id, e.category,
    e.attrs ->> 'place' as label, e.severity, e.t_start as t,
    st_x(st_pointonsurface(e.geom)) as lon,
    st_y(st_pointonsurface(e.geom)) as lat,
    false as starred
from layer_snapshot s
join event e on e.module_id = s.module_id and e.retrieved_at = s.fetched_at
where s.module_id = any(%(modules)s)
  and (
      e.module_id = any(%(named)s)
      or (e.attrs ->> 'place') ilike %(pattern)s escape '\\'
      or replace(e.category, '-', ' ') ilike %(pattern)s escape '\\'
  )
order by
    coalesce((e.attrs ->> 'place') ilike %(pattern)s escape '\\', false) desc,
    e.severity desc nulls last, e.t_start desc, e.id
limit %(limit)s
"""

SEARCH_ENTITIES = """
select
    'entity' as kind, e.id::text as id, s.module_id, e.kind::text as category,
    coalesce(
        e.names[1],
        (select value from jsonb_each_text(e.identifiers) limit 1)
    ) as label,
    null::double precision as severity, e.last_seen as t,
    o.lon, o.lat, (w.entity_id is not null) as starred, e.identifiers
from entity e
join source s on s.id = e.source_id
left join watchlist_entry w on w.entity_id = e.id
left join lateral (
    select st_x(geom) as lon, st_y(geom) as lat
    from observation
    where entity_id = e.id
    order by t desc
    limit 1
) o on true
where s.module_id = any(%(modules)s)
  and public.entity_search_text(e.names, e.identifiers)
      ilike %(pattern)s escape '\\'
order by
    (lower(coalesce(e.names[1], '')) like %(prefix)s escape '\\') desc,
    (w.entity_id is not null) desc, e.last_seen desc, e.id
limit %(limit)s
"""

VIEW_FETCHED_AT = """
select fetched_at from layer_snapshot where module_id = %s
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

    async def window(
        self, module_id: str, lookback_seconds: int, viewport: Viewport
    ) -> ViewRecord | None: ...

    async def health(self) -> dict[str, HealthRecord]: ...

    async def watchlist(self) -> list[WatchRecord]: ...

    async def search(
        self,
        text: str,
        modules: Sequence[str],
        named_modules: Sequence[str],
        limit: int,
    ) -> list[SearchRecord]: ...

    async def event(self, event_id: str) -> EventRecord | None: ...

    async def entity(self, entity_id: UUID) -> EntityRecord | None: ...


class DbReader:
    def __init__(self, conn: AsyncConnection[TupleRow]) -> None:
        self.conn = conn

    async def snapshot(self, module_id: str) -> SnapshotRecord | None:
        async with self.conn.cursor(row_factory=class_row(SnapshotRecord)) as cur:
            await cur.execute(SNAPSHOT, (module_id,))
            return await cur.fetchone()

    async def window(
        self, module_id: str, lookback_seconds: int, viewport: Viewport
    ) -> ViewRecord | None:
        east_a = 180.0 if viewport.wraps else viewport.east
        west_b = -180.0 if viewport.wraps else viewport.west
        params = {
            "module_id": module_id,
            "lookback": lookback_seconds,
            "south": viewport.south,
            "north": viewport.north,
            "west_a": viewport.west,
            "east_a": east_a,
            "west_b": west_b,
            "east_b": viewport.east,
            "limit": viewport.limit,
            "min_severity": viewport.min_severity,
            "cell": viewport.cell,
        }
        query = VIEW if viewport.cell is None else CLUSTERED_VIEW
        async with self.conn.cursor() as cur:
            await cur.execute(query, params)
            found = await cur.fetchall()
            if found:
                return ViewRecord(
                    rows=[
                        {
                            "id": r[0],
                            "category": r[1],
                            "lon": r[2],
                            "lat": r[3],
                            "t_start": r[4].astimezone(UTC).isoformat(),
                            "t_end": (
                                None
                                if r[5] is None
                                else r[5].astimezone(UTC).isoformat()
                            ),
                            "severity": r[6],
                            "confidence": r[7],
                            "attrs": (
                                {**r[8], "cluster_count": r[9]} if r[9] > 1 else r[8]
                            ),
                        }
                        for r in found
                    ],
                    matched=found[0][10],
                    fetched_at=found[0][11],
                )
            await cur.execute(VIEW_FETCHED_AT, (module_id,))
            row = await cur.fetchone()
        if row is None:
            return None
        return ViewRecord(rows=[], matched=0, fetched_at=row[0])

    async def watchlist(self) -> list[WatchRecord]:
        async with self.conn.cursor(row_factory=class_row(WatchRecord)) as cur:
            await cur.execute(WATCHLIST)
            return await cur.fetchall()

    async def search(
        self,
        text: str,
        modules: Sequence[str],
        named_modules: Sequence[str],
        limit: int,
    ) -> list[SearchRecord]:
        escaped = escape_like(text.strip().lower())
        params = {
            "modules": list(modules),
            "named": list(named_modules),
            "pattern": f"%{escaped}%",
            "prefix": f"{escaped}%",
            "limit": limit,
        }
        async with self.conn.cursor(row_factory=class_row(SearchRecord)) as cur:
            await cur.execute(SEARCH_ENTITIES, params)
            entities = await cur.fetchall()
            await cur.execute(SEARCH_EVENTS, params)
            events = await cur.fetchall()
        return [*entities, *events][:limit]

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
