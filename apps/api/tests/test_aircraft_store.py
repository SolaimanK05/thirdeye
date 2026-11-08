import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import psycopg
import pytest

from thirdeye import store
from thirdeye.modules.aircraft.manifest import MANIFEST
from thirdeye.modules.aircraft.records import normalize_entities
from thirdeye.ontology import EntityReport

TEST_DB = os.environ.get("THIRDEYE_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DB, reason="set THIRDEYE_TEST_DATABASE_URL to run database tests"
)

MODULE = "aircrafttest"
SOURCE = "aircrafttest-feed"
FIXTURE = Path(__file__).parents[1] / "src/thirdeye/modules/aircraft/fixture.json"
NOW = datetime.fromtimestamp(1792051205, UTC)

type Conn = psycopg.AsyncConnection[tuple[object, ...]]


def reports(at: datetime = NOW) -> list[EntityReport]:
    found = normalize_entities(FIXTURE.read_bytes(), at)
    return [
        r.model_copy(
            update={"entity": r.entity.model_copy(update={"source_id": SOURCE})}
        )
        for r in found
    ]


@pytest.fixture
async def conn() -> AsyncIterator[Conn]:
    assert TEST_DB
    async with await psycopg.AsyncConnection.connect(TEST_DB, autocommit=True) as c:
        await clean(c)
        await c.execute(
            """
            insert into source (id, module_id, url, licence, reliability)
            values (%s, %s, 'http://localhost/test', 'test', 'aggregated')
            """,
            (SOURCE, MODULE),
        )
        yield c
        await clean(c)


async def clean(c: Conn) -> None:
    await c.execute("delete from entity where source_id = %s", (SOURCE,))
    await c.execute("delete from source where id = %s", (SOURCE,))
    await c.execute("delete from layer_snapshot where module_id = %s", (MODULE,))
    await c.execute("delete from module_health where module_id = %s", (MODULE,))


async def write(c: Conn, found: list[EntityReport], at: datetime = NOW) -> int:
    return await store.write_entities(
        c,
        MODULE,
        SOURCE,
        found,
        at,
        latest_only=MANIFEST.observation_retention_seconds is None,
        snapshot_window_seconds=MANIFEST.snapshot_window_seconds,
    )


async def scalar(c: Conn, query: str) -> Any:
    cur = await c.execute(query)
    row = await cur.fetchone()
    assert row is not None
    return row[0]


async def test_a_batch_of_states_becomes_aircraft_and_a_snapshot(conn: Conn) -> None:
    assert await write(conn, reports()) == 11
    assert (
        await scalar(conn, f"select count(*) from entity where source_id = '{SOURCE}'")
        == 11
    )
    payload = await scalar(
        conn, f"select payload from layer_snapshot where module_id = '{MODULE}'"
    )
    assert len(payload) == 11
    qatar = next(row for row in payload if row["name"] == "QTR8123")
    assert qatar["kind"] == "aircraft"
    assert qatar["cog"] == pytest.approx(312.5)
    assert qatar["attrs"]["category"] == 6


async def test_writing_the_same_batch_twice_changes_nothing(conn: Conn) -> None:
    await write(conn, reports())
    await write(conn, reports())
    assert (
        await scalar(conn, f"select count(*) from entity where source_id = '{SOURCE}'")
        == 11
    )
    assert (
        await scalar(
            conn, f"select count(*) from observation where source_id = '{SOURCE}'"
        )
        == 11
    )


async def test_the_next_poll_adds_a_fix_and_keeps_the_aircraft(conn: Conn) -> None:
    await write(conn, reports())
    later = NOW + timedelta(seconds=90)
    moved = [
        r.model_copy(
            update={
                "fix": r.fix.model_copy(update={"t": r.fix.t + timedelta(seconds=90)})
            }
        )
        for r in reports(later)
        if r.fix is not None
    ]
    await write(conn, moved, later)
    assert (
        await scalar(conn, f"select count(*) from entity where source_id = '{SOURCE}'")
        == 11
    )
    assert (
        await scalar(
            conn, f"select count(*) from observation where source_id = '{SOURCE}'"
        )
        == 22
    )


async def test_an_aircraft_that_changes_callsign_keeps_one_entity(conn: Conn) -> None:
    await write(conn, reports())
    renamed = [
        r.model_copy(
            update={
                "entity": r.entity.model_copy(
                    update={
                        "names": ("NEW123",),
                        "identifiers": r.entity.identifiers.model_copy(
                            update={"callsign": "NEW123"}
                        ),
                    }
                )
            }
        )
        for r in reports(NOW + timedelta(minutes=5))
        if r.entity.identifiers.icao24 == "06a0a1"
    ]
    await write(conn, renamed, NOW + timedelta(minutes=5))
    assert (
        await scalar(conn, f"select count(*) from entity where source_id = '{SOURCE}'")
        == 11
    )
    names = await scalar(
        conn,
        f"select names from entity where source_id = '{SOURCE}' "
        "and identifiers ->> 'icao24' = '06a0a1'",
    )
    assert names == ["NEW123", "QTR8123"]


async def test_pruning_drops_old_fixes_but_not_recent_ones(conn: Conn) -> None:
    await write(conn, reports())
    later = (
        NOW
        + timedelta(seconds=MANIFEST.observation_retention_seconds or 0)
        + timedelta(seconds=1)
    )
    await write(conn, reports(later), later)
    removed = await store.prune_observations(
        conn, SOURCE, MANIFEST.observation_retention_seconds or 0, later
    )
    assert removed == 11
