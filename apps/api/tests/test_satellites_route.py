from collections.abc import Callable, Mapping
from uuid import UUID

from conftest import NOW, FakeReader
from fastapi.testclient import TestClient

from thirdeye.config import Settings
from thirdeye.reads import ElementRecord, SnapshotRecord
from thirdeye.registry import REGISTRY, Module

type MakeRegistryClient = Callable[[Settings, Mapping[str, Module]], TestClient]

URL = "postgresql://test:test@127.0.0.1:1/test"
ISS = UUID("a0000000-0000-4000-8000-000000000001")


def element(norad_id: int, name: str | None = "ISS (ZARYA)") -> ElementRecord:
    return ElementRecord(
        id=ISS if norad_id == 25544 else UUID(int=norad_id),
        norad_id=norad_id,
        name=name,
        omm={
            "EPOCH": "2026-10-26T12:34:56.123456",
            "MEAN_MOTION": 15.4991,
            "NORAD_CAT_ID": norad_id,
        },
    )


def client_for(
    make_registry_client: MakeRegistryClient,
    reader: FakeReader,
    modules: list[str],
    *,
    downloaded: bool = True,
) -> TestClient:
    settings = Settings(database_url=URL, modules_enabled=modules, _env_file=None)
    if downloaded:
        reader.snapshots["satellites"] = SnapshotRecord(payload=[], fetched_at=NOW)
    reader.element_rows = [element(25544), element(33591, None)]
    return make_registry_client(settings, REGISTRY)


def test_the_elements_are_listed_with_their_entity_ids(
    make_registry_client: MakeRegistryClient, reader: FakeReader
) -> None:
    client = client_for(make_registry_client, reader, ["earthquakes", "satellites"])
    response = client.get("/v1/satellites/elements")
    assert response.status_code == 200
    body = response.json()
    assert body["fetched_at"] == NOW.isoformat().replace("+00:00", "Z")
    assert [s["norad_id"] for s in body["satellites"]] == [25544, 33591]
    first = body["satellites"][0]
    assert first["id"] == str(ISS)
    assert first["name"] == "ISS (ZARYA)"
    assert first["omm"]["MEAN_MOTION"] == 15.4991
    assert body["satellites"][1]["name"] is None


def test_the_response_can_be_revalidated_and_is_not_rebuilt(
    make_registry_client: MakeRegistryClient, reader: FakeReader
) -> None:
    client = client_for(make_registry_client, reader, ["satellites"])
    first = client.get("/v1/satellites/elements")
    assert first.headers["cache-control"] == "no-cache"
    assert "last-modified" in first.headers
    etag = first.headers["etag"]
    again = client.get("/v1/satellites/elements", headers={"If-None-Match": etag})
    assert again.status_code == 304
    assert again.headers["etag"] == etag
    assert again.content == b""
    assert reader.element_calls == 1


def test_a_new_download_replaces_the_cached_elements(
    make_registry_client: MakeRegistryClient, reader: FakeReader
) -> None:
    client = client_for(make_registry_client, reader, ["satellites"])
    first = client.get("/v1/satellites/elements")
    later = NOW.replace(day=NOW.day + 1)
    reader.snapshots["satellites"] = SnapshotRecord(payload=[], fetched_at=later)
    reader.element_rows = [element(25544)]
    second = client.get("/v1/satellites/elements")
    assert reader.element_calls == 2
    assert second.headers["etag"] != first.headers["etag"]
    assert len(second.json()["satellites"]) == 1
    stale = client.get(
        "/v1/satellites/elements", headers={"If-None-Match": first.headers["etag"]}
    )
    assert stale.status_code == 200


def test_before_the_first_download_the_list_is_empty(
    make_registry_client: MakeRegistryClient, reader: FakeReader
) -> None:
    client = client_for(make_registry_client, reader, ["satellites"], downloaded=False)
    response = client.get("/v1/satellites/elements")
    assert response.status_code == 200
    assert response.json() == {"fetched_at": None, "satellites": []}


def test_a_module_that_is_not_enabled_is_not_found(
    make_registry_client: MakeRegistryClient, reader: FakeReader
) -> None:
    client = client_for(make_registry_client, reader, ["earthquakes"])
    assert client.get("/v1/satellites/elements").status_code == 404
    assert reader.element_calls == 0


def test_the_route_is_in_the_published_contract(
    make_registry_client: MakeRegistryClient, reader: FakeReader
) -> None:
    client = client_for(make_registry_client, reader, ["satellites"])
    paths = client.get("/openapi.json").json()["paths"]
    assert "/v1/satellites/elements" in paths
