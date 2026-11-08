import json
import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import psycopg
import pytest

from thirdeye import store
from thirdeye.config import Settings
from thirdeye.db import Pool, create_pool
from thirdeye.modules.vessels.manifest import MANIFEST as VESSELS
from thirdeye.modules.vessels.records import normalize_entities
from thirdeye.ontology import EntityReport, ModuleManifest

TEST_DB = os.environ.get("THIRDEYE_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DB, reason="set THIRDEYE_TEST_DATABASE_URL to run database tests"
)

MODULE = "vesseltest"
SOURCE = "vesseltest-feed"
FIXTURE = Path(__file__).parents[1] / "src/thirdeye/modules/vessels/fixture.ndjson"
NOW = datetime(2026, 10, 27, 6, 1, tzinfo=UTC)
EXAMPLE_IMO = "9074729"
OTHER_IMO = "9123453"
THIRD_IMO = "9781231"

type Conn = psycopg.AsyncConnection[tuple[object, ...]]


def manifest_under_test() -> ModuleManifest:
    provenance = VESSELS.provenance.model_copy(update={"source_id": SOURCE})
    return VESSELS.model_copy(update={"id": MODULE, "provenance": provenance})


def frame(document: dict[str, Any]) -> bytes:
    return json.dumps(document).encode()


def position(mmsi: int, at: datetime, *, lat: float = 22.2, lon: float = 91.8) -> bytes:
    return frame(
        {
            "MessageType": "PositionReport",
            "Message": {
                "PositionReport": {
                    "UserID": mmsi,
                    "Valid": True,
                    "Latitude": lat,
                    "Longitude": lon,
                    "Sog": 8.0,
                    "Cog": 100.0,
                    "TrueHeading": 101,
                }
            },
            "MetaData": {"time_utc": at.strftime("%Y-%m-%d %H:%M:%S +0000 UTC")},
        }
    )


def static(mmsi: int, imo: int, name: str, at: datetime) -> bytes:
    return frame(
        {
            "MessageType": "ShipStaticData",
            "Message": {
                "ShipStaticData": {
                    "UserID": mmsi,
                    "Valid": True,
                    "ImoNumber": imo,
                    "Name": name,
                    "Type": 70,
                    "Destination": "SINGAPORE",
                }
            },
            "MetaData": {"time_utc": at.strftime("%Y-%m-%d %H:%M:%S +0000 UTC")},
        }
    )


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


@pytest.fixture
async def pool() -> AsyncIterator[Pool]:
    assert TEST_DB
    opened = create_pool(Settings(database_url=TEST_DB, _env_file=None))
    await opened.open()
    yield opened
    await opened.close()


async def clean(c: Conn) -> None:
    await c.execute("delete from entity where source_id = %s", (SOURCE,))
    await c.execute("delete from source where id = %s", (SOURCE,))
    await c.execute("delete from layer_snapshot where module_id = %s", (MODULE,))
    await c.execute("delete from module_health where module_id = %s", (MODULE,))


def reports_from(raw: bytes, at: datetime) -> list[EntityReport]:
    return [
        r.model_copy(
            update={"entity": r.entity.model_copy(update={"source_id": SOURCE})}
        )
        for r in normalize_entities(raw, at)
    ]


async def ingest(pool: Pool, raw: bytes, at: datetime = NOW) -> int:
    return await store.store_entity_batch(
        pool, manifest_under_test(), reports_from(raw, at), at
    )


async def scalar(c: Conn, query: str) -> Any:
    cur = await c.execute(query)
    row = await cur.fetchone()
    assert row is not None
    return row[0]


async def snapshot(c: Conn) -> list[dict[str, Any]]:
    payload = await scalar(
        c, f"select payload from layer_snapshot where module_id = '{MODULE}'"
    )
    assert isinstance(payload, list)
    return payload


async def vessels_of(c: Conn, mmsi: str) -> list[tuple[Any, Any]]:
    cur = await c.execute(
        """
        select identifiers->>'imo', names[1] from entity
        where source_id = %s and identifiers->>'mmsi' = %s
        order by identifiers->>'imo' nulls first
        """,
        (SOURCE, mmsi),
    )
    return [(row[0], row[1]) for row in await cur.fetchall()]


async def test_the_fixture_becomes_vessels_and_a_snapshot(
    conn: Conn, pool: Pool
) -> None:
    await ingest(pool, FIXTURE.read_bytes())
    assert (
        await scalar(conn, f"select count(*) from entity where source_id = '{SOURCE}'")
        == 6
    )
    rows = await snapshot(conn)
    assert sorted(row["name"] for row in rows) == [
        "MV EXAMPLE STAR",
        "PACIFIC TRADER",
        "SEA HAWK",
        "SLOW LORIS",
    ]
    star = next(row for row in rows if row["name"] == "MV EXAMPLE STAR")
    assert star["kind"] == "vessel"
    assert star["heading"] == 191
    assert star["sog"] == pytest.approx(12.1)
    assert star["confidence"] == "observed"
    assert star["attrs"] == {"ship_type": "cargo"}


async def test_the_static_and_position_of_one_vessel_become_one_entity(
    conn: Conn, pool: Pool
) -> None:
    await ingest(pool, FIXTURE.read_bytes())
    assert await vessels_of(conn, "405000123") == [(EXAMPLE_IMO, "MV EXAMPLE STAR")]
    assert (
        await scalar(
            conn,
            """
            select count(*) from observation o join entity e on e.id = o.entity_id
            where e.source_id = %s and e.identifiers->>'mmsi' = '405000123'
            """.replace("%s", f"'{SOURCE}'"),
        )
        == 1
    )


async def test_two_vessels_on_one_mmsi_with_different_imos_stay_two_entities(
    conn: Conn, pool: Pool
) -> None:
    await ingest(pool, FIXTURE.read_bytes())
    assert await vessels_of(conn, "563000999") == [
        (OTHER_IMO, "DOUBLE TROUBLE"),
        (THIRD_IMO, "DOUBLE TROUBLE"),
    ]


async def test_the_same_split_holds_when_the_messages_come_in_separate_batches(
    conn: Conn, pool: Pool
) -> None:
    await ingest(pool, static(563000999, 9074729, "ONE", NOW))
    later = NOW + timedelta(minutes=10)
    await ingest(pool, static(563000999, 9123453, "TWO", later), later)
    assert await vessels_of(conn, "563000999") == [
        (EXAMPLE_IMO, "ONE"),
        (OTHER_IMO, "TWO"),
    ]


async def test_a_bare_position_joins_the_vessel_already_known_by_its_mmsi(
    conn: Conn, pool: Pool
) -> None:
    await ingest(pool, static(405000123, 9074729, "MV EXAMPLE STAR", NOW))
    later = NOW + timedelta(minutes=5)
    await ingest(pool, position(405000123, later), later)
    assert await vessels_of(conn, "405000123") == [(EXAMPLE_IMO, "MV EXAMPLE STAR")]
    [row] = await snapshot(conn)
    assert row["name"] == "MV EXAMPLE STAR"
    assert row["lon"] == pytest.approx(91.8)


async def test_a_position_a_day_later_is_a_new_vessel_not_a_guess(
    conn: Conn, pool: Pool
) -> None:
    await ingest(pool, static(405000123, 9074729, "MV EXAMPLE STAR", NOW))
    later = NOW + timedelta(hours=25)
    await ingest(pool, position(405000123, later), later)
    assert len(await vessels_of(conn, "405000123")) == 2


async def test_writing_the_same_batch_twice_changes_nothing(
    conn: Conn, pool: Pool
) -> None:
    await ingest(pool, FIXTURE.read_bytes())
    await ingest(pool, FIXTURE.read_bytes())
    assert (
        await scalar(conn, f"select count(*) from entity where source_id = '{SOURCE}'")
        == 6
    )
    assert (
        await scalar(
            conn, f"select count(*) from observation where source_id = '{SOURCE}'"
        )
        == 4
    )


async def test_a_vessel_not_heard_from_for_a_while_leaves_the_snapshot(
    conn: Conn, pool: Pool
) -> None:
    await ingest(pool, position(405000123, NOW))
    later = (
        NOW
        + timedelta(seconds=VESSELS.snapshot_window_seconds or 0)
        + timedelta(minutes=1)
    )
    await ingest(pool, position(477123456, later), later)
    rows = await snapshot(conn)
    assert len(rows) == 1
    assert rows[0]["lat"] == pytest.approx(22.2)


async def test_a_quiet_heartbeat_ages_vessels_out_and_keeps_health_fresh(
    conn: Conn, pool: Pool
) -> None:
    await ingest(pool, position(405000123, NOW))
    assert len(await snapshot(conn)) == 1
    later = NOW + timedelta(hours=1)
    written = await store.store_entity_batch(pool, manifest_under_test(), [], later)
    assert written == 0
    assert await snapshot(conn) == []
    fetched = await scalar(
        conn, f"select fetched_at from module_health where module_id = '{MODULE}'"
    )
    assert fetched == later
    assert (
        await scalar(
            conn, f"select status::text from module_health where module_id = '{MODULE}'"
        )
        == "ok"
    )


async def test_old_fixes_are_pruned_but_a_starred_vessels_are_kept(
    conn: Conn, pool: Pool
) -> None:
    await ingest(pool, position(405000123, NOW) + b"\n" + position(477123456, NOW))
    starred = await scalar(
        conn,
        f"select id from entity where source_id = '{SOURCE}' and identifiers->>'mmsi' = '405000123'",
    )
    await conn.execute(
        "insert into watchlist_entry (entity_id) values (%s)", (starred,)
    )
    try:
        later = NOW + timedelta(hours=2)
        await ingest(pool, position(338123456, later), later)
        remaining = await scalar(
            conn,
            f"""
            select array_agg(e.identifiers->>'mmsi' order by e.identifiers->>'mmsi')
            from observation o join entity e on e.id = o.entity_id
            where o.source_id = '{SOURCE}'
            """,
        )
        assert remaining == ["338123456", "405000123"]
    finally:
        await conn.execute(
            "delete from watchlist_entry where entity_id = %s", (starred,)
        )


async def test_each_batch_notifies_listeners_once(conn: Conn, pool: Pool) -> None:
    assert TEST_DB
    async with await psycopg.AsyncConnection.connect(
        TEST_DB, autocommit=True
    ) as listener:
        await listener.execute("listen layer_updated")
        await ingest(pool, FIXTURE.read_bytes())
        notices = [n.payload async for n in _drain(listener)]
    assert notices.count(MODULE) == 1


async def _drain(listener: Conn) -> AsyncIterator[Any]:
    gen = listener.notifies(timeout=0.5)
    async for notice in gen:
        yield notice


async def test_the_same_imo_under_a_new_mmsi_is_still_the_same_vessel(
    conn: Conn, pool: Pool
) -> None:
    await ingest(pool, static(405000123, 9074729, "OLD NAME", NOW))
    later = NOW + timedelta(days=3)
    await ingest(pool, static(477123456, 9074729, "NEW NAME", later), later)
    assert (
        await scalar(conn, f"select count(*) from entity where source_id = '{SOURCE}'")
        == 1
    )
    names = await scalar(conn, f"select names from entity where source_id = '{SOURCE}'")
    assert names == ["NEW NAME", "OLD NAME"]
