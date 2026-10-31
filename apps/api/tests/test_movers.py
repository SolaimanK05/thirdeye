from collections.abc import AsyncIterator
from compression import zstd
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from pydantic import ValidationError
from test_stream import LATER, MODULES, World, build, drain, plane, update

from thirdeye.app import create_app
from thirdeye.config import Settings
from thirdeye.deps import get_broadcaster
from thirdeye.frames import Col, decode
from thirdeye.movers import RETAIN_FRAMES, SyntheticFeed
from thirdeye.stream import Broadcaster

FRAME_TYPE = "application/vnd.thirdeye.frame"
START = datetime(2026, 10, 14, 6, 0, tzinfo=UTC)


class Clock:
    def __init__(self) -> None:
        self.now = START

    def __call__(self) -> datetime:
        return self.now

    def tick(self, seconds: float = 1.0) -> None:
        self.now += timedelta(seconds=seconds)


def synthetic(count: int = 1000, period: int = 5) -> tuple[SyntheticFeed, Clock]:
    clock = Clock()
    return SyntheticFeed(count, seed=7, period=period, clock=clock), clock


async def with_synthetic(
    count: int = 1000, period: int = 5
) -> tuple[Broadcaster, SyntheticFeed, Clock]:
    feed, clock = synthetic(count, period)
    world = World()
    broadcaster, _ = build(world, {}, sources={"synthetic": feed})
    await broadcaster.refresh("synthetic")
    return broadcaster, feed, clock


async def started() -> tuple[World, Broadcaster, Any]:
    world = World()
    world.put("aircraft", plane(1), plane(2))
    world.put("ports", plane(9) | {"kind": "facility"})
    world.put("earthquakes", at=START)
    broadcaster, cache = build(world)
    for module_id in MODULES:
        await broadcaster.refresh(module_id)
    return world, broadcaster, cache


class TestRealModules:
    async def test_the_baseline_snapshot_lists_every_row(self) -> None:
        _, broadcaster, _ = await started()
        found = await broadcaster.frame_snapshot("aircraft", "identity")
        assert found is not None
        frame = decode(found.body)
        assert (found.version, frame.version, frame.rows) == (1, 1, 2)
        assert [entry[2] for entry in frame.dictionary] == ["PLANE1", "PLANE2"]

    async def test_an_update_records_a_delta_for_the_new_version(self) -> None:
        world, broadcaster, cache = await started()
        epoch = (await broadcaster.frame_snapshot("aircraft", "identity")).slot_epoch  # type: ignore[union-attr]
        await update(
            world, broadcaster, cache, "aircraft", plane(1, lon=60.0), plane(2)
        )
        found = await broadcaster.frame_delta("aircraft", 2, epoch, "identity")
        assert found is not None
        frame = decode(found.body)
        assert (frame.base_version, frame.version, frame.rows) == (1, 2, 1)
        assert frame.columns[Col.LON] == [600_000_000]
        assert found.immutable

    async def test_a_fetch_time_only_change_still_gets_an_empty_frame(self) -> None:
        world, broadcaster, cache = await started()
        epoch = (await broadcaster.frame_snapshot("aircraft", "identity")).slot_epoch  # type: ignore[union-attr]
        await update(world, broadcaster, cache, "aircraft", plane(1), plane(2))
        found = await broadcaster.frame_delta("aircraft", 2, epoch, "identity")
        assert found is not None
        assert decode(found.body).rows == 0

    async def test_removals_travel_as_slots(self) -> None:
        world, broadcaster, cache = await started()
        epoch = (await broadcaster.frame_snapshot("aircraft", "identity")).slot_epoch  # type: ignore[union-attr]
        await update(world, broadcaster, cache, "aircraft", plane(2))
        found = await broadcaster.frame_delta("aircraft", 2, epoch, "identity")
        assert found is not None
        assert decode(found.body).removes == [0]

    async def test_unknown_versions_and_old_epochs_have_no_frame(self) -> None:
        world, broadcaster, cache = await started()
        epoch = (await broadcaster.frame_snapshot("aircraft", "identity")).slot_epoch  # type: ignore[union-attr]
        await update(world, broadcaster, cache, "aircraft", plane(1, lon=61.0))
        assert await broadcaster.frame_delta("aircraft", 9, epoch, "identity") is None
        assert (
            await broadcaster.frame_delta("aircraft", 2, epoch + 1, "identity") is None
        )
        assert await broadcaster.frame_delta("ports", 2, epoch, "identity") is None

    async def test_modules_without_a_frame_profile_have_none(self) -> None:
        _, broadcaster, _ = await started()
        assert await broadcaster.frame_snapshot("ports", "identity") is None
        assert await broadcaster.frame_snapshot("nope", "identity") is None
        assert broadcaster.mover_modules == frozenset({"aircraft"})

    async def test_the_snapshot_is_built_once_per_version(self) -> None:
        _, broadcaster, _ = await started()
        first = await broadcaster.frame_snapshot("aircraft", "gzip")
        second = await broadcaster.frame_snapshot("aircraft", "gzip")
        assert first is not None
        assert second is not None
        assert first.body is second.body

    async def test_old_frames_leave_the_window(self) -> None:
        world, broadcaster, cache = await started()
        epoch = (await broadcaster.frame_snapshot("aircraft", "identity")).slot_epoch  # type: ignore[union-attr]
        for step in range(RETAIN_FRAMES + 5):
            await update(
                world,
                broadcaster,
                cache,
                "aircraft",
                plane(1, lon=10.0 + step / 100),
                plane(2),
                at=LATER + timedelta(seconds=step),
            )
        last = RETAIN_FRAMES + 6
        assert await broadcaster.frame_delta("aircraft", 2, epoch, "zstd") is None
        assert await broadcaster.frame_delta("aircraft", last, epoch, "zstd")

    async def test_json_clients_still_get_their_events(self) -> None:
        world, broadcaster, cache = await started()
        client = broadcaster.subscribe(frozenset({"aircraft"}))
        await drain(client)
        await update(world, broadcaster, cache, "aircraft", plane(1, lon=61.0))
        events = await drain(client)
        assert [event.kind for event in events] == ["layer", "delta"]


class TestSyntheticFeed:
    async def test_the_first_version_has_every_mover(self) -> None:
        broadcaster, _, _ = await with_synthetic(1000)
        found = await broadcaster.frame_snapshot("synthetic", "identity")
        assert found is not None
        assert decode(found.body).rows == 1000

    async def test_each_tick_moves_one_slice_and_announces_a_version(self) -> None:
        broadcaster, _, clock = await with_synthetic(1000, period=5)
        client = broadcaster.subscribe(frozenset())
        await drain(client)
        epoch = (await broadcaster.frame_snapshot("synthetic", "identity")).slot_epoch  # type: ignore[union-attr]
        clock.tick()
        await broadcaster.refresh("synthetic")
        events = await drain(client)
        assert [event.kind for event in events] == ["layer"]
        found = await broadcaster.frame_delta("synthetic", 2, epoch, "identity")
        assert found is not None
        assert decode(found.body).rows == 200

    async def test_it_never_reaches_the_json_stream(self) -> None:
        broadcaster, _, _ = await with_synthetic(50)
        assert "synthetic" not in broadcaster.entity_modules
        client = broadcaster.subscribe(frozenset())
        events = await drain(client)
        assert [event.kind for event in events] == ["hello"]

    async def test_the_same_seed_gives_the_same_frames(self) -> None:
        one, _, _ = await with_synthetic(300)
        two, _, _ = await with_synthetic(300)
        first = await one.frame_snapshot("synthetic", "identity")
        second = await two.frame_snapshot("synthetic", "identity")
        assert first is not None
        assert second is not None
        assert first.body == second.body

    def test_movers_stay_on_the_globe_and_keep_moving(self) -> None:
        feed, clock = synthetic(500, period=1)
        feed.advance_sync()
        first = [feed.row(i, clock()) for i in range(500)]
        for _ in range(20):
            clock.tick(30)
            rows, removes, _ = feed.advance_sync()
            assert removes == []
        assert all(-180 <= r.lon <= 180 and -90 <= r.lat <= 90 for r in rows)
        assert any(a.lon != b.lon or a.lat != b.lat for a, b in zip(first, rows))


class TestTheSettings:
    def test_a_public_instance_refuses_the_synthetic_feed(self) -> None:
        with pytest.raises(ValidationError, match="synthetic_movers"):
            Settings(
                database_url="postgresql://t:t@127.0.0.1:1/t",
                public_instance=True,
                synthetic_movers=10,
            )

    def test_it_is_off_by_default(self) -> None:
        settings = Settings(database_url="postgresql://t:t@127.0.0.1:1/t")
        assert settings.synthetic_movers == 0


@pytest.fixture
async def client(settings: Settings) -> AsyncIterator[tuple[httpx.AsyncClient, Any]]:
    world, broadcaster, cache = await started()
    app = create_app(settings)
    app.dependency_overrides[get_broadcaster] = lambda: broadcaster
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as http:
        yield http, (world, broadcaster, cache)


class TestTheEndpoints:
    async def test_the_snapshot_is_a_frame(self, client: Any) -> None:
        http, _ = client
        response = await http.get(
            "/v1/movers/aircraft/snapshot", headers={"Accept-Encoding": "identity"}
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == FRAME_TYPE
        assert "content-encoding" not in response.headers
        assert "Accept-Encoding" in response.headers["vary"]
        assert response.headers["cache-control"] == "no-cache"
        assert response.headers["etag"] == '"2-1"'
        assert decode(response.content).rows == 2

    async def test_zstd_is_chosen_when_the_client_accepts_it(self, client: Any) -> None:
        http, _ = client
        response = await http.get(
            "/v1/movers/aircraft/snapshot",
            headers={"Accept-Encoding": "gzip, zstd"},
        )
        assert response.headers["content-encoding"] == "zstd"
        assert decode(zstd.decompress(response.content)).rows == 2

    async def test_gzip_is_the_fallback(self, client: Any) -> None:
        http, _ = client
        response = await http.get(
            "/v1/movers/aircraft/snapshot", headers={"Accept-Encoding": "gzip"}
        )
        assert response.headers["content-encoding"] == "gzip"
        assert decode(response.content).rows == 2  # httpx already inflated it

    async def test_a_matching_etag_gets_a_304(self, client: Any) -> None:
        http, _ = client
        response = await http.get(
            "/v1/movers/aircraft/snapshot",
            headers={"Accept-Encoding": "identity", "If-None-Match": '"2-1"'},
        )
        assert response.status_code == 304
        assert response.content == b""

    async def test_each_encoding_has_its_own_etag(self, client: Any) -> None:
        http, _ = client
        response = await http.get(
            "/v1/movers/aircraft/snapshot", headers={"Accept-Encoding": "zstd"}
        )
        assert response.headers["etag"] == '"2-1-zstd"'
        again = await http.get(
            "/v1/movers/aircraft/snapshot",
            headers={"Accept-Encoding": "zstd", "If-None-Match": '"2-1-zstd"'},
        )
        assert again.status_code == 304

    async def test_a_new_version_changes_the_etag(self, client: Any) -> None:
        http, (world, broadcaster, cache) = client
        await update(world, broadcaster, cache, "aircraft", plane(1, lon=61.0))
        response = await http.get(
            "/v1/movers/aircraft/snapshot",
            headers={"Accept-Encoding": "identity", "If-None-Match": '"2-1"'},
        )
        assert response.status_code == 200
        assert response.headers["etag"] == '"2-2"'

    async def test_a_delta_is_immutable(self, client: Any) -> None:
        http, (world, broadcaster, cache) = client
        await update(world, broadcaster, cache, "aircraft", plane(1, lon=61.0))
        response = await http.get("/v1/movers/aircraft/frames/2?epoch=2")
        assert response.status_code == 200
        assert response.headers["cache-control"] == (
            "public, max-age=31536000, immutable"
        )
        assert decode(response.content).version == 2

    @pytest.mark.parametrize(
        "path",
        [
            "/v1/movers/ports/snapshot",
            "/v1/movers/nothing/snapshot",
            "/v1/movers/aircraft/frames/2?epoch=2",
            "/v1/movers/aircraft/frames/2?epoch=9",
        ],
    )
    async def test_missing_things_are_404(self, client: Any, path: str) -> None:
        http, _ = client
        response = await http.get(path)
        assert response.status_code == 404

    @pytest.mark.parametrize(
        "path",
        [
            "/v1/movers/aircraft/frames/1?epoch=2",
            "/v1/movers/aircraft/frames/2",
            "/v1/movers/aircraft/frames/x?epoch=2",
            "/v1/movers/aircraft/frames/2?epoch=0",
            "/v1/movers/Bad%20Id/snapshot",
        ],
    )
    async def test_bad_requests_are_422(self, client: Any, path: str) -> None:
        http, _ = client
        response = await http.get(path)
        assert response.status_code == 422
