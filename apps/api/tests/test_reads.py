import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import psycopg
import pytest

from thirdeye import store
from thirdeye.ontology import Confidence, EntityKind, Event, Point, SourceReliability
from thirdeye.reads import DbReader

TEST_DB = os.environ.get("THIRDEYE_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DB, reason="set THIRDEYE_TEST_DATABASE_URL to run database tests"
)

MODULE = "readtest"
NOW = datetime(2026, 10, 14, 6, 0, tzinfo=UTC)
ENTITY_ID = UUID("0b1e7c9a-3f4d-4c2b-8a6e-1d2f3a4b5c6d")

type Conn = psycopg.AsyncConnection[tuple[object, ...]]


def quake(n: int) -> Event:
    return Event(
        id=f"{MODULE}:{n}",
        module_id=MODULE,
        category="earthquake",
        geom=Point.at(93.31, 22.41),
        t_start=NOW - timedelta(minutes=n),
        t_end=NOW - timedelta(minutes=n),
        severity=5.0 + n / 10,
        attrs={"depth_km": 12.5, "place": "Myanmar"},
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
        await c.execute("delete from entity where id = %s", (ENTITY_ID,))


async def test_event_with_source(conn: Conn) -> None:
    await store.write_events(conn, MODULE, [quake(1)], NOW)
    record = await DbReader(conn).event(f"{MODULE}:1")
    assert record is not None
    assert record.geometry == {"type": "Point", "coordinates": [93.31, 22.41]}
    assert (record.lon, record.lat) == pytest.approx((93.31, 22.41))
    assert record.severity == pytest.approx(5.1)
    assert record.attrs == {"depth_km": 12.5, "place": "Myanmar"}
    assert record.confidence is Confidence.OBSERVED
    assert record.source_id == "usgs-earthquakes"
    assert record.source_module_id == "earthquakes"
    assert record.source_reliability is SourceReliability.PRIMARY
    assert record.retrieved_at == NOW


async def test_missing_event(conn: Conn) -> None:
    assert await DbReader(conn).event(f"{MODULE}:404") is None


async def test_snapshot_and_health(conn: Conn) -> None:
    await store.write_events(conn, MODULE, [quake(1), quake(2)], NOW)
    reader = DbReader(conn)
    snapshot = await reader.snapshot(MODULE)
    assert snapshot is not None
    assert snapshot.fetched_at == NOW
    assert [row["id"] for row in snapshot.payload] == [f"{MODULE}:1", f"{MODULE}:2"]
    health = (await reader.health())[MODULE]
    assert health.status == "ok"
    assert health.record_count == 2
    assert health.reason is None
    assert await reader.snapshot("no-such-module") is None


async def test_entity_with_latest_observation(conn: Conn) -> None:
    await conn.execute(
        """
        insert into entity (id, kind, names, identifiers, first_seen, last_seen,
                            source_id, retrieved_at)
        values (%s, 'vessel', array['MV Read Test'], '{"mmsi": "123456789"}',
                %s, %s, 'aisstream', %s)
        """,
        (ENTITY_ID, NOW - timedelta(days=1), NOW, NOW),
    )
    for minutes, lon in ((30, 91.0), (5, 91.5)):
        await conn.execute(
            """
            insert into observation (entity_id, t, source_id, geom, sog, cog,
                                     confidence)
            values (%s, %s, 'aisstream', st_setsrid(st_makepoint(%s, 22.3), 4326),
                    12.5, 180, 'observed')
            """,
            (ENTITY_ID, NOW - timedelta(minutes=minutes), lon),
        )
    record = await DbReader(conn).entity(ENTITY_ID)
    assert record is not None
    assert record.kind is EntityKind.VESSEL
    assert record.names == ["MV Read Test"]
    assert record.identifiers == {"mmsi": "123456789"}
    assert record.obs_t == NOW - timedelta(minutes=5)
    assert record.obs_lon == pytest.approx(91.5)
    assert record.obs_confidence is Confidence.OBSERVED
    assert record.source_module_id == "vessels"


async def test_entity_without_observations(conn: Conn) -> None:
    await conn.execute(
        """
        insert into entity (id, kind, first_seen, last_seen, source_id, retrieved_at)
        values (%s, 'facility', %s, %s, 'nga-wpi', %s)
        """,
        (ENTITY_ID, NOW, NOW, NOW),
    )
    record = await DbReader(conn).entity(ENTITY_ID)
    assert record is not None
    assert record.obs_t is None
    assert record.obs_confidence is None


async def test_fixes_come_back_oldest_first_and_keep_only_the_newest(
    conn: Conn,
) -> None:
    await conn.execute(
        """
        insert into entity (id, kind, first_seen, last_seen, source_id, retrieved_at)
        values (%s, 'vessel', %s, %s, 'aisstream', %s)
        """,
        (ENTITY_ID, NOW - timedelta(days=1), NOW, NOW),
    )
    for minutes in (40, 30, 20, 10, 0):
        await conn.execute(
            """
            insert into observation (entity_id, t, source_id, geom, sog, cog, heading,
                                     confidence)
            values (%s, %s, 'aisstream', st_setsrid(st_makepoint(91.0, 22.3), 4326),
                    %s, 180, 181, 'observed')
            """,
            (ENTITY_ID, NOW - timedelta(minutes=minutes), 40 - minutes),
        )
    reader = DbReader(conn)
    everything = await reader.fixes(ENTITY_ID, 100)
    assert [f.sog for f in everything] == [0, 10, 20, 30, 40]
    assert everything[0].heading == 181
    assert everything[0].confidence is Confidence.OBSERVED
    assert everything[0].lon == pytest.approx(91.0)
    newest = await reader.fixes(ENTITY_ID, 2)
    assert [f.sog for f in newest] == [30, 40]
    assert await reader.fixes(uuid4(), 5) == []


async def test_the_latest_observation_includes_the_heading(conn: Conn) -> None:
    await conn.execute(
        """
        insert into entity (id, kind, first_seen, last_seen, source_id, retrieved_at)
        values (%s, 'vessel', %s, %s, 'aisstream', %s)
        """,
        (ENTITY_ID, NOW, NOW, NOW),
    )
    await conn.execute(
        """
        insert into observation (entity_id, t, source_id, geom, heading, confidence)
        values (%s, %s, 'aisstream', st_setsrid(st_makepoint(91.0, 22.3), 4326),
                77, 'observed')
        """,
        (ENTITY_ID, NOW),
    )
    record = await DbReader(conn).entity(ENTITY_ID)
    assert record is not None
    assert record.obs_heading == 77
