import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import psycopg
import pytest

from thirdeye import store
from thirdeye.ontology import Confidence, Event, Point

TEST_DB = os.environ.get("THIRDEYE_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DB, reason="set THIRDEYE_TEST_DATABASE_URL to run database tests"
)

MODULE = "storetest"
NOW = datetime(2026, 10, 12, 20, 0, tzinfo=UTC)


def event(n: int, severity: float | None = 3.0) -> Event:
    return Event(
        id=f"{MODULE}:{n}",
        module_id=MODULE,
        category="earthquake",
        geom=Point.at(90.4, 23.8),
        t_start=NOW - timedelta(minutes=n),
        t_end=NOW - timedelta(minutes=n),
        severity=severity,
        attrs={"depth_km": 10.0},
        source_id="usgs-earthquakes",
        retrieved_at=NOW,
        confidence=Confidence.OBSERVED,
    )


@pytest.fixture
async def conn() -> AsyncIterator[psycopg.AsyncConnection[tuple[object, ...]]]:
    assert TEST_DB
    async with await psycopg.AsyncConnection.connect(TEST_DB, autocommit=True) as c:
        yield c
        for table in ("event", "layer_snapshot", "module_health"):
            column = "id" if table == "event" else "module_id"
            pattern = f"{MODULE}:%" if table == "event" else MODULE
            await c.execute(
                f"delete from {table} where {column} like %s",
                (pattern,),
            )


async def scalar(conn: psycopg.AsyncConnection[tuple[object, ...]], sql: str) -> object:
    cur = await conn.execute(sql)
    row = await cur.fetchone()
    assert row is not None
    return row[0]


async def test_write_is_idempotent(
    conn: psycopg.AsyncConnection[tuple[object, ...]],
) -> None:
    events = [event(1), event(2)]
    await store.write_events(conn, MODULE, events, NOW)
    await store.write_events(conn, MODULE, events, NOW)
    count = await scalar(conn, f"select count(*) from event where id like '{MODULE}:%'")
    assert count == 2


async def test_geometry_keeps_longitude_first(
    conn: psycopg.AsyncConnection[tuple[object, ...]],
) -> None:
    await store.write_events(conn, MODULE, [event(1)], NOW)
    lon = await scalar(conn, f"select st_x(geom) from event where id = '{MODULE}:1'")
    assert lon == pytest.approx(90.4)


async def test_snapshot_and_health_are_replaced(
    conn: psycopg.AsyncConnection[tuple[object, ...]],
) -> None:
    await store.write_events(conn, MODULE, [event(1), event(2)], NOW)
    await store.write_events(conn, MODULE, [event(3)], NOW)
    size = await scalar(
        conn,
        f"select jsonb_array_length(payload) from layer_snapshot where module_id = '{MODULE}'",
    )
    status = await scalar(
        conn, f"select status::text from module_health where module_id = '{MODULE}'"
    )
    assert size == 1
    assert status == "ok"


async def test_failure_keeps_last_count_and_sets_reason(
    conn: psycopg.AsyncConnection[tuple[object, ...]],
) -> None:
    await store.write_events(conn, MODULE, [event(1), event(2)], NOW)
    await store.record_failure(conn, MODULE, "ConnectError: down", NOW)
    cur = await conn.execute(
        "select status::text, record_count, reason from module_health where module_id = %s",
        (MODULE,),
    )
    assert await cur.fetchone() == ("failed", 2, "ConnectError: down")


async def test_write_sends_notify(
    conn: psycopg.AsyncConnection[tuple[object, ...]],
) -> None:
    assert TEST_DB
    async with await psycopg.AsyncConnection.connect(
        TEST_DB, autocommit=True
    ) as listener:
        await listener.execute("listen layer_updated")
        await store.write_events(conn, MODULE, [event(1)], NOW)
        gen = listener.notifies(timeout=5, stop_after=1)
        payloads = [n.payload async for n in gen]
    assert payloads == [MODULE]
