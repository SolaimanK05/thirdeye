import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from uuid import UUID

import psycopg
import pytest
from pydantic import ValidationError

from thirdeye import retention
from thirdeye.config import Settings
from thirdeye.retention import apply_retention, run_retention, seconds_until_hour

TEST_DB = os.environ.get("THIRDEYE_TEST_DATABASE_URL")
NOW = datetime(2026, 11, 5, 12, 0, tzinfo=UTC)
URL = "postgresql://test:test@127.0.0.1:1/test"
STARRED = UUID("00000000-0000-4000-8000-0000000000a1")
PLAIN = UUID("00000000-0000-4000-8000-0000000000a2")

type Conn = psycopg.AsyncConnection[tuple[object, ...]]


def make(**changes: object) -> Settings:
    return Settings(database_url=URL, _env_file=None, **changes)  # type: ignore[arg-type]


class TestSettings:
    def test_defaults_keep_a_week_of_events_and_25_hours_of_starred_fixes(self) -> None:
        settings = make()
        assert settings.retention_event_days == 7
        assert settings.retention_starred_hours == 25
        assert settings.retention_hour_utc == 3

    @pytest.mark.parametrize(
        "changes",
        [
            {"retention_event_days": 0},
            {"retention_starred_hours": 0},
            {"retention_hour_utc": 24},
            {"retention_hour_utc": -1},
        ],
    )
    def test_nonsense_values_are_refused(self, changes: dict[str, int]) -> None:
        with pytest.raises(ValidationError):
            make(**changes)


class TestSecondsUntilHour:
    def test_later_today(self) -> None:
        assert seconds_until_hour(NOW, 14) == 2 * 3600

    def test_tomorrow_when_the_hour_has_passed(self) -> None:
        assert seconds_until_hour(NOW, 3) == 15 * 3600

    def test_exactly_on_the_hour_waits_a_full_day(self) -> None:
        assert seconds_until_hour(NOW, 12) == 24 * 3600


class FakePool:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.used = 0

    @asynccontextmanager
    async def connection(self) -> AsyncIterator[object]:
        self.used += 1
        if self.fail:
            raise OSError("database is down")
        yield object()


class TestRunRetention:
    async def test_a_failed_night_is_logged_and_the_loop_goes_on(self) -> None:
        pool = FakePool(fail=True)
        sleeps: list[float] = []

        async def sleep(seconds: float) -> None:
            sleeps.append(seconds)
            if len(sleeps) == 2:
                raise StopAsyncIteration

        with pytest.raises(StopAsyncIteration):
            await run_retention(
                pool,  # type: ignore[arg-type]
                make(),
                (),
                sleep=sleep,
                clock=lambda: NOW,
            )
        assert pool.used == 2
        assert sleeps == [15 * 3600, 15 * 3600]

    async def test_forever_false_runs_once(self) -> None:
        pool = FakePool(fail=True)
        await run_retention(
            pool,  # type: ignore[arg-type]
            make(),
            (),
            clock=lambda: NOW,
            forever=False,
        )
        assert pool.used == 1

    def test_the_batch_is_big_enough_to_be_efficient_and_small_enough_to_be_quick(
        self,
    ) -> None:
        assert 1000 <= retention.BATCH <= 10_000


db = pytest.mark.skipif(
    not TEST_DB, reason="set THIRDEYE_TEST_DATABASE_URL to run database tests"
)


@pytest.fixture
async def conn() -> AsyncIterator[Conn]:
    assert TEST_DB
    async with await psycopg.AsyncConnection.connect(TEST_DB, autocommit=True) as c:
        await clean(c)
        yield c
        await clean(c)


async def clean(c: Conn) -> None:
    await c.execute("delete from event where module_id like 'retentiontest%'")
    await c.execute("delete from entity where id = any(%s)", ([STARRED, PLAIN],))


async def seed_entities(c: Conn) -> None:
    for entity in (STARRED, PLAIN):
        await c.execute(
            """
            insert into entity (id, kind, first_seen, last_seen, source_id,
                                retrieved_at)
            values (%s, 'vessel', %s, %s, 'aisstream', %s)
            """,
            (entity, NOW - timedelta(days=3), NOW, NOW),
        )
    await c.execute("insert into watchlist_entry (entity_id) values (%s)", (STARRED,))


async def seed_fixes(c: Conn, entity: UUID, *, old: int, recent: int) -> None:
    await c.execute(
        """
        insert into observation (entity_id, t, source_id, geom, confidence)
        select %(entity)s, %(at)s - make_interval(secs => g), 'aisstream',
               st_setsrid(st_makepoint(90, 20), 4326), 'observed'
        from generate_series(%(first)s::int, %(last)s::int) g
        """,
        {
            "entity": entity,
            "at": NOW - timedelta(hours=26),
            "first": 1,
            "last": old,
        },
    )
    await c.execute(
        """
        insert into observation (entity_id, t, source_id, geom, confidence)
        select %(entity)s, %(at)s - make_interval(secs => g), 'aisstream',
               st_setsrid(st_makepoint(90, 20), 4326), 'observed'
        from generate_series(1, %(count)s::int) g
        """,
        {"entity": entity, "at": NOW - timedelta(hours=1), "count": recent},
    )


async def seed_events(c: Conn, module: str, *, old: int, recent: int) -> None:
    await c.execute(
        """
        insert into event (id, module_id, category, geom, t_start, source_id,
                           retrieved_at, confidence)
        select %(module)s || ':' || g || ':' || %(tag)s, %(module)s, 'test',
               st_setsrid(st_makepoint(90, 20), 4326), %(at)s - make_interval(secs => g),
               'aisstream', %(now)s, 'observed'
        from generate_series(1, %(count)s::int) g
        """,
        {
            "module": module,
            "tag": "old",
            "at": NOW - timedelta(days=8),
            "now": NOW,
            "count": old,
        },
    )
    await c.execute(
        """
        insert into event (id, module_id, category, geom, t_start, source_id,
                           retrieved_at, confidence)
        select %(module)s || ':' || g || ':new', %(module)s, 'test',
               st_setsrid(st_makepoint(90, 20), 4326), %(at)s - make_interval(secs => g),
               'aisstream', %(now)s, 'observed'
        from generate_series(1, %(count)s::int) g
        """,
        {"module": module, "at": NOW - timedelta(days=1), "now": NOW, "count": recent},
    )


async def count(c: Conn, query: str, *params: object) -> int:
    cur = await c.execute(query, params)
    row = await cur.fetchone()
    assert row is not None
    value = row[0]
    assert isinstance(value, int)
    return value


@db
async def test_old_events_go_in_batches_and_recent_ones_stay(conn: Conn) -> None:
    await seed_events(conn, "retentiontest", old=12_000, recent=30)
    removed = await apply_retention(conn, make(), NOW)
    assert removed.events == 12_000
    left = await count(
        conn, "select count(*) from event where module_id = 'retentiontest'"
    )
    assert left == 30


@db
async def test_a_module_with_its_own_retention_is_left_alone(conn: Conn) -> None:
    await seed_events(conn, "retentiontest-own", old=40, recent=3)
    removed = await apply_retention(conn, make(), NOW, ["retentiontest-own"])
    assert removed.events == 0
    left = await count(
        conn, "select count(*) from event where module_id = 'retentiontest-own'"
    )
    assert left == 43


@db
async def test_old_fixes_of_starred_entities_go_and_recent_ones_stay(
    conn: Conn,
) -> None:
    await seed_entities(conn)
    await seed_fixes(conn, STARRED, old=11_000, recent=50)
    removed = await apply_retention(conn, make(), NOW)
    assert removed.starred_fixes == 11_000
    left = await count(
        conn, "select count(*) from observation where entity_id = %s", STARRED
    )
    assert left == 50


@db
async def test_fixes_of_unstarred_entities_are_not_this_jobs_business(
    conn: Conn,
) -> None:
    await seed_entities(conn)
    await seed_fixes(conn, PLAIN, old=20, recent=5)
    removed = await apply_retention(conn, make(), NOW)
    assert removed.starred_fixes == 0
    left = await count(
        conn, "select count(*) from observation where entity_id = %s", PLAIN
    )
    assert left == 25


@db
async def test_the_keep_times_come_from_settings(conn: Conn) -> None:
    await seed_entities(conn)
    await seed_fixes(conn, STARRED, old=10, recent=10)
    removed = await apply_retention(conn, make(retention_starred_hours=48), NOW)
    assert removed.starred_fixes == 0
    removed = await apply_retention(conn, make(retention_starred_hours=1), NOW)
    assert removed.starred_fixes == 20
