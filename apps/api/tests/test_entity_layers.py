from collections.abc import Callable, Mapping
from typing import Any

from conftest import NOW, FakeReader
from fastapi.testclient import TestClient

from thirdeye.config import Settings
from thirdeye.reads import SearchRecord, SnapshotRecord
from thirdeye.registry import REGISTRY, Module

type MakeRegistryClient = Callable[[Settings, Mapping[str, Module]], TestClient]

URL = "postgresql://test:test@127.0.0.1:1/test"


def row(n: int, lon: float, lat: float, **changes: Any) -> dict[str, Any]:
    return {
        "id": f"a0000000-0000-4000-8000-{n:012d}",
        "kind": "facility",
        "name": f"Port {n}",
        "lon": lon,
        "lat": lat,
        "t": NOW.isoformat(),
        "sog": None,
        "cog": None,
        "heading": None,
        "alt": None,
        "confidence": "reported",
        "attrs": {"harbor_size": "M"},
    } | changes


ROWS = [
    row(1, 90.0, 22.0),
    row(2, 91.0, 23.0),
    row(3, -170.0, 10.0),
    row(4, 170.0, 10.0),
    row(5, 10.0, -40.0),
]


def client_with_ports(
    make_registry_client: MakeRegistryClient, reader: FakeReader
) -> TestClient:
    settings = Settings(
        database_url=URL, modules_enabled=["earthquakes", "ports"], _env_file=None
    )
    reader.snapshots["ports"] = SnapshotRecord(payload=ROWS, fetched_at=NOW)
    return make_registry_client(settings, REGISTRY)


def test_an_entity_layer_returns_entities_not_rows(
    make_registry_client: MakeRegistryClient, reader: FakeReader
) -> None:
    body = (
        client_with_ports(make_registry_client, reader).get("/v1/layers/ports").json()
    )
    assert body["rows"] == []
    assert [e["name"] for e in body["entities"]] == [f"Port {n}" for n in range(1, 6)]
    assert body["record_count"] == body["matched"] == 5
    assert body["truncated"] is False
    first = body["entities"][0]
    assert first["kind"] == "facility"
    assert first["confidence"] == "reported"
    assert first["attrs"] == {"harbor_size": "M"}


def test_a_bbox_keeps_only_entities_inside_it(
    make_registry_client: MakeRegistryClient, reader: FakeReader
) -> None:
    client = client_with_ports(make_registry_client, reader)
    body = client.get("/v1/layers/ports", params={"bbox": "80,15,100,30"}).json()
    assert [e["name"] for e in body["entities"]] == ["Port 1", "Port 2"]
    assert body["matched"] == 2


def test_a_bbox_may_cross_the_antimeridian(
    make_registry_client: MakeRegistryClient, reader: FakeReader
) -> None:
    client = client_with_ports(make_registry_client, reader)
    body = client.get("/v1/layers/ports", params={"bbox": "160,0,-160,20"}).json()
    assert [e["name"] for e in body["entities"]] == ["Port 3", "Port 4"]


def test_a_limit_truncates_and_says_so(
    make_registry_client: MakeRegistryClient, reader: FakeReader
) -> None:
    client = client_with_ports(make_registry_client, reader)
    body = client.get("/v1/layers/ports", params={"limit": 2}).json()
    assert len(body["entities"]) == 2
    assert body["record_count"] == 2
    assert body["matched"] == 5
    assert body["truncated"] is True


def test_cell_and_severity_are_refused_for_entities(
    make_registry_client: MakeRegistryClient, reader: FakeReader
) -> None:
    client = client_with_ports(make_registry_client, reader)
    assert client.get("/v1/layers/ports", params={"cell": 2}).status_code == 400
    assert client.get("/v1/layers/ports", params={"min_severity": 1}).status_code == 400


def test_a_bad_bbox_is_refused_for_entities(
    make_registry_client: MakeRegistryClient, reader: FakeReader
) -> None:
    client = client_with_ports(make_registry_client, reader)
    assert client.get("/v1/layers/ports", params={"bbox": "1,2,3"}).status_code == 422


def test_an_entity_layer_has_an_etag_and_answers_304(
    make_registry_client: MakeRegistryClient, reader: FakeReader
) -> None:
    client = client_with_ports(make_registry_client, reader)
    first = client.get("/v1/layers/ports")
    again = client.get(
        "/v1/layers/ports", headers={"If-None-Match": first.headers["etag"]}
    )
    assert again.status_code == 304


def test_an_entity_layer_that_was_never_filled_is_empty(
    make_registry_client: MakeRegistryClient, reader: FakeReader
) -> None:
    client = client_with_ports(make_registry_client, reader)
    del reader.snapshots["ports"]
    body = client.get("/v1/layers/ports").json()
    assert body["entities"] == []
    assert body["fetched_at"] is None


def test_an_event_layer_has_no_entities(
    make_registry_client: MakeRegistryClient, reader: FakeReader
) -> None:
    client = client_with_ports(make_registry_client, reader)
    assert client.get("/v1/layers/earthquakes").json()["entities"] == []


def test_the_module_list_says_what_kind_each_module_is(
    make_registry_client: MakeRegistryClient, reader: FakeReader
) -> None:
    body = client_with_ports(make_registry_client, reader).get("/v1/modules").json()
    kinds = {m["id"]: m["kind"] for m in body}
    assert kinds["ports"] == "entities"
    assert kinds["earthquakes"] == "events"
    assert kinds["wildfires"] == "events"
    ports = next(m for m in body if m["id"] == "ports")
    assert ports["cadence_seconds"] == 7 * 24 * 3600
    assert ports["viewport"] is False
    assert ports["zoom_range"] == {"min": 2, "max": 4}
    assert ports["provenance"]["attribution"] == "NGA"


def test_search_hits_for_entities_carry_an_identifier_line(
    make_registry_client: MakeRegistryClient, reader: FakeReader
) -> None:
    client = client_with_ports(make_registry_client, reader)
    reader.search_records = [
        SearchRecord(
            kind="entity",
            id="a0000000-0000-4000-8000-000000000001",
            module_id="ports",
            category="facility",
            label="Karachi",
            severity=None,
            t=NOW,
            lon=66.98,
            lat=24.78,
            starred=False,
            identifiers={"wpi": "48600", "unlocode": "PKKHI", "callsign": " "},
        ),
        SearchRecord(
            kind="entity",
            id="a0000000-0000-4000-8000-000000000002",
            module_id="vessels",
            category="vessel",
            label="EVER GIVEN",
            severity=None,
            t=NOW,
            lon=1.0,
            lat=2.0,
            starred=True,
            identifiers={"mmsi": "353136000", "imo": "9811000", "norad_id": 7},
        ),
        SearchRecord(
            kind="event",
            id="earthquakes:1",
            module_id="earthquakes",
            category="earthquake",
            label="Somewhere",
            severity=4.0,
            t=NOW,
            lon=1.0,
            lat=2.0,
            starred=False,
        ),
    ]
    hits = client.get("/v1/search", params={"q": "ka"}).json()["results"]
    assert [h["detail"] for h in hits] == [
        "WPI 48600, UN/LOCODE PKKHI",
        "IMO 9811000, MMSI 353136000, NORAD 7",
        None,
    ]
