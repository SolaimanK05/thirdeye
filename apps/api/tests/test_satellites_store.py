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
from thirdeye.modules.satellites.manifest import MANIFEST as SATELLITES
from thirdeye.modules.satellites.records import normalize_entities
from thirdeye.ontology import EntityReport, ModuleManifest
from thirdeye.reads import DbReader

TEST_DB = os.environ.get("THIRDEYE_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DB, reason="set THIRDEYE_TEST_DATABASE_URL to run database tests"
)

MODULE = "sattest"
SOURCE = "sattest-feed"
FIXTURE = Path(__file__).parents[1] / "src/thirdeye/modules/satellites/fixture.json"
NOW = datetime(2026, 10, 27, 6, 0, tzinfo=UTC)

type Conn = psycopg.AsyncConnection[tuple[object, ...]]


def manifest_under_test() -> ModuleManifest:
    provenance = SATELLITES.provenance.model_copy(update={"source_id": SOURCE})
    return SATELLITES.model_copy(update={"id": MODULE, "provenance": provenance})


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


async def ingest(
    pool: Pool, at: datetime = NOW, keep: int | None = None, raw: bytes | None = None
) -> int:
    reports = reports_from(FIXTURE.read_bytes() if raw is None else raw, at)
    if keep is not None:
        reports = reports[:keep]
    return await store.store_entity_batch(pool, manifest_under_test(), reports, at)


async def scalar(c: Conn, query: str) -> Any:
    cur = await c.execute(query)
    row = await cur.fetchone()
    assert row is not None
    return row[0]


async def test_satellites_are_stored_without_any_position(
    conn: Conn, pool: Pool
) -> None:
    assert await ingest(pool) == 7
    count = await scalar(
        conn, f"select count(*) from entity where source_id = '{SOURCE}'"
    )
    assert count == 7
    assert (
        await scalar(
            conn,
            "select count(*) from observation o join entity e on "
            f"e.id = o.entity_id where e.source_id = '{SOURCE}'",
        )
        == 0
    )
    assert (
        await scalar(
            conn, f"select payload from layer_snapshot where module_id = '{MODULE}'"
        )
        == []
    )


async def test_a_download_of_satellites_is_not_reported_as_empty(
    conn: Conn, pool: Pool
) -> None:
    await ingest(pool)
    assert (
        await scalar(
            conn,
            f"select record_count from layer_snapshot where module_id = '{MODULE}'",
        )
        == 7
    )
    row = await (
        await conn.execute(
            f"select status::text, record_count from module_health where module_id = '{MODULE}'"
        )
    ).fetchone()
    assert row == ("ok", 7)


async def test_a_new_download_updates_the_same_satellites(
    conn: Conn, pool: Pool
) -> None:
    await ingest(pool)
    later = NOW + timedelta(days=1)
    await ingest(pool, later)
    assert (
        await scalar(conn, f"select count(*) from entity where source_id = '{SOURCE}'")
        == 7
    )
    first_seen, retrieved_at = await (
        await conn.execute(
            f"select min(first_seen), max(retrieved_at) from entity where source_id = '{SOURCE}'"
        )
    ).fetchone() or (None, None)
    assert first_seen == NOW
    assert retrieved_at == later


async def test_the_last_attempt_follows_successes_and_failures(
    conn: Conn, pool: Pool
) -> None:
    assert await store.read_last_attempt(pool, MODULE) is None
    await ingest(pool)
    assert await store.read_last_attempt(pool, MODULE) == store.LastAttempt(
        at=NOW, ok=True
    )
    failed_at = NOW + timedelta(hours=3)
    await store.record_failure(conn, MODULE, "HTTP 403", failed_at)
    assert await store.read_last_attempt(pool, MODULE) == store.LastAttempt(
        at=failed_at, ok=False
    )


async def test_the_elements_are_those_of_the_latest_download_only(
    conn: Conn, pool: Pool
) -> None:
    await ingest(pool)
    reader = DbReader(conn)
    first = await reader.satellite_elements(MODULE)
    assert [e.norad_id for e in first] == [
        20580,
        25544,
        33591,
        35752,
        41866,
        44713,
        270001,
    ]
    await ingest(pool, NOW + timedelta(days=1), keep=3)
    latest = await reader.satellite_elements(MODULE)
    assert len(latest) == 3
    assert (
        await scalar(conn, f"select count(*) from entity where source_id = '{SOURCE}'")
        == 7
    )


async def test_an_element_carries_the_entity_id_and_the_full_element_set(
    conn: Conn, pool: Pool
) -> None:
    await ingest(pool)
    reader = DbReader(conn)
    iss = next(
        e for e in await reader.satellite_elements(MODULE) if e.norad_id == 25544
    )
    assert iss.name == "ISS (ZARYA)"
    assert iss.omm["MEAN_MOTION"] == 15.4991
    detail = await reader.entity(iss.id)
    assert detail is not None
    assert detail.obs_t is None
    assert detail.identifiers["norad_id"] == 25544


async def test_a_satellite_can_be_found_by_name_and_by_catalogue_number(
    conn: Conn, pool: Pool
) -> None:
    await ingest(pool)
    reader = DbReader(conn)
    by_name = await reader.search("zarya", [MODULE], [], 10)
    assert [r.label for r in by_name] == ["ISS (ZARYA)"]
    assert by_name[0].lon is None
    by_number = await reader.search("270001", [MODULE], [], 10)
    assert [r.category for r in by_number] == ["satellite"]
