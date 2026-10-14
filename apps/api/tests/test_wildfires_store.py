import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import psycopg
import pytest

from thirdeye import store
from thirdeye.modules.wildfires.records import normalize

TEST_DB = os.environ.get("THIRDEYE_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DB, reason="set THIRDEYE_TEST_DATABASE_URL to run database tests"
)

FIXTURE = (
    Path(__file__).parents[1] / "src/thirdeye/modules/wildfires/fixture.csv"
).read_bytes()
FIRST = datetime(2026, 10, 14, 9, 0, tzinfo=UTC)

type Conn = psycopg.AsyncConnection[tuple[object, ...]]


@pytest.fixture
async def conn() -> AsyncIterator[Conn]:
    assert TEST_DB
    async with await psycopg.AsyncConnection.connect(TEST_DB, autocommit=True) as c:
        await clean(c)
        yield c
        await clean(c)


async def clean(c: Conn) -> None:
    await c.execute("delete from event where module_id = 'wildfires'")
    await c.execute("delete from layer_snapshot where module_id = 'wildfires'")
    await c.execute("delete from module_health where module_id = 'wildfires'")


async def count(c: Conn) -> int:
    cur = await c.execute("select count(*) from event where module_id = 'wildfires'")
    row = await cur.fetchone()
    assert row is not None
    value = row[0]
    assert isinstance(value, int)
    return value


async def test_fetching_the_same_window_twice_does_not_duplicate(conn: Conn) -> None:
    events = normalize(FIXTURE, FIRST)
    await store.write_events(conn, "wildfires", events, FIRST)
    assert await count(conn) == 11
    again = normalize(FIXTURE, FIRST + timedelta(hours=3))
    await store.write_events(conn, "wildfires", again, FIRST + timedelta(hours=3))
    assert await count(conn) == 11


async def test_overlapping_windows_add_only_new_detections(conn: Conn) -> None:
    events = normalize(FIXTURE, FIRST)
    await store.write_events(conn, "wildfires", events[:6], FIRST)
    assert await count(conn) == 6
    await store.write_events(conn, "wildfires", events[3:], FIRST)
    assert await count(conn) == 11


async def test_stored_rows_keep_position_time_and_power(conn: Conn) -> None:
    await store.write_events(conn, "wildfires", normalize(FIXTURE, FIRST), FIRST)
    cur = await conn.execute(
        """
        select st_x(geom), st_y(geom), t_start, severity, category,
               attrs ->> 'detection_confidence', confidence::text, source_id
        from event where id = 'wildfires:n:20261014T0647:16.521:98.043'
        """
    )
    assert await cur.fetchone() == (
        98.04327,
        16.52066,
        datetime(2026, 10, 14, 6, 47, tzinfo=UTC),
        27.6,
        "thermal-anomaly",
        "high",
        "derived",
        "nasa-firms",
    )


async def test_snapshot_carries_every_detection(conn: Conn) -> None:
    await store.write_events(conn, "wildfires", normalize(FIXTURE, FIRST), FIRST)
    cur = await conn.execute(
        "select record_count, jsonb_array_length(payload) "
        "from layer_snapshot where module_id = 'wildfires'"
    )
    assert await cur.fetchone() == (11, 11)
