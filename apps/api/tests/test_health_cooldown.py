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

MODULE = "cooltest"
NOW = datetime(2026, 10, 26, 11, 21, tzinfo=UTC)
LATER = NOW + timedelta(minutes=11)

type Conn = psycopg.AsyncConnection[tuple[object, ...]]


def event() -> Event:
    return Event(
        id=f"{MODULE}:1",
        module_id=MODULE,
        category="earthquake",
        geom=Point.at(90.4, 23.8),
        t_start=NOW,
        t_end=NOW,
        severity=3.0,
        attrs={},
        source_id="usgs-earthquakes",
        retrieved_at=NOW,
        confidence=Confidence.OBSERVED,
    )


@pytest.fixture
async def conn() -> AsyncIterator[Conn]:
    assert TEST_DB
    async with await psycopg.AsyncConnection.connect(TEST_DB, autocommit=True) as c:
        yield c
        await c.execute("delete from event where id like %s", (f"{MODULE}:%",))
        await c.execute("delete from layer_snapshot where module_id = %s", (MODULE,))
        await c.execute("delete from module_health where module_id = %s", (MODULE,))


async def health(conn: Conn) -> tuple[object, ...]:
    cur = await conn.execute(
        "select status::text, fetched_at, record_count, reason, cooldown_until, meta"
        " from module_health where module_id = %s",
        (MODULE,),
    )
    row = await cur.fetchone()
    assert row is not None
    return row


async def test_a_cooldown_keeps_the_last_good_time_and_count(conn: Conn) -> None:
    await store.write_events(conn, MODULE, [event()], NOW)
    await store.record_cooldown(conn, MODULE, LATER, "cooldown until 11:32Z", LATER)
    status, fetched_at, count, reason, until, _ = await health(conn)
    assert status == "ok"
    assert fetched_at == NOW
    assert count == 1
    assert reason == "cooldown until 11:32Z"
    assert until == LATER


async def test_a_cooldown_before_any_good_fetch_makes_a_failed_row(conn: Conn) -> None:
    await store.record_cooldown(conn, MODULE, LATER, "cooldown until 11:32Z", NOW)
    status, fetched_at, count, reason, until, _ = await health(conn)
    assert status == "failed"
    assert fetched_at == NOW
    assert count == 0
    assert reason == "cooldown until 11:32Z"
    assert until == LATER


async def test_the_next_good_write_ends_the_cooldown(conn: Conn) -> None:
    await store.record_cooldown(conn, MODULE, LATER, "cooldown until 11:32Z", NOW)
    await store.write_events(conn, MODULE, [event()], LATER)
    status, fetched_at, _, reason, until, _ = await health(conn)
    assert status == "ok"
    assert fetched_at == LATER
    assert reason is None
    assert until is None


async def test_a_failure_ends_the_cooldown_too(conn: Conn) -> None:
    await store.write_events(conn, MODULE, [event()], NOW)
    await store.record_cooldown(conn, MODULE, LATER, "cooldown until 11:32Z", NOW)
    await store.record_failure(conn, MODULE, "ConnectError: down", LATER)
    status, _, _, reason, until, _ = await health(conn)
    assert status == "failed"
    assert reason == "ConnectError: down"
    assert until is None


async def test_meta_is_stored_and_survives_a_new_write(conn: Conn) -> None:
    await store.write_events(conn, MODULE, [event()], NOW)
    await store.record_meta(
        conn, MODULE, {"credits_left": 3796, "interval_seconds": 91}
    )
    await store.write_events(conn, MODULE, [event()], LATER)
    meta = (await health(conn))[5]
    assert meta == {"credits_left": 3796, "interval_seconds": 91}


async def test_meta_for_a_module_without_health_changes_nothing(conn: Conn) -> None:
    await store.record_meta(conn, MODULE, {"credits_left": 1})
    cur = await conn.execute(
        "select count(*) from module_health where module_id = %s", (MODULE,)
    )
    row = await cur.fetchone()
    assert row == (0,)
