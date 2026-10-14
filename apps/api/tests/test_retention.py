import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import psycopg
import pytest
from pydantic import ValidationError

from thirdeye import store
from thirdeye.modules.wildfires.manifest import MANIFEST
from thirdeye.modules.wildfires.records import normalize
from thirdeye.ontology import ModuleManifest

TEST_DB = os.environ.get("THIRDEYE_TEST_DATABASE_URL")
NOW = datetime(2026, 10, 14, 9, 0, tzinfo=UTC)
HEADER = "latitude,longitude,bright_ti4,acq_date,acq_time,satellite,confidence,frp"

type Conn = psycopg.AsyncConnection[tuple[object, ...]]


class TestManifest:
    def test_wildfires_keep_at_least_what_the_map_asks_for(self) -> None:
        assert MANIFEST.retention_seconds is not None
        assert MANIFEST.viewport_lookback_seconds is not None
        assert MANIFEST.retention_seconds >= MANIFEST.viewport_lookback_seconds

    def test_keeping_less_than_the_map_asks_for_is_refused(self) -> None:
        assert MANIFEST.viewport_lookback_seconds is not None
        with pytest.raises(ValidationError, match="retention_seconds"):
            ModuleManifest.model_validate(
                MANIFEST.model_dump()
                | {"retention_seconds": MANIFEST.viewport_lookback_seconds - 1}
            )

    @pytest.mark.parametrize("seconds", [0, -5])
    def test_retention_must_be_positive(self, seconds: int) -> None:
        with pytest.raises(ValidationError):
            ModuleManifest.model_validate(
                MANIFEST.model_dump() | {"retention_seconds": seconds}
            )


pytestmark_db = pytest.mark.skipif(
    not TEST_DB, reason="set THIRDEYE_TEST_DATABASE_URL to run database tests"
)


@pytest.fixture
async def conn() -> AsyncIterator[Conn]:
    assert TEST_DB
    async with await psycopg.AsyncConnection.connect(TEST_DB, autocommit=True) as c:
        await c.execute("delete from event where module_id = 'wildfires'")
        yield c
        await c.execute("delete from event where module_id = 'wildfires'")


def body(*rows: tuple[str, str]) -> bytes:
    lines = [HEADER]
    for index, (day, time) in enumerate(rows):
        lines.append(f"{10 + index / 100},20,330,{day},{time},N,h,5")
    return ("\n".join(lines) + "\n").encode()


async def count(conn: Conn, module_id: str = "wildfires") -> int:
    cur = await conn.execute(
        "select count(*) from event where module_id = %s", (module_id,)
    )
    row = await cur.fetchone()
    assert row is not None
    return int(str(row[0]))


@pytestmark_db
class TestPrune:
    async def test_rows_older_than_the_window_are_deleted(self, conn: Conn) -> None:
        events = normalize(
            body(
                ("2026-10-14", "0700"), ("2026-10-11", "0700"), ("2026-10-05", "0700")
            ),
            NOW,
        )
        await store.write_events(conn, "wildfires", events, NOW, snapshot_rows=False)
        removed = await store.prune_events(conn, "wildfires", 4 * 86_400, NOW)
        assert removed == 1
        assert await count(conn) == 2

    async def test_the_boundary_keeps_what_is_exactly_old_enough(
        self, conn: Conn
    ) -> None:
        events = normalize(body(("2026-10-10", "0900")), NOW)
        await store.write_events(conn, "wildfires", events, NOW, snapshot_rows=False)
        assert await store.prune_events(conn, "wildfires", 4 * 86_400, NOW) == 0
        later = NOW + timedelta(minutes=1)
        assert await store.prune_events(conn, "wildfires", 4 * 86_400, later) == 1

    async def test_other_modules_are_left_alone(self, conn: Conn) -> None:
        events = normalize(body(("2026-10-01", "0700")), NOW)
        await store.write_events(conn, "wildfires", events, NOW, snapshot_rows=False)
        assert await store.prune_events(conn, "no-such-module", 60, NOW) == 0
        assert await count(conn) == 1

    async def test_the_current_layer_is_not_touched(self, conn: Conn) -> None:
        events = normalize(body(("2026-10-14", "0700"), ("2026-10-13", "0700")), NOW)
        await store.write_events(conn, "wildfires", events, NOW, snapshot_rows=False)
        assert await store.prune_events(conn, "wildfires", 4 * 86_400, NOW) == 0
        cur = await conn.execute(
            "select record_count from layer_snapshot where module_id = 'wildfires'"
        )
        assert await cur.fetchone() == (2,)
