import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import psycopg
import pytest

from thirdeye import store
from thirdeye.modules.wildfires.records import normalize
from thirdeye.reads import DbReader, Viewport

TEST_DB = os.environ.get("THIRDEYE_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DB, reason="set THIRDEYE_TEST_DATABASE_URL to run database tests"
)

HEADER = "latitude,longitude,bright_ti4,acq_date,acq_time,satellite,confidence,frp"
FETCHED = datetime(2026, 10, 14, 9, 0, tzinfo=UTC)
LOOKBACK = 3 * 86_400

type Conn = psycopg.AsyncConnection[tuple[object, ...]]


def csv(*rows: tuple[float, float, float | None, str]) -> bytes:
    lines = [HEADER]
    for lat, lon, frp, day in rows:
        power = "" if frp is None else str(frp)
        lines.append(f"{lat},{lon},330.0,{day},0700,N,n,{power}")
    return ("\n".join(lines) + "\n").encode()


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


async def load(
    c: Conn, body: bytes, at: datetime = FETCHED, *, snapshot_rows: bool = False
) -> None:
    await store.write_events(
        c, "wildfires", normalize(body, at), at, snapshot_rows=snapshot_rows
    )


async def window(c: Conn, viewport: Viewport) -> tuple[list[str], int | None]:
    record = await DbReader(c).window("wildfires", LOOKBACK, viewport)
    if record is None:
        return [], None
    return [
        str(row["id"]).removeprefix("wildfires:n:") for row in record.rows
    ], record.matched


BODY = csv(
    (22.0, 90.0, 4.0, "2026-10-14"),
    (23.0, 91.0, 40.0, "2026-10-14"),
    (-10.0, 175.0, 9.0, "2026-10-14"),
    (-12.0, -175.0, 12.0, "2026-10-14"),
    (-5.0, -60.0, None, "2026-10-14"),
    (5.0, 20.0, 1.0, "2026-10-13"),
)


async def places(c: Conn, viewport: Viewport) -> list[tuple[float, float]]:
    record = await DbReader(c).window("wildfires", LOOKBACK, viewport)
    assert record is not None
    return [(row["lat"], row["lon"]) for row in record.rows]  # type: ignore[misc]


async def test_the_world_returns_everything_strongest_first(conn: Conn) -> None:
    await load(conn, BODY)
    world = Viewport(-180, -90, 180, 90)
    assert await places(conn, world) == [
        (23.0, 91.0),
        (-12.0, -175.0),
        (-10.0, 175.0),
        (22.0, 90.0),
        (5.0, 20.0),
        (-5.0, -60.0),
    ]


async def test_a_box_keeps_only_what_is_inside(conn: Conn) -> None:
    await load(conn, BODY)
    assert await places(conn, Viewport(80, 10, 100, 30)) == [
        (23.0, 91.0),
        (22.0, 90.0),
    ]


async def test_a_box_across_the_antimeridian_finds_both_sides(conn: Conn) -> None:
    await load(conn, BODY)
    assert await places(conn, Viewport(170, -20, -170, 0)) == [
        (-12.0, -175.0),
        (-10.0, 175.0),
    ]


async def test_the_cap_keeps_the_strongest_and_reports_the_rest(conn: Conn) -> None:
    await load(conn, BODY)
    record = await DbReader(conn).window(
        "wildfires", LOOKBACK, Viewport(-180, -90, 180, 90, 2)
    )
    assert record is not None
    assert [row["severity"] for row in record.rows] == [40.0, 12.0]
    assert record.matched == 6


async def test_rows_carry_what_the_map_and_panel_need(conn: Conn) -> None:
    await load(conn, BODY)
    record = await DbReader(conn).window(
        "wildfires", LOOKBACK, Viewport(80, 10, 100, 30, 1)
    )
    assert record is not None
    [row] = record.rows
    assert row["id"] == "wildfires:n:20261014T0700:23.000:91.000"
    assert row["category"] == "thermal-anomaly"
    assert (row["lon"], row["lat"]) == (91.0, 23.0)
    assert row["t_start"] == "2026-10-14T07:00:00+00:00"
    assert row["confidence"] == "derived"
    assert row["severity"] == 40.0
    assert isinstance(row["attrs"], dict)
    assert row["attrs"]["frp_mw"] == 40.0
    assert record.fetched_at == FETCHED


async def test_detections_without_power_sort_last(conn: Conn) -> None:
    await load(conn, BODY)
    record = await DbReader(conn).window(
        "wildfires", LOOKBACK, Viewport(-180, -90, 180, 90)
    )
    assert record is not None
    assert record.rows[-1]["severity"] is None


async def test_only_the_latest_fetch_is_served(conn: Conn) -> None:
    await load(conn, BODY)
    later = FETCHED + timedelta(hours=3)
    await load(conn, csv((22.0, 90.0, 4.0, "2026-10-14")), later)
    record = await DbReader(conn).window(
        "wildfires", LOOKBACK, Viewport(-180, -90, 180, 90)
    )
    assert record is not None
    assert record.matched == 1
    assert record.fetched_at == later


async def test_events_older_than_the_lookback_are_left_out(conn: Conn) -> None:
    await load(
        conn,
        csv((22.0, 90.0, 4.0, "2026-10-14"), (23.0, 91.0, 5.0, "2026-10-09")),
    )
    assert await window(conn, Viewport(-180, -90, 180, 90)) == (
        ["20261014T0700:22.000:90.000"],
        1,
    )


async def test_an_empty_box_still_reports_when_the_data_was_fetched(
    conn: Conn,
) -> None:
    await load(conn, BODY)
    record = await DbReader(conn).window("wildfires", LOOKBACK, Viewport(0, 60, 10, 70))
    assert record is not None
    assert record.rows == []
    assert record.matched == 0
    assert record.fetched_at == FETCHED


async def test_nothing_fetched_yet_is_none(conn: Conn) -> None:
    assert (
        await DbReader(conn).window("wildfires", LOOKBACK, Viewport(0, 0, 1, 1)) is None
    )


async def test_the_snapshot_keeps_the_count_but_not_the_rows(conn: Conn) -> None:
    await load(conn, BODY)
    cur = await conn.execute(
        "select record_count, jsonb_array_length(payload) "
        "from layer_snapshot where module_id = 'wildfires'"
    )
    assert await cur.fetchone() == (6, 0)
    health = await conn.execute(
        "select record_count from module_health where module_id = 'wildfires'"
    )
    assert await health.fetchone() == (6,)


CLUSTER_BODY = csv(
    (10.01, 20.01, 5.0, "2026-10-14"),
    (10.02, 20.02, 20.0, "2026-10-14"),
    (10.03, 20.03, 1.0, "2026-10-14"),
    (10.60, 20.60, 3.0, "2026-10-14"),
    (-10.01, -20.01, 2.0, "2026-10-14"),
    (-10.02, -20.02, 7.0, "2026-10-14"),
    (50.0, 170.5, 4.0, "2026-10-14"),
    (50.0, -170.5, 6.0, "2026-10-14"),
    (60.0, 80.0, None, "2026-10-14"),
)
WORLD_BOX = (-180, -90, 180, 90)


async def clusters(
    c: Conn, *, cell: float | None, min_severity: float = 0.0, limit: int = 3000
) -> list[dict[str, object]]:
    record = await DbReader(c).window(
        "wildfires", LOOKBACK, Viewport(*WORLD_BOX, limit, cell, min_severity)
    )
    assert record is not None
    return [dict(row) for row in record.rows]


async def test_nearby_detections_merge_into_one_row(conn: Conn) -> None:
    await load(conn, CLUSTER_BODY)
    rows = await clusters(conn, cell=0.5)
    near = next(r for r in rows if r["lat"] == 10.02)
    assert near["severity"] == 26.0
    assert isinstance(near["attrs"], dict)
    assert near["attrs"]["cluster_count"] == 3
    assert near["attrs"]["frp_mw"] == 20.0
    assert near["id"] == "wildfires:n:20261014T0700:10.020:20.020"


async def test_the_strongest_detection_stands_for_its_cluster(conn: Conn) -> None:
    await load(conn, CLUSTER_BODY)
    rows = await clusters(conn, cell=0.5)
    south = next(r for r in rows if r["lat"] == -10.02)
    assert (south["lon"], south["severity"]) == (-20.02, 9.0)


async def test_single_detections_are_left_unmarked(conn: Conn) -> None:
    await load(conn, CLUSTER_BODY)
    rows = await clusters(conn, cell=0.5)
    lone = next(r for r in rows if r["lat"] == 10.6)
    assert isinstance(lone["attrs"], dict)
    assert "cluster_count" not in lone["attrs"]
    assert lone["severity"] == 3.0


async def test_clusters_come_strongest_total_first(conn: Conn) -> None:
    await load(conn, CLUSTER_BODY)
    rows = await clusters(conn, cell=0.5)
    totals = [r["severity"] for r in rows]
    assert totals == [26.0, 9.0, 6.0, 4.0, 3.0, 0.0]


async def test_cells_are_anchored_at_zero_with_floor_in_negative_coordinates(
    conn: Conn,
) -> None:
    await load(
        conn,
        csv(
            (-0.01, -0.01, 1.0, "2026-10-14"),
            (0.01, 0.01, 1.0, "2026-10-14"),
            (-0.01, 0.01, 1.0, "2026-10-14"),
            (-0.4, -0.3, 2.0, "2026-10-14"),
            (-0.2, -0.9, 3.0, "2026-10-14"),
        ),
    )
    rows = await clusters(conn, cell=1.0)
    assert sorted(float(str(r["severity"])) for r in rows) == [1.0, 1.0, 6.0]


async def test_cells_do_not_join_across_the_antimeridian(conn: Conn) -> None:
    await load(conn, CLUSTER_BODY)
    rows = await clusters(conn, cell=2.0)
    assert {r["lon"] for r in rows} >= {170.5, -170.5}


async def test_the_threshold_applies_to_the_cluster_total(conn: Conn) -> None:
    await load(conn, CLUSTER_BODY)
    rows = await clusters(conn, cell=0.5, min_severity=5.0)
    assert [r["severity"] for r in rows] == [26.0, 9.0, 6.0]
    record = await DbReader(conn).window(
        "wildfires",
        LOOKBACK,
        Viewport(*WORLD_BOX, 3000, 0.5, 5.0),
    )
    assert record is not None
    assert record.matched == 3


async def test_many_weak_detections_can_pass_together(conn: Conn) -> None:
    await load(
        conn,
        csv(*[(10.0 + i / 1000, 20.0, 1.0, "2026-10-14") for i in range(6)]),
    )
    assert [
        r["severity"] for r in await clusters(conn, cell=1.0, min_severity=5.0)
    ] == [6.0]
    assert await clusters(conn, cell=None, min_severity=5.0) == []


async def test_the_threshold_alone_filters_single_rows(conn: Conn) -> None:
    await load(conn, CLUSTER_BODY)
    rows = await clusters(conn, cell=None, min_severity=5.0)
    assert [r["severity"] for r in rows] == [20.0, 7.0, 6.0, 5.0]
    assert all("cluster_count" not in r["attrs"] for r in rows)  # type: ignore[operator]


async def test_the_cap_applies_to_clusters_and_matched_counts_them(
    conn: Conn,
) -> None:
    await load(conn, CLUSTER_BODY)
    record = await DbReader(conn).window(
        "wildfires", LOOKBACK, Viewport(*WORLD_BOX, 2, 0.5)
    )
    assert record is not None
    assert [r["severity"] for r in record.rows] == [26.0, 9.0]
    assert record.matched == 6


async def test_clustering_respects_the_box(conn: Conn) -> None:
    await load(conn, CLUSTER_BODY)
    record = await DbReader(conn).window(
        "wildfires", LOOKBACK, Viewport(15, 5, 25, 15, 3000, 0.5)
    )
    assert record is not None
    assert [r["severity"] for r in record.rows] == [26.0, 3.0]
    assert record.matched == 2


async def test_without_a_cell_rows_are_not_merged(conn: Conn) -> None:
    await load(conn, CLUSTER_BODY)
    rows = await clusters(conn, cell=None)
    assert len(rows) == 9
