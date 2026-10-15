import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import psycopg
import pytest
from psycopg import sql

from thirdeye import store
from thirdeye.ontology import (
    Confidence,
    Entity,
    EntityKind,
    EntityReport,
    Fix,
    Identifiers,
    Point,
)

TEST_DB = os.environ.get("THIRDEYE_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DB, reason="set THIRDEYE_TEST_DATABASE_URL to run database tests"
)

MODULE = "entitytest"
SOURCE = "entitytest-feed"
NOW = datetime(2026, 10, 15, 12, 0, tzinfo=UTC)

type Conn = psycopg.AsyncConnection[tuple[object, ...]]


def report(
    names: tuple[str, ...] = (),
    *,
    kind: EntityKind = EntityKind.FACILITY,
    at: datetime = NOW,
    lon: float | None = 90.0,
    lat: float = 23.0,
    attrs: dict[str, Any] | None = None,
    **identifiers: str | int,
) -> EntityReport:
    return EntityReport(
        entity=Entity(
            kind=kind,
            names=names,
            identifiers=Identifiers.model_validate(identifiers),
            attrs=attrs or {},
            first_seen=at,
            last_seen=at,
            source_id=SOURCE,
            retrieved_at=at,
        ),
        fix=(
            None
            if lon is None
            else Fix(
                t=at,
                geom=Point.at(lon, lat),
                sog=4.5,
                cog=90.0,
                heading=88.0,
                confidence=Confidence.REPORTED,
            )
        ),
    )


@pytest.fixture
async def conn() -> AsyncIterator[Conn]:
    assert TEST_DB
    async with await psycopg.AsyncConnection.connect(TEST_DB, autocommit=True) as c:
        await clean(c)
        await c.execute(
            """
            insert into source (id, module_id, url, licence, reliability)
            values (%s, %s, 'http://localhost/test', 'test', 'primary')
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


async def write(
    c: Conn,
    reports: list[EntityReport],
    at: datetime = NOW,
    *,
    latest_only: bool = True,
    window: int | None = None,
) -> int:
    return await store.write_entities(
        c,
        MODULE,
        SOURCE,
        reports,
        at,
        latest_only=latest_only,
        snapshot_window_seconds=window,
    )


async def scalar(c: Conn, query: str, *params: object) -> Any:
    cur = await c.execute(query, params)
    row = await cur.fetchone()
    assert row is not None
    return row[0]


async def count_entities(c: Conn) -> int:
    return int(
        await scalar(c, "select count(*) from entity where source_id = %s", SOURCE)
    )


async def count_fixes(c: Conn) -> int:
    return int(
        await scalar(c, "select count(*) from observation where source_id = %s", SOURCE)
    )


async def snapshot(c: Conn) -> list[dict[str, Any]]:
    payload = await scalar(
        c, "select payload from layer_snapshot where module_id = %s", MODULE
    )
    assert isinstance(payload, list)
    return payload


async def entity_id(c: Conn, key: str, value: str) -> UUID:
    found = await scalar(
        c,
        f"select id from entity where source_id = %s and identifiers ->> '{key}' = %s",
        SOURCE,
        value,
    )
    assert isinstance(found, UUID)
    return found


async def test_new_reports_become_entities_with_one_fix_each(conn: Conn) -> None:
    written = await write(
        conn, [report(("Alpha",), wpi="1"), report(("Beta",), wpi="2", lon=91.0)]
    )
    assert written == 2
    assert await count_entities(conn) == 2
    assert await count_fixes(conn) == 2


async def test_writing_the_same_reports_twice_changes_nothing(conn: Conn) -> None:
    reports = [report(("Alpha",), wpi="1"), report(("Beta",), wpi="2")]
    await write(conn, reports)
    first = {await entity_id(conn, "wpi", "1"), await entity_id(conn, "wpi", "2")}
    await write(conn, reports)
    assert await count_entities(conn) == 2
    assert await count_fixes(conn) == 2
    assert {
        await entity_id(conn, "wpi", "1"),
        await entity_id(conn, "wpi", "2"),
    } == first


async def test_a_static_module_keeps_one_fix_per_entity_across_imports(
    conn: Conn,
) -> None:
    await write(conn, [report(("Alpha",), wpi="1", lon=90.0)], NOW)
    later = NOW + timedelta(days=30)
    await write(conn, [report(("Alpha",), wpi="1", lon=91.0, at=later)], later)
    assert await count_fixes(conn) == 1
    lon = await scalar(
        conn, "select st_x(geom) from observation where source_id = %s", SOURCE
    )
    assert lon == pytest.approx(91.0)


async def test_a_reimport_keeps_first_seen_and_moves_last_seen(conn: Conn) -> None:
    await write(conn, [report(("Alpha",), wpi="1")], NOW)
    later = NOW + timedelta(days=30)
    await write(conn, [report(("Alpha",), wpi="1", at=later)], later)
    cur = await conn.execute(
        "select first_seen, last_seen, retrieved_at from entity where source_id = %s",
        (SOURCE,),
    )
    assert await cur.fetchone() == (NOW, later, later)


async def test_names_are_merged_newest_first_without_repeats(conn: Conn) -> None:
    await write(conn, [report(("Alpha", "Old Alpha"), wpi="1")])
    await write(conn, [report(("alpha", "New Alpha"), wpi="1")])
    names = await scalar(conn, "select names from entity where source_id = %s", SOURCE)
    assert names == ["alpha", "New Alpha", "Old Alpha"]


async def test_a_strong_key_never_changes_once_set(conn: Conn) -> None:
    await write(conn, [report(kind=EntityKind.VESSEL, imo="9000001", mmsi="111")])
    await write(
        conn,
        [report(kind=EntityKind.VESSEL, imo="9000001", mmsi="222")],
    )
    cur = await conn.execute(
        "select identifiers from entity where source_id = %s", (SOURCE,)
    )
    rows = await cur.fetchall()
    assert len(rows) == 1
    assert rows[0][0] == {"imo": "9000001", "mmsi": "222"}


async def test_attrs_are_merged_with_the_newest_value_winning(conn: Conn) -> None:
    await write(conn, [report(wpi="1", attrs={"a": 1, "b": 1})])
    await write(conn, [report(wpi="1", attrs={"b": 2, "c": 3})])
    attrs = await scalar(conn, "select attrs from entity where source_id = %s", SOURCE)
    assert attrs == {"a": 1, "b": 2, "c": 3}


async def test_a_weak_key_joins_the_entity_seen_in_the_last_day(conn: Conn) -> None:
    await write(conn, [report(kind=EntityKind.VESSEL, mmsi="405000123")], NOW)
    later = NOW + timedelta(hours=20)
    await write(
        conn,
        [report(kind=EntityKind.VESSEL, mmsi="405000123", imo="9000001", at=later)],
        later,
        latest_only=False,
    )
    assert await count_entities(conn) == 1
    identifiers = await scalar(
        conn, "select identifiers from entity where source_id = %s", SOURCE
    )
    assert identifiers == {"imo": "9000001", "mmsi": "405000123"}


async def test_a_weak_key_after_a_day_starts_a_new_entity(conn: Conn) -> None:
    await write(conn, [report(kind=EntityKind.VESSEL, mmsi="405000123")], NOW)
    later = NOW + timedelta(hours=25)
    await write(
        conn,
        [report(kind=EntityKind.VESSEL, mmsi="405000123", at=later)],
        later,
        latest_only=False,
    )
    assert await count_entities(conn) == 2


async def test_one_mmsi_with_two_imos_stays_two_entities(conn: Conn) -> None:
    await write(
        conn,
        [
            report(kind=EntityKind.VESSEL, mmsi="405000123", imo="9000001"),
            report(kind=EntityKind.VESSEL, mmsi="405000123", imo="9000002", lon=91.0),
        ],
    )
    assert await count_entities(conn) == 2
    later = NOW + timedelta(minutes=5)
    await write(
        conn,
        [report(kind=EntityKind.VESSEL, mmsi="405000123", imo="9000002", at=later)],
        later,
        latest_only=False,
    )
    assert await count_entities(conn) == 2


async def test_a_numeric_norad_id_is_found_again(conn: Conn) -> None:
    one = report(kind=EntityKind.SATELLITE, norad_id=25544, lon=None)
    await write(conn, [one])
    await write(conn, [one])
    assert await count_entities(conn) == 1


async def test_a_report_without_a_fix_makes_an_entity_and_no_observation(
    conn: Conn,
) -> None:
    written = await write(conn, [report(("Alpha",), wpi="1", lon=None)])
    assert await count_entities(conn) == 1
    assert await count_fixes(conn) == 0
    assert written == 0


async def test_the_snapshot_is_built_from_the_database(conn: Conn) -> None:
    await write(
        conn,
        [
            report(
                ("Alpha",),
                wpi="1",
                attrs={"harbor_size": "L", "country": "Nowhere"},
            )
        ],
    )
    [row] = await snapshot(conn)
    assert row["name"] == "Alpha"
    assert row["kind"] == "facility"
    assert (row["lon"], row["lat"]) == (90.0, 23.0)
    assert row["sog"] == pytest.approx(4.5)
    assert row["heading"] == pytest.approx(88.0)
    assert row["confidence"] == "reported"
    assert row["attrs"] == {"harbor_size": "L"}
    assert row["t"] == NOW.isoformat()
    assert UUID(row["id"])


async def test_an_entity_without_names_is_labelled_by_an_identifier(
    conn: Conn,
) -> None:
    await write(conn, [report(wpi="777")])
    [row] = await snapshot(conn)
    assert row["name"] == "777"


async def test_a_partial_batch_still_leaves_the_full_current_state(
    conn: Conn,
) -> None:
    await write(
        conn,
        [
            report(kind=EntityKind.VESSEL, mmsi="1", at=NOW),
            report(kind=EntityKind.VESSEL, mmsi="2", at=NOW, lon=91.0),
        ],
        NOW,
        latest_only=False,
        window=600,
    )
    later = NOW + timedelta(minutes=2)
    written = await write(
        conn,
        [report(kind=EntityKind.VESSEL, mmsi="1", at=later, lon=95.0)],
        later,
        latest_only=False,
        window=600,
    )
    assert written == 2
    rows = {row["lon"] for row in await snapshot(conn)}
    assert rows == {95.0, 91.0}
    record_count = await scalar(
        conn, "select record_count from module_health where module_id = %s", MODULE
    )
    assert record_count == 2


async def test_the_snapshot_shows_each_entity_once_at_its_latest_fix(
    conn: Conn,
) -> None:
    for minutes, lon in ((0, 90.0), (1, 91.0), (2, 92.0)):
        at = NOW + timedelta(minutes=minutes)
        await write(
            conn,
            [report(kind=EntityKind.VESSEL, mmsi="1", at=at, lon=lon)],
            at,
            latest_only=False,
            window=600,
        )
    assert await count_fixes(conn) == 3
    [row] = await snapshot(conn)
    assert row["lon"] == 92.0


async def test_entities_outside_the_window_leave_the_snapshot(conn: Conn) -> None:
    await write(
        conn,
        [report(kind=EntityKind.VESSEL, mmsi="1", at=NOW)],
        NOW,
        latest_only=False,
        window=600,
    )
    later = NOW + timedelta(minutes=30)
    await write(
        conn,
        [report(kind=EntityKind.VESSEL, mmsi="2", at=later, lon=91.0)],
        later,
        latest_only=False,
        window=600,
    )
    rows = await snapshot(conn)
    assert [row["lon"] for row in rows] == [91.0]
    assert await count_entities(conn) == 2


async def test_a_static_snapshot_has_no_window(conn: Conn) -> None:
    await write(conn, [report(("Alpha",), wpi="1")], NOW - timedelta(days=900))
    await write(conn, [report(("Beta",), wpi="2")], NOW)
    assert len(await snapshot(conn)) == 2


async def test_a_write_updates_health_and_sends_notify(conn: Conn) -> None:
    assert TEST_DB
    async with await psycopg.AsyncConnection.connect(
        TEST_DB, autocommit=True
    ) as listener:
        await listener.execute("listen layer_updated")
        await write(conn, [report(("Alpha",), wpi="1")])
        payloads = [n.payload async for n in listener.notifies(timeout=5, stop_after=1)]
    assert payloads == [MODULE]
    cur = await conn.execute(
        "select status::text, record_count, reason from module_health "
        "where module_id = %s",
        (MODULE,),
    )
    assert await cur.fetchone() == ("ok", 1, None)


async def test_a_failed_write_leaves_nothing_behind(conn: Conn) -> None:
    good = report(("Alpha",), wpi="1")
    broken = report(("Beta",), wpi="2")
    broken = broken.model_copy(
        update={
            "entity": broken.entity.model_copy(update={"source_id": "no-such-source"})
        }
    )
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        await write(conn, [good, broken])
    assert await count_entities(conn) == 0
    assert await count_fixes(conn) == 0


async def prune(conn: Conn, keep: int, now: datetime) -> int:
    return await store.prune_observations(conn, SOURCE, keep, now)


async def test_old_fixes_are_pruned_and_new_ones_kept(conn: Conn) -> None:
    for minutes in (0, 30, 60, 90):
        at = NOW + timedelta(minutes=minutes)
        await write(
            conn,
            [report(kind=EntityKind.VESSEL, mmsi="1", at=at)],
            at,
            latest_only=False,
        )
    removed = await prune(conn, 3000, NOW + timedelta(minutes=90))
    assert removed == 2
    assert await count_fixes(conn) == 2


async def test_a_starred_entitys_fixes_survive_pruning(conn: Conn) -> None:
    await write(
        conn,
        [
            report(kind=EntityKind.VESSEL, mmsi="1", at=NOW),
            report(kind=EntityKind.VESSEL, mmsi="2", at=NOW, lon=91.0),
        ],
        NOW,
        latest_only=False,
    )
    starred = await entity_id(conn, "mmsi", "1")
    await conn.execute(
        "insert into watchlist_entry (entity_id) values (%s)", (starred,)
    )
    removed = await prune(conn, 3600, NOW + timedelta(days=2))
    assert removed == 1
    kept = await scalar(
        conn, "select entity_id from observation where source_id = %s", SOURCE
    )
    assert kept == starred


async def test_pruning_works_through_more_than_one_batch(
    conn: Conn, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(store, "PRUNE_BATCH", 2)
    for minutes in range(5):
        at = NOW + timedelta(minutes=minutes)
        await write(
            conn,
            [report(kind=EntityKind.VESSEL, mmsi="1", at=at)],
            at,
            latest_only=False,
        )
    removed = await prune(conn, 60, NOW + timedelta(days=1))
    assert removed == 5
    assert await count_fixes(conn) == 0


async def test_pruning_leaves_other_sources_alone(conn: Conn) -> None:
    await write(
        conn, [report(kind=EntityKind.VESSEL, mmsi="1", at=NOW)], NOW, latest_only=False
    )
    removed = await store.prune_observations(
        conn, "no-such-source", 60, NOW + timedelta(days=1)
    )
    assert removed == 0
    assert await count_fixes(conn) == 1


async def test_the_candidate_lookup_uses_the_key_indexes(conn: Conn) -> None:
    await conn.execute(
        """
        insert into entity (kind, names, identifiers, first_seen, last_seen,
                            source_id, retrieved_at)
        select
            (array['vessel', 'aircraft'])[1 + n %% 2]::entity_kind, '{}',
            jsonb_build_object('imo', 9000000 + n, 'mmsi', 100000000 + n,
                               'icao24', to_hex(n)),
            %(at)s, %(at)s, %(source)s, %(at)s
        from generate_series(1, 6000) n
        """,
        {"at": NOW, "source": SOURCE},
    )
    await conn.execute("analyze entity")
    reports = [
        report(kind=EntityKind.VESSEL, imo="9000010", mmsi="100000010"),
        report(kind=EntityKind.AIRCRAFT, icao24="1f4"),
    ]
    keys = store.lookup_keys(reports)
    query = sql.SQL("explain ") + store.candidate_query(keys)
    cur = await conn.execute(query, {"kinds": ["vessel", "aircraft"], **keys})
    plan = "\n".join(str(row[0]) for row in await cur.fetchall())
    for index in ("entity_imo", "entity_mmsi", "entity_icao24"):
        assert index in plan, plan
    assert "Seq Scan" not in plan, plan


async def test_the_weak_key_window_index_exists(conn: Conn) -> None:
    found = await scalar(
        conn,
        "select count(*) from pg_indexes where indexname = 'entity_kind_last_seen'",
    )
    assert found == 1


async def test_a_heading_outside_a_circle_is_refused_by_the_database(
    conn: Conn,
) -> None:
    await write(conn, [report(wpi="1")])
    with pytest.raises(psycopg.errors.CheckViolation):
        await conn.execute(
            "update observation set heading = 360 where source_id = %s", (SOURCE,)
        )
