from collections.abc import Sequence
from datetime import datetime

from psycopg import AsyncConnection
from psycopg.rows import TupleRow
from psycopg.types.json import Jsonb

from thirdeye.ontology import Event

UPSERT_EVENT = """
insert into event (
    id, module_id, category, geom, t_start, t_end, severity,
    attrs, source_id, retrieved_at, confidence
) values (
    %(id)s, %(module_id)s, %(category)s,
    st_setsrid(st_geomfromgeojson(%(geom)s), 4326),
    %(t_start)s, %(t_end)s, %(severity)s,
    %(attrs)s, %(source_id)s, %(retrieved_at)s, %(confidence)s::confidence
)
on conflict (id) do update set
    category = excluded.category,
    geom = excluded.geom,
    t_start = excluded.t_start,
    t_end = excluded.t_end,
    severity = excluded.severity,
    attrs = excluded.attrs,
    retrieved_at = excluded.retrieved_at,
    confidence = excluded.confidence
"""

UPSERT_SNAPSHOT = """
insert into layer_snapshot (module_id, payload, fetched_at, record_count)
values (%(module_id)s, %(payload)s, %(fetched_at)s, %(record_count)s)
on conflict (module_id) do update set
    payload = excluded.payload,
    fetched_at = excluded.fetched_at,
    record_count = excluded.record_count
"""

UPSERT_HEALTH = """
insert into module_health (module_id, status, fetched_at, record_count, reason)
values (%(module_id)s, %(status)s::module_status, %(fetched_at)s,
        %(record_count)s, %(reason)s)
on conflict (module_id) do update set
    status = excluded.status,
    fetched_at = excluded.fetched_at,
    record_count = coalesce(%(record_count_update)s, module_health.record_count),
    reason = excluded.reason
"""

NOTIFY_LAYER = "select pg_notify('layer_updated', %s)"


def event_params(event: Event) -> dict[str, object]:
    return {
        "id": event.id,
        "module_id": event.module_id,
        "category": event.category,
        "geom": event.geom.model_dump_json(),
        "t_start": event.t_start,
        "t_end": event.t_end,
        "severity": event.severity,
        "attrs": Jsonb(event.attrs),
        "source_id": event.source_id,
        "retrieved_at": event.retrieved_at,
        "confidence": event.confidence.value,
    }


def snapshot_row(event: Event) -> dict[str, object]:
    return {
        "id": event.id,
        "category": event.category,
        "lon": event.geom.lon,
        "lat": event.geom.lat,
        "t_start": event.t_start.isoformat(),
        "t_end": event.t_end.isoformat() if event.t_end else None,
        "severity": event.severity,
        "confidence": event.confidence.value,
        "attrs": event.attrs,
    }


async def write_events(
    conn: AsyncConnection[TupleRow],
    module_id: str,
    events: Sequence[Event],
    fetched_at: datetime,
) -> None:
    async with conn.transaction(), conn.cursor() as cur:
        if events:
            await cur.executemany(UPSERT_EVENT, [event_params(e) for e in events])
        await cur.execute(
            UPSERT_SNAPSHOT,
            {
                "module_id": module_id,
                "payload": Jsonb([snapshot_row(e) for e in events]),
                "fetched_at": fetched_at,
                "record_count": len(events),
            },
        )
        await cur.execute(
            UPSERT_HEALTH,
            {
                "module_id": module_id,
                "status": "ok",
                "fetched_at": fetched_at,
                "record_count": len(events),
                "record_count_update": len(events),
                "reason": None,
            },
        )
        await cur.execute(NOTIFY_LAYER, (module_id,))


async def record_failure(
    conn: AsyncConnection[TupleRow],
    module_id: str,
    reason: str,
    failed_at: datetime,
) -> None:
    async with conn.transaction(), conn.cursor() as cur:
        await cur.execute(
            UPSERT_HEALTH,
            {
                "module_id": module_id,
                "status": "failed",
                "fetched_at": failed_at,
                "record_count": 0,
                "record_count_update": None,
                "reason": reason[:500],
            },
        )
