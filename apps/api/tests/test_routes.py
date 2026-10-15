from collections.abc import Callable
from datetime import timedelta, timezone
from email.utils import format_datetime
from pathlib import Path
from typing import Any, Literal
from uuid import UUID

import pytest
from conftest import NOW, FakeReader
from fastapi.testclient import TestClient

from thirdeye import openapi
from thirdeye.ontology import Confidence, EntityKind, SourceReliability
from thirdeye.reads import EntityRecord, EventRecord, HealthRecord, SnapshotRecord
from thirdeye.routes.modules import module_state

type MakeClient = Callable[[bool], TestClient]

SOURCE: dict[str, Any] = {
    "source_id": "usgs-earthquakes",
    "source_module_id": "earthquakes",
    "source_url": "https://earthquake.usgs.gov/",
    "source_licence": "Public domain",
    "source_reliability": SourceReliability.PRIMARY,
}

QUAKE_ROW: dict[str, Any] = {
    "id": "earthquakes:us7000abcd",
    "category": "earthquake",
    "lon": 93.31,
    "lat": 22.41,
    "t_start": "2026-10-14T05:50:00+00:00",
    "t_end": "2026-10-14T05:50:00+00:00",
    "severity": 5.2,
    "confidence": "observed",
    "attrs": {"depth_km": 10.0, "place": "Myanmar"},
}

ENTITY_ID = UUID("8f0c3a52-1d2e-4a6b-9c41-5b3f2a7d9e10")


def quake_event() -> EventRecord:
    return EventRecord(
        **SOURCE,
        id="earthquakes:us7000abcd",
        module_id="earthquakes",
        category="earthquake",
        geometry={"type": "Point", "coordinates": [93.31, 22.41]},
        lon=93.31,
        lat=22.41,
        t_start=NOW - timedelta(minutes=10),
        t_end=NOW - timedelta(minutes=10),
        severity=5.2,
        attrs={"depth_km": 10.0, "place": "Myanmar", "mag_type": "mww"},
        retrieved_at=NOW,
        confidence=Confidence.OBSERVED,
    )


def vessel(with_fix: bool) -> EntityRecord:
    fix: dict[str, Any] = {
        "obs_t": NOW if with_fix else None,
        "obs_lon": 91.8 if with_fix else None,
        "obs_lat": 22.3 if with_fix else None,
        "obs_sog": 12.5 if with_fix else None,
        "obs_cog": 180.0 if with_fix else None,
        "obs_alt": None,
        "obs_confidence": Confidence.OBSERVED if with_fix else None,
    }
    return EntityRecord(
        **{**SOURCE, "source_module_id": "vessels"},
        **fix,
        id=ENTITY_ID,
        kind=EntityKind.VESSEL,
        names=["MV Example"],
        identifiers={"mmsi": "123456789"},
        attrs={},
        first_seen=NOW - timedelta(days=2),
        last_seen=NOW,
        retrieved_at=NOW,
    )


def health(
    status: Literal["ok", "failed"] = "ok", minutes_ago: float = 1, records: int = 10
) -> HealthRecord:
    return HealthRecord(
        module_id="earthquakes",
        status=status,
        fetched_at=NOW - timedelta(minutes=minutes_ago),
        record_count=records,
        reason="HTTPError: 503" if status == "failed" else None,
    )


class TestModuleState:
    def test_pending_before_the_first_fetch(self) -> None:
        assert module_state(None, 60, NOW) == "pending"

    def test_fresh_within_three_cadences(self) -> None:
        assert module_state(health(minutes_ago=2.9), 60, NOW) == "fresh"

    def test_stale_after_three_cadences(self) -> None:
        assert module_state(health(minutes_ago=3.1), 60, NOW) == "stale"

    def test_stale_waits_at_least_three_minutes(self) -> None:
        assert module_state(health(minutes_ago=2.5), 10, NOW) == "fresh"
        assert module_state(health(minutes_ago=3.5), 10, NOW) == "stale"

    def test_failed_wins(self) -> None:
        assert module_state(health("failed", minutes_ago=0), 60, NOW) == "failed"

    def test_empty_when_the_feed_had_nothing(self) -> None:
        assert module_state(health(records=0), 60, NOW) == "empty"

    def test_never_stale_without_a_schedule(self) -> None:
        assert module_state(health(minutes_ago=10_000), 0, NOW) == "fresh"


class TestModules:
    def test_lists_every_manifest_with_health(
        self, make_client: MakeClient, reader: FakeReader
    ) -> None:
        reader.health_rows = {"earthquakes": health()}
        body = make_client(True).get("/v1/modules").json()
        quakes = next(m for m in body if m["id"] == "earthquakes")
        assert quakes["enabled"] is True
        assert quakes["cadence_seconds"] == 60
        assert quakes["zoom_range"] == {"min": 1, "max": 4}
        assert quakes["provenance"]["attribution"] == "USGS"
        assert len(quakes["provenance"]["limitations"]) >= 2
        assert quakes["health"]["record_count"] == 10
        assert quakes["health"]["stale_after_seconds"] == 180
        assert quakes["health"]["state"] in {"fresh", "stale"}

    def test_module_without_health_is_pending(self, make_client: MakeClient) -> None:
        body = make_client(True).get("/v1/modules").json()
        assert body[0]["health"]["state"] == "pending"
        assert body[0]["health"]["fetched_at"] is None

    def test_database_down_is_503(self, make_client: MakeClient) -> None:
        response = make_client(False).get("/v1/modules")
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "service_unavailable"


class TestLayers:
    def snapshot(self, reader: FakeReader) -> None:
        reader.snapshots["earthquakes"] = SnapshotRecord(
            payload=[QUAKE_ROW], fetched_at=NOW
        )

    def test_returns_rows_with_cache_headers(
        self, make_client: MakeClient, reader: FakeReader
    ) -> None:
        self.snapshot(reader)
        response = make_client(True).get("/v1/layers/earthquakes")
        assert response.status_code == 200
        body = response.json()
        assert body["module_id"] == "earthquakes"
        assert body["record_count"] == 1
        assert body["rows"][0]["id"] == "earthquakes:us7000abcd"
        assert response.headers["etag"].startswith('"')
        assert response.headers["last-modified"] == format_datetime(NOW, usegmt=True)
        assert response.headers["cache-control"] == "no-cache"

    def test_serves_from_cache(
        self, make_client: MakeClient, reader: FakeReader
    ) -> None:
        self.snapshot(reader)
        client = make_client(True)
        client.get("/v1/layers/earthquakes")
        client.get("/v1/layers/earthquakes")
        assert reader.snapshot_calls == 1

    @pytest.mark.parametrize("form", ["{etag}", "W/{etag}", '"other", {etag}', "*"])
    def test_if_none_match_gives_304(
        self, make_client: MakeClient, reader: FakeReader, form: str
    ) -> None:
        self.snapshot(reader)
        client = make_client(True)
        etag = client.get("/v1/layers/earthquakes").headers["etag"]
        response = client.get(
            "/v1/layers/earthquakes",
            headers={"If-None-Match": form.format(etag=etag)},
        )
        assert response.status_code == 304
        assert response.content == b""
        assert response.headers["etag"] == etag

    def test_other_etag_gets_the_body(
        self, make_client: MakeClient, reader: FakeReader
    ) -> None:
        self.snapshot(reader)
        response = make_client(True).get(
            "/v1/layers/earthquakes", headers={"If-None-Match": '"stale"'}
        )
        assert response.status_code == 200

    def test_if_modified_since(
        self, make_client: MakeClient, reader: FakeReader
    ) -> None:
        self.snapshot(reader)
        client = make_client(True)
        same = format_datetime(NOW, usegmt=True)
        older = format_datetime(NOW - timedelta(minutes=1), usegmt=True)
        assert (
            client.get(
                "/v1/layers/earthquakes", headers={"If-Modified-Since": same}
            ).status_code
            == 304
        )
        assert (
            client.get(
                "/v1/layers/earthquakes", headers={"If-Modified-Since": older}
            ).status_code
            == 200
        )
        assert (
            client.get(
                "/v1/layers/earthquakes", headers={"If-Modified-Since": "garbage"}
            ).status_code
            == 200
        )

    def test_last_modified_is_gmt_whatever_the_db_timezone(
        self, make_client: MakeClient, reader: FakeReader
    ) -> None:
        dhaka = timezone(timedelta(hours=6))
        reader.snapshots["earthquakes"] = SnapshotRecord(
            payload=[QUAKE_ROW], fetched_at=NOW.astimezone(dhaka)
        )
        response = make_client(True).get("/v1/layers/earthquakes")
        assert response.status_code == 200
        assert response.headers["last-modified"] == "Wed, 14 Oct 2026 06:00:00 GMT"

    def test_layer_not_fetched_yet_is_empty(self, make_client: MakeClient) -> None:
        response = make_client(True).get("/v1/layers/earthquakes")
        assert response.status_code == 200
        assert response.json() == {
            "module_id": "earthquakes",
            "fetched_at": None,
            "record_count": 0,
            "matched": 0,
            "truncated": False,
            "rows": [],
            "entities": [],
        }
        assert "last-modified" not in response.headers

    def test_unknown_or_disabled_module_is_404(self, make_client: MakeClient) -> None:
        response = make_client(True).get("/v1/layers/vessels")
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"

    def test_cors_exposes_cache_headers(
        self, make_client: MakeClient, reader: FakeReader
    ) -> None:
        self.snapshot(reader)
        response = make_client(True).get(
            "/v1/layers/earthquakes", headers={"Origin": "http://localhost:3000"}
        )
        exposed = response.headers["access-control-expose-headers"].lower()
        assert "etag" in exposed
        assert "last-modified" in exposed


class TestEvents:
    def test_full_record_with_provenance(
        self, make_client: MakeClient, reader: FakeReader
    ) -> None:
        reader.events["earthquakes:us7000abcd"] = quake_event()
        response = make_client(True).get("/v1/events/earthquakes:us7000abcd")
        assert response.status_code == 200
        body = response.json()
        assert body["severity"] == 5.2
        assert body["position"] == {"lon": 93.31, "lat": 22.41}
        assert body["confidence"] == "observed"
        assert body["source"]["reliability"] == "primary"
        assert body["provenance"]["attribution"] == "USGS"
        assert body["provenance"]["limitations"][0].startswith("Magnitudes")
        assert body["retrieved_at"].startswith("2026-10-14T06:00:00")

    def test_missing_event_is_404(self, make_client: MakeClient) -> None:
        response = make_client(True).get("/v1/events/earthquakes:nope")
        assert response.status_code == 404
        assert response.json()["error"]["message"] == "No event 'earthquakes:nope'"


class TestEntities:
    def test_entity_with_latest_fix(
        self, make_client: MakeClient, reader: FakeReader
    ) -> None:
        reader.entities[ENTITY_ID] = vessel(with_fix=True)
        body = make_client(True).get(f"/v1/entities/{ENTITY_ID}").json()
        assert body["kind"] == "vessel"
        assert body["identifiers"] == {"mmsi": "123456789"}
        assert body["last_observation"]["position"] == {"lon": 91.8, "lat": 22.3}
        assert body["last_observation"]["confidence"] == "observed"
        assert body["provenance"] is None

    def test_entity_without_fixes(
        self, make_client: MakeClient, reader: FakeReader
    ) -> None:
        reader.entities[ENTITY_ID] = vessel(with_fix=False)
        body = make_client(True).get(f"/v1/entities/{ENTITY_ID}").json()
        assert body["last_observation"] is None

    def test_bad_id_is_422(self, make_client: MakeClient) -> None:
        response = make_client(True).get("/v1/entities/not-a-uuid")
        assert response.status_code == 422

    def test_missing_entity_is_404(self, make_client: MakeClient) -> None:
        response = make_client(True).get(f"/v1/entities/{ENTITY_ID}")
        assert response.status_code == 404


class TestOpenApi:
    def test_schema_lists_every_route(self) -> None:
        paths = openapi.schema()["paths"]
        assert set(paths) >= {
            "/v1/health",
            "/v1/modules",
            "/v1/layers/{module_id}",
            "/v1/events/{event_id}",
            "/v1/entities/{entity_id}",
        }

    def test_layer_route_documents_its_body(self) -> None:
        route = openapi.schema()["paths"]["/v1/layers/{module_id}"]["get"]
        body = route["responses"]["200"]["content"]["application/json"]["schema"]
        assert body == {"$ref": "#/components/schemas/Layer"}

    def test_cli_writes_the_file(self, tmp_path: Path) -> None:
        out = tmp_path / "openapi.json"
        assert openapi.main([str(out)]) == 0
        assert '"/v1/modules"' in out.read_text(encoding="utf-8")
