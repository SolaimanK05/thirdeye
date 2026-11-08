import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from uuid import UUID

import psycopg
import pytest

from thirdeye import store
from thirdeye.ontology import Confidence, Event, Point
from thirdeye.reads import DbReader, SearchRecord, escape_like
from thirdeye.writes import DbWriter

TEST_DB = os.environ.get("THIRDEYE_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DB, reason="set THIRDEYE_TEST_DATABASE_URL to run database tests"
)

NOW = datetime(2026, 10, 14, 6, 0, tzinfo=UTC)
MODULE = "searchtest"
GIVEN = UUID("a0000000-0000-4000-8000-000000000001")
GREEN = UUID("a0000000-0000-4000-8000-000000000002")
PLANE = UUID("a0000000-0000-4000-8000-000000000003")
BARE = UUID("a0000000-0000-4000-8000-000000000004")
MISSING = UUID("a0000000-0000-4000-8000-0000000000ff")
IDS = (GIVEN, GREEN, PLANE, BARE)

type Conn = psycopg.AsyncConnection[tuple[object, ...]]


async def add_entity(
    c: Conn,
    entity_id: UUID,
    kind: str,
    names: list[str],
    identifiers: str,
    source: str,
    last_seen: datetime,
    fix: tuple[float, float] | None,
) -> None:
    await c.execute(
        """
        insert into entity (id, kind, names, identifiers, first_seen, last_seen,
                            source_id, retrieved_at)
        values (%s, %s::entity_kind, %s, %s::jsonb, %s, %s, %s, %s)
        """,
        (
            entity_id,
            kind,
            names,
            identifiers,
            last_seen - timedelta(days=1),
            last_seen,
            source,
            NOW,
        ),
    )
    if fix is not None:
        await c.execute(
            """
            insert into observation (entity_id, t, source_id, geom, confidence)
            values (%s, %s, %s, st_setsrid(st_makepoint(%s, %s), 4326),
                    'observed')
            """,
            (entity_id, last_seen, source, fix[0], fix[1]),
        )


def quake(n: int, place: str | None, magnitude: float, category: str) -> Event:
    attrs = {} if place is None else {"place": place}
    return Event(
        id=f"{MODULE}:{n}",
        module_id=MODULE,
        category=category,
        geom=Point.at(96.0 + n / 10, 21.0),
        t_start=NOW - timedelta(minutes=n),
        t_end=NOW - timedelta(minutes=n),
        severity=magnitude,
        attrs=attrs,
        source_id="usgs-earthquakes",
        retrieved_at=NOW,
        confidence=Confidence.OBSERVED,
    )


@pytest.fixture
async def conn() -> AsyncIterator[Conn]:
    assert TEST_DB
    async with await psycopg.AsyncConnection.connect(TEST_DB, autocommit=True) as c:
        await clean(c)
        await add_entity(
            c,
            GIVEN,
            "vessel",
            ["EVER GIVEN"],
            '{"mmsi": "353136000"}',
            "aisstream",
            NOW,
            (32.5, 30.0),
        )
        await add_entity(
            c,
            GREEN,
            "vessel",
            ["EVERGREEN STAR"],
            '{"mmsi": "416000001"}',
            "aisstream",
            NOW - timedelta(hours=2),
            None,
        )
        await add_entity(
            c,
            PLANE,
            "aircraft",
            ["UAL123"],
            '{"icao24": "a1b2c3"}',
            "opensky",
            NOW - timedelta(hours=1),
            (-0.5, 51.5),
        )
        await add_entity(
            c, BARE, "vessel", [], '{"imo": "9811000"}', "aisstream", NOW, None
        )
        yield c
        await clean(c)


async def clean(c: Conn) -> None:
    await c.execute("delete from entity where id = any(%s)", (list(IDS),))
    await c.execute("delete from event where module_id = %s", (MODULE,))
    await c.execute("delete from layer_snapshot where module_id = %s", (MODULE,))
    await c.execute("delete from module_health where module_id = %s", (MODULE,))


async def find(
    c: Conn,
    text: str,
    modules: list[str],
    named: list[str] | None = None,
    limit: int = 10,
) -> list[SearchRecord]:
    return await DbReader(c).search(text, modules, named or [], limit)


class TestEscaping:
    def test_wildcards_and_backslashes_are_literal(self) -> None:
        assert escape_like("50%_off\\") == "50\\%\\_off\\\\"


class TestEntitySearch:
    async def test_matches_names_case_insensitively(self, conn: Conn) -> None:
        hits = await find(conn, "ever", ["vessels"])
        assert [h.id for h in hits] == [str(GIVEN), str(GREEN)]
        assert all(h.kind == "entity" and h.category == "vessel" for h in hits)

    async def test_prefix_matches_rank_first_then_the_most_recent(
        self, conn: Conn
    ) -> None:
        hits = await find(conn, "given", ["vessels"])
        assert [h.id for h in hits] == [str(GIVEN)]
        hits = await find(conn, "e", ["vessels"])
        assert [h.id for h in hits][:2] == [str(GIVEN), str(GREEN)]

    async def test_matches_identifier_values(self, conn: Conn) -> None:
        [hit] = await find(conn, "353136", ["vessels"])
        assert hit.id == str(GIVEN)
        [plane] = await find(conn, "a1b2", ["aircraft"])
        assert plane.id == str(PLANE)
        assert plane.module_id == "aircraft"

    async def test_carries_the_latest_position_and_label(self, conn: Conn) -> None:
        [hit] = await find(conn, "given", ["vessels"])
        assert (hit.lon, hit.lat) == pytest.approx((32.5, 30.0))
        assert hit.label == "EVER GIVEN"
        assert hit.t == NOW

    async def test_entities_without_a_fix_have_no_position(self, conn: Conn) -> None:
        [hit] = await find(conn, "evergreen", ["vessels"])
        assert (hit.lon, hit.lat) == (None, None)

    async def test_a_nameless_entity_is_labelled_by_an_identifier(
        self, conn: Conn
    ) -> None:
        [hit] = await find(conn, "9811", ["vessels"])
        assert hit.id == str(BARE)
        assert hit.label == "9811000"

    async def test_only_enabled_modules_are_searched(self, conn: Conn) -> None:
        assert await find(conn, "ever", ["aircraft"]) == []
        assert await find(conn, "ever", []) == []

    async def test_wildcard_characters_are_not_wildcards(self, conn: Conn) -> None:
        assert await find(conn, "%%", ["vessels"]) == []
        assert await find(conn, "e_er", ["vessels"]) == []

    async def test_starred_entities_say_so_and_sort_first_among_equals(
        self, conn: Conn
    ) -> None:
        assert await DbWriter(conn).star(GREEN)
        hits = await find(conn, "ever", ["vessels"])
        assert {h.id: h.starred for h in hits} == {
            str(GIVEN): False,
            str(GREEN): True,
        }

    async def test_the_limit_applies(self, conn: Conn) -> None:
        assert len(await find(conn, "e", ["vessels", "aircraft"], limit=2)) == 2


class TestEventSearch:
    async def load(self, conn: Conn) -> None:
        events = [
            quake(1, "12 km SE of Mandalay, Myanmar", 5.4, "earthquake"),
            quake(2, "Gulf of Alaska", 4.1, "earthquake"),
            quake(3, "Mandalay region", 6.2, "earthquake"),
            quake(4, None, 3.0, "thermal-anomaly"),
            quake(5, None, 9.0, "quarry blast"),
        ]
        await store.write_events(conn, MODULE, events, NOW)

    async def test_matches_place_text_strongest_first(self, conn: Conn) -> None:
        await self.load(conn)
        hits = await find(conn, "mandalay", [MODULE])
        assert [h.id for h in hits] == [f"{MODULE}:3", f"{MODULE}:1"]
        assert hits[0].label == "Mandalay region"
        assert hits[0].kind == "event"
        assert hits[0].severity == pytest.approx(6.2)
        assert (hits[0].lon, hits[0].lat) == pytest.approx((96.3, 21.0))

    async def test_matches_the_category_with_dashes_as_spaces(self, conn: Conn) -> None:
        await self.load(conn)
        hits = await find(conn, "thermal anom", [MODULE])
        assert [h.id for h in hits] == [f"{MODULE}:4"]
        assert hits[0].label is None
        assert hits[0].category == "thermal-anomaly"

    async def test_a_module_name_match_returns_its_strongest_events(
        self, conn: Conn
    ) -> None:
        await self.load(conn)
        hits = await find(conn, "zzz-nothing", [MODULE], named=[MODULE], limit=3)
        assert [h.id for h in hits] == [f"{MODULE}:5", f"{MODULE}:3", f"{MODULE}:1"]

    async def test_place_matches_outrank_category_matches(self, conn: Conn) -> None:
        await self.load(conn)
        events = [quake(6, "Quake Lake", 1.0, "earthquake")]
        await store.write_events(
            conn,
            MODULE,
            [*(quake(i, None, 8.0, "earthquake") for i in (7, 8)), *events],
            NOW,
        )
        hits = await find(conn, "quake", [MODULE])
        assert hits[0].id == f"{MODULE}:6"

    async def test_only_the_current_fetch_is_searched(self, conn: Conn) -> None:
        await self.load(conn)
        later = NOW + timedelta(hours=1)
        fresh = quake(9, "Mandalay again", 2.0, "earthquake").model_copy(
            update={"retrieved_at": later}
        )
        await store.write_events(conn, MODULE, [fresh], later)
        hits = await find(conn, "mandalay", [MODULE])
        assert [h.id for h in hits] == [f"{MODULE}:9"]

    async def test_disabled_modules_are_not_searched(self, conn: Conn) -> None:
        await self.load(conn)
        assert await find(conn, "mandalay", []) == []
        assert await find(conn, "mandalay", ["earthquakes"]) == []

    async def test_entities_come_before_events_and_the_limit_is_shared(
        self, conn: Conn
    ) -> None:
        await self.load(conn)
        await add_entity(
            conn, MISSING, "vessel", ["Mandalay Queen"], "{}", "aisstream", NOW, None
        )
        try:
            hits = await find(conn, "mandalay", ["vessels", MODULE], limit=2)
            assert [h.kind for h in hits] == ["entity", "event"]
        finally:
            await conn.execute("delete from entity where id = %s", (MISSING,))


class TestWatchlist:
    async def test_star_and_list(self, conn: Conn) -> None:
        writer, reader = DbWriter(conn), DbReader(conn)
        assert await writer.star(GIVEN)
        assert await writer.star(PLANE)
        items = await reader.watchlist()
        assert [i.entity_id for i in items] == [PLANE, GIVEN]
        plane = items[0]
        assert plane.module_id == "aircraft"
        assert plane.names == ["UAL123"]
        assert (plane.lon, plane.lat) == pytest.approx((-0.5, 51.5))
        assert items[1].module_id == "vessels"

    async def test_starring_twice_keeps_one_row_and_the_first_time(
        self, conn: Conn
    ) -> None:
        writer, reader = DbWriter(conn), DbReader(conn)
        assert await writer.star(GIVEN)
        [first] = await reader.watchlist()
        assert await writer.star(GIVEN)
        [again] = await reader.watchlist()
        assert again.added_at == first.added_at

    async def test_starring_a_missing_entity_is_refused_and_leaves_nothing(
        self, conn: Conn
    ) -> None:
        assert not await DbWriter(conn).star(MISSING)
        assert await DbReader(conn).watchlist() == []

    async def test_unstar(self, conn: Conn) -> None:
        writer, reader = DbWriter(conn), DbReader(conn)
        await writer.star(GIVEN)
        await writer.unstar(GIVEN)
        await writer.unstar(GIVEN)
        await writer.unstar(MISSING)
        assert await reader.watchlist() == []

    async def test_an_entity_without_a_fix_still_lists(self, conn: Conn) -> None:
        await DbWriter(conn).star(GREEN)
        [item] = await DbReader(conn).watchlist()
        assert (item.lon, item.lat) == (None, None)

    async def test_deleting_the_entity_removes_its_star(self, conn: Conn) -> None:
        await DbWriter(conn).star(BARE)
        await conn.execute("delete from entity where id = %s", (BARE,))
        assert await DbReader(conn).watchlist() == []
