from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import pytest
from conftest import FakeReader, FakeWriter
from fastapi.testclient import TestClient

from thirdeye.config import Settings
from thirdeye.ontology import EntityKind
from thirdeye.reads import SearchRecord, WatchRecord
from thirdeye.registry import REGISTRY

SHIP = UUID("0b1e7c9a-3f4d-4c2b-8a6e-1d2f3a4b5c6d")
OTHER = UUID("5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a")
NOW = datetime(2026, 10, 14, 6, 0, tzinfo=UTC)


def watch(entity_id: UUID = SHIP, **changes: Any) -> WatchRecord:
    data: dict[str, Any] = {
        "entity_id": entity_id,
        "kind": EntityKind.VESSEL,
        "names": ["EVER GIVEN"],
        "identifiers": {"mmsi": "353136000"},
        "module_id": "vessels",
        "added_at": NOW,
        "last_seen": NOW,
        "lon": 32.5,
        "lat": 30.0,
    }
    return WatchRecord(**(data | changes))


def hit(**changes: Any) -> SearchRecord:
    data: dict[str, Any] = {
        "kind": "event",
        "id": "earthquakes:us1",
        "module_id": "earthquakes",
        "category": "earthquake",
        "label": "12 km SE of Mandalay, Myanmar",
        "severity": 5.4,
        "t": NOW,
        "lon": 96.1,
        "lat": 21.9,
        "starred": False,
    }
    return SearchRecord(**(data | changes))


@pytest.fixture
def client(make_client: Any) -> TestClient:
    client: TestClient = make_client()
    return client


class TestWatchlist:
    def test_empty_by_default_and_writable(self, client: TestClient) -> None:
        body = client.get("/v1/watchlist").json()
        assert body == {"writable": True, "items": []}

    def test_lists_starred_entities_with_a_name_and_position(
        self, client: TestClient, reader: FakeReader
    ) -> None:
        reader.watch_records = [watch()]
        [item] = client.get("/v1/watchlist").json()["items"]
        assert item["entity_id"] == str(SHIP)
        assert item["name"] == "EVER GIVEN"
        assert item["kind"] == "vessel"
        assert item["module_id"] == "vessels"
        assert item["position"] == {"lon": 32.5, "lat": 30.0}
        assert item["added_at"].startswith("2026-10-14T06:00:00")

    @pytest.mark.parametrize(
        ("names", "identifiers", "expected"),
        [
            (["", "  "], {"mmsi": "353136000"}, "353136000"),
            (["  Spaced  "], {}, "Spaced"),
            ([], {}, "0b1e7c9a"),
        ],
    )
    def test_names_fall_back_to_identifiers_then_the_id(
        self,
        client: TestClient,
        reader: FakeReader,
        names: list[str],
        identifiers: dict[str, Any],
        expected: str,
    ) -> None:
        reader.watch_records = [watch(names=names, identifiers=identifiers)]
        [item] = client.get("/v1/watchlist").json()["items"]
        assert item["name"] == expected

    def test_an_entity_without_a_fix_has_no_position(
        self, client: TestClient, reader: FakeReader
    ) -> None:
        reader.watch_records = [watch(lon=None, lat=None)]
        [item] = client.get("/v1/watchlist").json()["items"]
        assert item["position"] is None

    def test_starring_an_entity_is_remembered(
        self, client: TestClient, writer: FakeWriter
    ) -> None:
        writer.known.add(SHIP)
        assert client.put(f"/v1/watchlist/{SHIP}").status_code == 204
        assert client.put(f"/v1/watchlist/{SHIP}").status_code == 204
        assert writer.starred == {SHIP}

    def test_starring_an_unknown_entity_is_a_404(self, client: TestClient) -> None:
        response = client.put(f"/v1/watchlist/{OTHER}")
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"

    def test_unstarring_is_idempotent(
        self, client: TestClient, writer: FakeWriter
    ) -> None:
        writer.starred.add(SHIP)
        assert client.delete(f"/v1/watchlist/{SHIP}").status_code == 204
        assert client.delete(f"/v1/watchlist/{SHIP}").status_code == 204
        assert writer.starred == set()

    def test_a_bad_id_is_a_422(self, client: TestClient) -> None:
        assert client.put("/v1/watchlist/not-a-uuid").status_code == 422
        assert client.delete("/v1/watchlist/not-a-uuid").status_code == 422

    def test_a_database_outage_is_a_503(
        self, make_client: Any, reader: FakeReader
    ) -> None:
        client: TestClient = make_client(False)
        assert client.get("/v1/watchlist").status_code == 503


class TestPublicInstance:
    @pytest.fixture
    def public(self, make_registry_client: Any, writer: FakeWriter) -> TestClient:
        settings = Settings(
            database_url="postgresql://test:test@127.0.0.1:1/test",
            modules_enabled=["earthquakes"],
            public_instance=True,
            _env_file=None,
        )
        writer.known.add(SHIP)
        client: TestClient = make_registry_client(settings, dict(REGISTRY))
        return client

    def test_the_list_says_it_is_read_only(self, public: TestClient) -> None:
        assert public.get("/v1/watchlist").json()["writable"] is False

    def test_starring_is_refused(self, public: TestClient, writer: FakeWriter) -> None:
        response = public.put(f"/v1/watchlist/{SHIP}")
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "forbidden"
        assert writer.starred == set()

    def test_unstarring_is_refused(
        self, public: TestClient, writer: FakeWriter
    ) -> None:
        writer.starred.add(SHIP)
        assert public.delete(f"/v1/watchlist/{SHIP}").status_code == 403
        assert writer.starred == {SHIP}


class TestSearch:
    def test_returns_events_and_entities_with_labels(
        self, client: TestClient, reader: FakeReader
    ) -> None:
        reader.search_records = [
            hit(
                kind="entity",
                id=str(SHIP),
                module_id="vessels",
                category="vessel",
                label="EVER GIVEN",
                severity=None,
                starred=True,
            ),
            hit(),
        ]
        body = client.get("/v1/search", params={"q": "ever"}).json()
        assert body["query"] == "ever"
        ship, quake = body["results"]
        assert (ship["kind"], ship["label"], ship["starred"]) == (
            "entity",
            "EVER GIVEN",
            True,
        )
        assert quake["id"] == "earthquakes:us1"
        assert quake["position"] == {"lon": 96.1, "lat": 21.9}
        assert quake["severity"] == 5.4

    def test_a_missing_label_falls_back_to_the_category(
        self, client: TestClient, reader: FakeReader
    ) -> None:
        reader.search_records = [
            hit(label=None, category="thermal-anomaly"),
            hit(label="   ", category="quarry_blast"),
        ]
        labels = [
            r["label"]
            for r in client.get("/v1/search", params={"q": "an"}).json()["results"]
        ]
        assert labels == ["Thermal anomaly", "Quarry blast"]

    def test_the_text_is_trimmed_and_enabled_modules_are_searched(
        self, client: TestClient, reader: FakeReader
    ) -> None:
        client.get("/v1/search", params={"q": "  Quake  "})
        [(text, modules, named, limit)] = reader.search_calls
        assert text == "Quake"
        assert modules == ["earthquakes"]
        assert named == ["earthquakes"]
        assert limit == 8

    def test_a_module_name_match_is_passed_on(
        self, client: TestClient, reader: FakeReader
    ) -> None:
        client.get("/v1/search", params={"q": "zzz"})
        assert reader.search_calls[-1][2] == []

    def test_limit_is_passed_on(self, client: TestClient, reader: FakeReader) -> None:
        client.get("/v1/search", params={"q": "ab", "limit": 3})
        assert reader.search_calls[-1][3] == 3

    @pytest.mark.parametrize(
        "params",
        [
            {},
            {"q": ""},
            {"q": "a"},
            {"q": "   "},
            {"q": "x" * 81},
            {"q": "ab", "limit": 0},
            {"q": "ab", "limit": 26},
        ],
    )
    def test_bad_requests_are_rejected(
        self, client: TestClient, params: dict[str, Any]
    ) -> None:
        assert client.get("/v1/search", params=params).status_code == 422

    def test_a_database_outage_is_a_503(self, make_client: Any) -> None:
        client: TestClient = make_client(False)
        assert client.get("/v1/search", params={"q": "ab"}).status_code == 503
