import gzip
import json
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import pytest
from conftest import NOW, FakeReader
from fastapi.testclient import TestClient

from thirdeye.config import Settings
from thirdeye.layers import MAX_VIEW_ENTRIES, LayerCache
from thirdeye.reads import Viewport, ViewRecord
from thirdeye.registry import REGISTRY, Module

type MakeRegistryClient = Callable[[Settings, dict[str, Module]], TestClient]

LOOKBACK = 3 * 86_400


def fire(index: int, lon: float, lat: float, frp: float | None) -> dict[str, Any]:
    return {
        "id": f"wildfires:n:{index}",
        "category": "thermal-anomaly",
        "lon": lon,
        "lat": lat,
        "t_start": "2026-10-14T05:00:00+00:00",
        "t_end": "2026-10-14T05:00:00+00:00",
        "severity": frp,
        "confidence": "derived",
        "attrs": {"frp_mw": frp},
    }


FIRES = [
    fire(1, 90.0, 22.0, 4.0),
    fire(2, 91.0, 23.0, 40.0),
    fire(3, 175.0, -10.0, 9.0),
    fire(4, -175.0, -12.0, 12.0),
    fire(5, -60.0, -5.0, None),
    fire(6, 20.0, 5.0, 1.0),
]


@pytest.fixture
def client(make_registry_client: MakeRegistryClient, reader: FakeReader) -> TestClient:
    settings = Settings(
        database_url="postgresql://test:test@127.0.0.1:1/test",
        modules_enabled=["earthquakes", "wildfires"],
        _env_file=None,
    )
    reader.view_rows["wildfires"] = list(FIRES)
    reader.view_fetched_at["wildfires"] = NOW
    return make_registry_client(settings, dict(REGISTRY))


def ids(response: Any) -> list[str]:
    return [row["id"].split(":")[-1] for row in response.json()["rows"]]


class TestViewportRoute:
    def test_no_parameters_means_the_world_with_the_default_cap(
        self, client: TestClient, reader: FakeReader
    ) -> None:
        response = client.get("/v1/layers/wildfires")
        assert response.status_code == 200
        assert reader.window_calls == [
            ("wildfires", LOOKBACK, Viewport(-180.0, -90.0, 180.0, 90.0, 3000))
        ]
        body = response.json()
        assert body["record_count"] == 6
        assert body["matched"] == 6
        assert body["truncated"] is False

    def test_rows_come_strongest_first(self, client: TestClient) -> None:
        assert ids(client.get("/v1/layers/wildfires")) == ["2", "4", "3", "1", "6", "5"]

    def test_bbox_filters_and_limit_truncates(
        self, client: TestClient, reader: FakeReader
    ) -> None:
        response = client.get(
            "/v1/layers/wildfires", params={"bbox": "80,10,100,30", "limit": 1}
        )
        body = response.json()
        assert ids(response) == ["2"]
        assert body["record_count"] == 1
        assert body["matched"] == 2
        assert body["truncated"] is True
        assert reader.window_calls[-1][2] == Viewport(80.0, 10.0, 100.0, 30.0, 1)

    def test_a_box_across_the_antimeridian_wraps(self, client: TestClient) -> None:
        response = client.get("/v1/layers/wildfires", params={"bbox": "170,-20,-170,0"})
        assert ids(response) == ["4", "3"]

    def test_nothing_fetched_yet_is_an_empty_layer(
        self, client: TestClient, reader: FakeReader
    ) -> None:
        reader.view_fetched_at.clear()
        response = client.get("/v1/layers/wildfires")
        assert response.status_code == 200
        assert response.json() == {
            "module_id": "wildfires",
            "fetched_at": None,
            "record_count": 0,
            "matched": 0,
            "truncated": False,
            "rows": [],
        }

    @pytest.mark.parametrize(
        "bbox",
        [
            "1,2,3",
            "a,b,c,d",
            "1,2,3,4,5",
            "-200,0,10,10",
            "0,0,200,10",
            "0,10,10,5",
            "0,5,10,5",
            "5,0,5,10",
            "0,-95,10,10",
            "nan,0,10,10",
            "0,0,inf,10",
        ],
    )
    def test_a_bad_box_is_rejected(self, client: TestClient, bbox: str) -> None:
        response = client.get("/v1/layers/wildfires", params={"bbox": bbox})
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "unprocessable_content"

    @pytest.mark.parametrize("limit", [0, -1, 10_001])
    def test_a_bad_limit_is_rejected(self, client: TestClient, limit: int) -> None:
        response = client.get("/v1/layers/wildfires", params={"limit": limit})
        assert response.status_code == 422

    @pytest.mark.parametrize(
        "params",
        [
            {"bbox": "0,0,10,10"},
            {"limit": 5},
            {"cell": 1},
            {"min_severity": 1},
        ],
    )
    def test_modules_without_a_viewport_refuse_the_parameters(
        self, client: TestClient, params: dict[str, Any]
    ) -> None:
        response = client.get("/v1/layers/earthquakes", params=params)
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "bad_request"

    def test_clustering_parameters_reach_the_reader(
        self, client: TestClient, reader: FakeReader
    ) -> None:
        response = client.get(
            "/v1/layers/wildfires",
            params={"bbox": "80,10,100,30", "cell": 0.5, "min_severity": 3},
        )
        assert response.status_code == 200
        assert reader.window_calls[-1][2] == Viewport(
            80.0, 10.0, 100.0, 30.0, 3000, 0.5, 3.0
        )

    def test_clustering_parameters_alone_cover_the_world(
        self, client: TestClient, reader: FakeReader
    ) -> None:
        client.get("/v1/layers/wildfires", params={"cell": 2})
        assert reader.window_calls[-1][2] == Viewport(
            -180.0, -90.0, 180.0, 90.0, 3000, 2.0, 0.0
        )

    @pytest.mark.parametrize(
        "params",
        [
            {"cell": 0},
            {"cell": -1},
            {"cell": 45.5},
            {"cell": "nan"},
            {"cell": "inf"},
            {"min_severity": -1},
            {"min_severity": "nan"},
            {"min_severity": "inf"},
            {"min_severity": 100_001},
        ],
    )
    def test_bad_clustering_parameters_are_rejected(
        self, client: TestClient, params: dict[str, Any]
    ) -> None:
        response = client.get("/v1/layers/wildfires", params=params)
        assert response.status_code == 422

    def test_each_clustering_choice_is_cached_separately(
        self, client: TestClient, reader: FakeReader
    ) -> None:
        for params in ({}, {"cell": 1}, {"cell": 1}, {"cell": 2}, {"min_severity": 2}):
            client.get("/v1/layers/wildfires", params=params)
        assert len(reader.window_calls) == 4

    def test_the_same_box_is_loaded_once(
        self, client: TestClient, reader: FakeReader
    ) -> None:
        for _ in range(3):
            client.get("/v1/layers/wildfires", params={"bbox": "80,10,100,30"})
        client.get("/v1/layers/wildfires", params={"bbox": "80,10,100,31"})
        assert len(reader.window_calls) == 2

    def test_etag_revalidation_works_per_box(self, client: TestClient) -> None:
        first = client.get("/v1/layers/wildfires", params={"bbox": "80,10,100,30"})
        again = client.get(
            "/v1/layers/wildfires",
            params={"bbox": "80,10,100,30"},
            headers={"If-None-Match": first.headers["etag"]},
        )
        other = client.get(
            "/v1/layers/wildfires",
            params={"bbox": "-180,-90,180,90"},
            headers={"If-None-Match": first.headers["etag"]},
        )
        assert again.status_code == 304
        assert other.status_code == 200

    def test_modules_say_which_layers_use_a_viewport(self, client: TestClient) -> None:
        by_id = {m["id"]: m for m in client.get("/v1/modules").json()}
        assert by_id["wildfires"]["viewport"] is True
        assert by_id["earthquakes"]["viewport"] is False


def test_gzip_applies_to_big_json(
    make_registry_client: MakeRegistryClient, reader: FakeReader
) -> None:
    settings = Settings(
        database_url="postgresql://test:test@127.0.0.1:1/test",
        modules_enabled=["earthquakes", "wildfires"],
        _env_file=None,
    )
    reader.view_rows["wildfires"] = [fire(i, 90.0, 22.0, float(i)) for i in range(200)]
    reader.view_fetched_at["wildfires"] = NOW
    client = make_registry_client(settings, dict(REGISTRY))
    response = client.get("/v1/layers/wildfires", headers={"Accept-Encoding": "gzip"})
    assert response.headers["content-encoding"] == "gzip"
    assert response.json()["record_count"] == 200
    raw = client.get("/v1/layers/wildfires", headers={"Accept-Encoding": "identity"})
    assert "content-encoding" not in raw.headers
    assert len(gzip.compress(raw.content)) < len(raw.content) / 4
    assert json.loads(raw.content)["record_count"] == 200


class TestViewCache:
    @staticmethod
    def make_cache() -> tuple[LayerCache, list[tuple[str, Viewport]]]:
        calls: list[tuple[str, Viewport]] = []

        async def snapshot(module_id: str) -> None:
            return None

        async def view(module_id: str, viewport: Viewport) -> ViewRecord:
            calls.append((module_id, viewport))
            return ViewRecord(rows=[], matched=0, fetched_at=NOW)

        return LayerCache(snapshot, view), calls

    async def test_each_box_is_cached_separately(self) -> None:
        cache, calls = self.make_cache()
        a, b = Viewport(0, 0, 10, 10), Viewport(0, 0, 10, 10, 5)
        await cache.get_view("wildfires", a)
        await cache.get_view("wildfires", a)
        await cache.get_view("wildfires", b)
        assert calls == [("wildfires", a), ("wildfires", b)]

    async def test_invalidating_a_module_drops_all_its_boxes(self) -> None:
        cache, calls = self.make_cache()
        a, b = Viewport(0, 0, 10, 10), Viewport(5, 5, 20, 20)
        await cache.get_view("wildfires", a)
        await cache.get_view("wildfires", b)
        await cache.get_view("other", a)
        cache.invalidate("wildfires")
        await cache.get_view("wildfires", a)
        await cache.get_view("other", a)
        assert [c[0] for c in calls] == ["wildfires", "wildfires", "other", "wildfires"]

    async def test_the_number_of_cached_boxes_is_bounded(self) -> None:
        cache, calls = self.make_cache()
        for index in range(MAX_VIEW_ENTRIES + 10):
            await cache.get_view("wildfires", Viewport(0, 0, 10, 10 + index / 100))
        assert len(calls) == MAX_VIEW_ENTRIES + 10
        await cache.get_view("wildfires", Viewport(0, 0, 10, 10))
        assert len(calls) == MAX_VIEW_ENTRIES + 11
        await cache.get_view(
            "wildfires", Viewport(0, 0, 10, 10 + (MAX_VIEW_ENTRIES + 9) / 100)
        )
        assert len(calls) == MAX_VIEW_ENTRIES + 11

    async def test_a_cache_without_a_view_loader_says_so(self) -> None:
        async def snapshot(module_id: str) -> None:
            return None

        with pytest.raises(RuntimeError, match="viewport loader"):
            await LayerCache(snapshot).get_view("wildfires", Viewport(0, 0, 1, 1))

    async def test_a_load_that_races_an_update_is_not_kept(self) -> None:
        holder: dict[str, LayerCache] = {}
        calls = 0

        async def snapshot(module_id: str) -> None:
            return None

        async def view(module_id: str, viewport: Viewport) -> ViewRecord:
            nonlocal calls
            calls += 1
            if calls == 1:
                holder["cache"].invalidate(module_id)
            return ViewRecord(
                rows=[], matched=0, fetched_at=datetime(2026, 10, 14, tzinfo=UTC)
            )

        cache = LayerCache(snapshot, view)
        holder["cache"] = cache
        box = Viewport(0, 0, 10, 10)
        await cache.get_view("wildfires", box)
        await cache.get_view("wildfires", box)
        assert calls == 2
