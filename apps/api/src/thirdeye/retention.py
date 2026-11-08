"""Daily clean-up so a small database stays small.

Two things grow without bound otherwise: events from modules that do not prune
their own (earthquakes), and the fixes of starred entities (an unstarred
mover's fixes are already pruned by its module, but a starred one is kept).
Deletes run in batches so no single statement holds a lock for long.
"""

import asyncio
from collections.abc import Awaitable, Callable, Collection
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import structlog
from psycopg import AsyncConnection
from psycopg.rows import TupleRow

from thirdeye.config import Settings
from thirdeye.db import Pool

log = structlog.get_logger()

BATCH = 5000
DAY_SECONDS = 86_400

PRUNE_EVENTS = """
delete from event where ctid in (
    select ctid from event
    where t_start < %(cutoff)s
      and not (module_id = any(%(own)s))
    limit %(batch)s
)
"""

PRUNE_STARRED_FIXES = """
delete from observation where ctid in (
    select o.ctid
    from observation o
    join watchlist_entry w on w.entity_id = o.entity_id
    where o.t < %(cutoff)s
    limit %(batch)s
)
"""

type Sleep = Callable[[float], Awaitable[None]]
type Clock = Callable[[], datetime]


@dataclass(frozen=True)
class Removed:
    events: int
    starred_fixes: int


async def delete_in_batches(
    conn: AsyncConnection[TupleRow], query: str, params: dict[str, object]
) -> int:
    removed = 0
    while True:
        async with conn.transaction(), conn.cursor() as cur:
            await cur.execute(query, params | {"batch": BATCH})
            batch = cur.rowcount
        removed += batch
        if batch < BATCH:
            return removed


async def apply_retention(
    conn: AsyncConnection[TupleRow],
    settings: Settings,
    now: datetime,
    own_event_retention: Collection[str] = (),
) -> Removed:
    """Delete what is past its keep time. `own_event_retention` lists modules that prune their own events."""
    events = await delete_in_batches(
        conn,
        PRUNE_EVENTS,
        {
            "cutoff": now - timedelta(days=settings.retention_event_days),
            "own": list(own_event_retention),
        },
    )
    fixes = await delete_in_batches(
        conn,
        PRUNE_STARRED_FIXES,
        {"cutoff": now - timedelta(hours=settings.retention_starred_hours)},
    )
    return Removed(events=events, starred_fixes=fixes)


def seconds_until_hour(now: datetime, hour: int) -> float:
    """Seconds from `now` to the next time the UTC clock reads `hour`:00; never zero."""
    target = now.astimezone(UTC).replace(hour=hour, minute=0, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


async def run_retention(
    pool: Pool,
    settings: Settings,
    own_event_retention: Collection[str],
    *,
    sleep: Sleep = asyncio.sleep,
    clock: Clock = lambda: datetime.now(UTC),
    forever: bool = True,
) -> None:
    """Clean up now, then again every day at `retention_hour_utc`."""
    while True:
        now = clock()
        try:
            async with pool.connection() as conn:
                removed = await apply_retention(
                    conn, settings, now, own_event_retention
                )
            log.info(
                "retention.done",
                events=removed.events,
                starred_fixes=removed.starred_fixes,
            )
        except Exception as exc:  # noqa: BLE001 - one bad night must not stop the worker
            log.warning("retention.failed", error=type(exc).__name__)
        if not forever:
            return
        await sleep(seconds_until_hour(clock(), settings.retention_hour_utc))
