from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import structlog
from psycopg import AsyncConnection, sql
from psycopg.rows import TupleRow
from psycopg.types.json import Jsonb
from pydantic import JsonValue

from thirdeye.db import Pool
from thirdeye.identity import (
    STRONG_KEYS,
    WEAK_KEYS,
    Candidate,
    Resolution,
    display_name,
    key_text,
    keys_of,
    resolve,
)
from thirdeye.ontology import EntityKind, EntityReport, Event, ModuleManifest

log = structlog.get_logger()

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
    reason = excluded.reason,
    cooldown_until = null
"""

UPSERT_COOLDOWN = """
insert into module_health (
    module_id, status, fetched_at, record_count, reason, cooldown_until
) values (
    %(module_id)s, 'failed'::module_status, %(now)s, 0, %(reason)s, %(until)s
)
on conflict (module_id) do update set
    reason = excluded.reason,
    cooldown_until = excluded.cooldown_until
"""

LAST_ATTEMPT = """
select fetched_at, status::text = 'ok' from module_health where module_id = %s
"""

UPDATE_META = """
update module_health set meta = %(meta)s where module_id = %(module_id)s
"""

PRUNE_EVENTS = """
delete from event where module_id = %s and t_start < %s
"""

NOTIFY_LAYER = "select pg_notify('layer_updated', %s)"

INSERT_ENTITY = """
insert into entity (
    id, kind, names, identifiers, attrs,
    first_seen, last_seen, source_id, retrieved_at
) values (
    %(id)s, %(kind)s::entity_kind, %(names)s, %(identifiers)s, %(attrs)s,
    %(first_seen)s, %(last_seen)s, %(source_id)s, %(retrieved_at)s
)
"""

UPDATE_ENTITY = """
update entity set
    names = %(names)s,
    identifiers = %(identifiers)s,
    attrs = %(attrs)s,
    first_seen = %(first_seen)s,
    last_seen = %(last_seen)s,
    retrieved_at = %(retrieved_at)s
where id = %(id)s
"""

DELETE_FIXES = """
delete from observation where entity_id = any(%s) and source_id = %s
"""

INSERT_FIX = """
insert into observation (
    entity_id, t, source_id, geom, sog, cog, heading, alt, confidence
) values (
    %(entity_id)s, %(t)s, %(source_id)s,
    st_setsrid(st_geomfromgeojson(%(geom)s), 4326),
    %(sog)s, %(cog)s, %(heading)s, %(alt)s, %(confidence)s::confidence
)
on conflict (entity_id, t, source_id) do nothing
"""

ENTITY_SNAPSHOT = """
select
    e.id::text, e.kind::text, e.names, e.identifiers, e.attrs,
    o.t, st_x(o.geom), st_y(o.geom),
    o.sog, o.cog, o.heading, o.alt, o.confidence::text
from entity e
join lateral (
    select t, geom, sog, cog, heading, alt, confidence
    from observation
    where entity_id = e.id
      and source_id = %(source_id)s
      and (%(since)s::timestamptz is null or t >= %(since)s)
    order by t desc
    limit 1
) o on true
where e.source_id = %(source_id)s
order by e.id
"""

PRUNE_OBSERVATIONS = """
delete from observation where ctid in (
    select o.ctid
    from observation o
    where o.source_id = %(source_id)s
      and o.t < %(cutoff)s
      and not exists (
          select 1 from watchlist_entry w where w.entity_id = o.entity_id
      )
    limit %(batch)s
)
"""

PRUNE_BATCH = 5000

RENDER_HINTS = ("on_ground", "category", "ship_type", "harbor_size")


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
    *,
    snapshot_rows: bool = True,
) -> None:
    async with conn.transaction(), conn.cursor() as cur:
        if events:
            await cur.executemany(UPSERT_EVENT, [event_params(e) for e in events])
        await cur.execute(
            UPSERT_SNAPSHOT,
            {
                "module_id": module_id,
                "payload": Jsonb(
                    [snapshot_row(e) for e in events] if snapshot_rows else []
                ),
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


async def prune_events(
    conn: AsyncConnection[TupleRow],
    module_id: str,
    keep_seconds: int,
    now: datetime,
) -> int:
    async with conn.transaction(), conn.cursor() as cur:
        await cur.execute(
            PRUNE_EVENTS, (module_id, now - timedelta(seconds=keep_seconds))
        )
        return cur.rowcount


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


@dataclass(frozen=True, slots=True)
class LastAttempt:
    at: datetime
    ok: bool


async def read_last_attempt(pool: Pool, module_id: str) -> LastAttempt | None:
    async with pool.connection() as conn, conn.cursor() as cur:
        await cur.execute(LAST_ATTEMPT, (module_id,))
        row = await cur.fetchone()
    if row is None:
        return None
    at, ok = row
    assert isinstance(at, datetime)
    return LastAttempt(at=at, ok=bool(ok))


async def record_cooldown(
    conn: AsyncConnection[TupleRow],
    module_id: str,
    until: datetime,
    reason: str,
    now: datetime,
) -> None:
    async with conn.transaction(), conn.cursor() as cur:
        await cur.execute(
            UPSERT_COOLDOWN,
            {
                "module_id": module_id,
                "until": until,
                "reason": reason[:500],
                "now": now,
            },
        )


async def record_meta(
    conn: AsyncConnection[TupleRow],
    module_id: str,
    meta: Mapping[str, JsonValue],
) -> None:
    async with conn.transaction(), conn.cursor() as cur:
        await cur.execute(UPDATE_META, {"module_id": module_id, "meta": Jsonb(meta)})


@dataclass(frozen=True, slots=True)
class StoredEntity:
    id: UUID
    kind: EntityKind
    names: list[str]
    identifiers: dict[str, JsonValue]
    attrs: dict[str, JsonValue]
    first_seen: datetime
    last_seen: datetime

    def candidate(self) -> Candidate:
        return Candidate(
            id=self.id,
            kind=self.kind,
            identifiers=self.identifiers,
            last_seen=self.last_seen,
        )


def lookup_keys(reports: Iterable[EntityReport]) -> dict[str, list[str]]:
    wanted: dict[str, set[str]] = {}
    for report in reports:
        found = keys_of(
            report.entity.identifiers.model_dump(), (*STRONG_KEYS, *WEAK_KEYS)
        )
        for key, value in found.items():
            wanted.setdefault(key, set()).add(value)
    return {key: sorted(values) for key, values in wanted.items()}


def candidate_query(keys: Iterable[str]) -> sql.Composed:
    clauses = sql.SQL(" or ").join(
        sql.SQL("(identifiers ->> {key}) = any({values})").format(
            key=sql.Literal(key), values=sql.Placeholder(key)
        )
        for key in keys
    )
    return sql.SQL(
        "select id, kind::text, names, identifiers, attrs, first_seen, last_seen "
        "from entity where kind = any(%(kinds)s::entity_kind[]) and ({clauses})"
    ).format(clauses=clauses)


async def find_stored(
    conn: AsyncConnection[TupleRow], reports: Sequence[EntityReport]
) -> list[StoredEntity]:
    wanted = lookup_keys(reports)
    if not wanted:
        return []
    params: dict[str, object] = {
        "kinds": sorted({report.entity.kind.value for report in reports}),
        **wanted,
    }
    async with conn.cursor() as cur:
        await cur.execute(candidate_query(wanted), params)
        return [
            StoredEntity(
                id=row[0],
                kind=EntityKind(row[1]),
                names=list(row[2]),
                identifiers=row[3],
                attrs=row[4],
                first_seen=row[5],
                last_seen=row[6],
            )
            for row in await cur.fetchall()
        ]


def merged_names(newest: Sequence[str], stored: Sequence[str]) -> list[str]:
    seen: set[str] = set()
    names: list[str] = []
    for name in [*newest, *stored]:
        text = name.strip()
        if text and text.casefold() not in seen:
            seen.add(text.casefold())
            names.append(text)
    return names


def merged_identifiers(
    stored: Mapping[str, JsonValue], reported: Sequence[Mapping[str, JsonValue]]
) -> dict[str, JsonValue]:
    merged = dict(stored)
    for identifiers in reported:
        for key, value in identifiers.items():
            if key_text(value) is None:
                continue
            if key in STRONG_KEYS and key_text(merged.get(key)) is not None:
                continue
            merged[key] = value
    return merged


def entity_params(
    resolution: Resolution,
    reports: Sequence[EntityReport],
    stored: StoredEntity | None,
    entity_id: UUID,
) -> dict[str, object]:
    members = [reports[i].entity for i in resolution.members]
    newest = [name for entity in reversed(members) for name in entity.names]
    attrs: dict[str, JsonValue] = {} if stored is None else dict(stored.attrs)
    for entity in members:
        attrs.update(entity.attrs)
    first_seen = min(entity.first_seen for entity in members)
    last_seen = max(entity.last_seen for entity in members)
    if stored is not None:
        first_seen = min(first_seen, stored.first_seen)
        last_seen = max(last_seen, stored.last_seen)
    return {
        "id": entity_id,
        "kind": members[0].kind.value,
        "names": merged_names(newest, [] if stored is None else stored.names),
        "identifiers": Jsonb(
            merged_identifiers(
                {} if stored is None else stored.identifiers,
                [
                    entity.identifiers.model_dump(exclude_none=True)
                    for entity in members
                ],
            )
        ),
        "attrs": Jsonb(attrs),
        "first_seen": first_seen,
        "last_seen": last_seen,
        "source_id": members[0].source_id,
        "retrieved_at": max(entity.retrieved_at for entity in members),
    }


def fix_params(entity_id: UUID, report: EntityReport) -> dict[str, object] | None:
    fix = report.fix
    if fix is None:
        return None
    return {
        "entity_id": entity_id,
        "t": fix.t,
        "source_id": report.entity.source_id,
        "geom": fix.geom.model_dump_json(),
        "sog": fix.sog,
        "cog": fix.cog,
        "heading": fix.heading,
        "alt": fix.alt,
        "confidence": fix.confidence.value,
    }


def entity_snapshot_row(row: Sequence[object]) -> dict[str, object]:
    (
        entity_id,
        kind,
        names,
        identifiers,
        attrs,
        t,
        lon,
        lat,
        sog,
        cog,
        heading,
        alt,
        confidence,
    ) = row
    assert isinstance(t, datetime)
    assert isinstance(names, list)
    assert isinstance(identifiers, dict)
    assert isinstance(attrs, dict)
    return {
        "id": entity_id,
        "kind": kind,
        "name": display_name(names, identifiers, str(entity_id)),
        "lon": lon,
        "lat": lat,
        "t": t.astimezone(UTC).isoformat(),
        "sog": sog,
        "cog": cog,
        "heading": heading,
        "alt": alt,
        "confidence": confidence,
        "attrs": {k: v for k, v in attrs.items() if k in RENDER_HINTS},
    }


async def write_entities(
    conn: AsyncConnection[TupleRow],
    module_id: str,
    source_id: str,
    reports: Sequence[EntityReport],
    fetched_at: datetime,
    *,
    latest_only: bool,
    snapshot_window_seconds: int | None,
) -> int:
    async with conn.transaction():
        stored = await find_stored(conn, reports)
        by_id = {entity.id: entity for entity in stored}
        resolutions = resolve(reports, [e.candidate() for e in stored], fetched_at)

        inserts: list[dict[str, object]] = []
        updates: list[dict[str, object]] = []
        fixes: list[dict[str, object]] = []
        touched: list[UUID] = []
        for resolution in resolutions:
            existing = (
                None if resolution.entity_id is None else by_id[resolution.entity_id]
            )
            entity_id = uuid4() if existing is None else existing.id
            params = entity_params(resolution, reports, existing, entity_id)
            (inserts if existing is None else updates).append(params)
            touched.append(entity_id)
            for index in resolution.members:
                fix = fix_params(entity_id, reports[index])
                if fix is not None:
                    fixes.append(fix)

        async with conn.cursor() as cur:
            if inserts:
                await cur.executemany(INSERT_ENTITY, inserts)
            if updates:
                await cur.executemany(UPDATE_ENTITY, updates)
            if latest_only and touched:
                await cur.execute(DELETE_FIXES, (touched, source_id))
            if fixes:
                await cur.executemany(INSERT_FIX, fixes)

            since = (
                None
                if snapshot_window_seconds is None
                else fetched_at - timedelta(seconds=snapshot_window_seconds)
            )
            await cur.execute(ENTITY_SNAPSHOT, {"source_id": source_id, "since": since})
            rows = [entity_snapshot_row(row) for row in await cur.fetchall()]
            record_count = len(rows) if fixes else len(touched)
            await cur.execute(
                UPSERT_SNAPSHOT,
                {
                    "module_id": module_id,
                    "payload": Jsonb(rows),
                    "fetched_at": fetched_at,
                    "record_count": record_count,
                },
            )
            await cur.execute(
                UPSERT_HEALTH,
                {
                    "module_id": module_id,
                    "status": "ok",
                    "fetched_at": fetched_at,
                    "record_count": record_count,
                    "record_count_update": record_count,
                    "reason": None,
                },
            )
            await cur.execute(NOTIFY_LAYER, (module_id,))
    return record_count


async def prune_observations(
    conn: AsyncConnection[TupleRow],
    source_id: str,
    keep_seconds: int,
    now: datetime,
) -> int:
    removed = 0
    cutoff = now - timedelta(seconds=keep_seconds)
    while True:
        async with conn.transaction(), conn.cursor() as cur:
            await cur.execute(
                PRUNE_OBSERVATIONS,
                {"source_id": source_id, "cutoff": cutoff, "batch": PRUNE_BATCH},
            )
            batch = cur.rowcount
        removed += batch
        if batch < PRUNE_BATCH:
            return removed


async def store_entity_batch(
    pool: Pool,
    manifest: ModuleManifest,
    reports: Sequence[EntityReport],
    fetched_at: datetime,
    *,
    prune: bool = True,
) -> int:
    keep = manifest.observation_retention_seconds
    async with pool.connection() as conn:
        count = await write_entities(
            conn,
            manifest.id,
            manifest.provenance.source_id,
            reports,
            fetched_at,
            latest_only=keep is None,
            snapshot_window_seconds=manifest.snapshot_window_seconds,
        )
        if keep is not None and prune:
            removed = await prune_observations(
                conn, manifest.provenance.source_id, keep, fetched_at
            )
            if removed:
                log.info("module.pruned", module=manifest.id, removed=removed)
    return count
