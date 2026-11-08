import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx

from thirdeye.config import Settings
from thirdeye.modules.earthquakes import source
from thirdeye.modules.earthquakes.manifest import MANIFEST
from thirdeye.modules.earthquakes.records import normalize
from thirdeye.ontology import Confidence

FIXTURE = (
    Path(__file__).parents[1] / "src/thirdeye/modules/earthquakes/fixture.json"
).read_bytes()
RETRIEVED_AT = datetime(2026, 10, 12, 20, 0, tzinfo=UTC)
SETTINGS = Settings(database_url="postgresql://t:t@127.0.0.1:1/t", _env_file=None)


def feed(*features: dict[str, Any]) -> bytes:
    return json.dumps(
        {"type": "FeatureCollection", "features": list(features)}
    ).encode()


def feature(fid: str = "us1", **props: Any) -> dict[str, Any]:
    properties = {
        "mag": 4.2,
        "place": "Somewhere",
        "time": 1791777600000,
        "type": "earthquake",
    }
    properties.update(props)
    return {
        "type": "Feature",
        "id": fid,
        "properties": properties,
        "geometry": {"type": "Point", "coordinates": [90.4, 23.8, 10.0]},
    }


def test_fixture_normalizes_every_feature() -> None:
    raw = json.loads(FIXTURE)
    events = normalize(FIXTURE, RETRIEVED_AT)
    assert len(events) == len(raw["features"]) > 0
    for event, item in zip(events, raw["features"], strict=True):
        lon, lat, depth = item["geometry"]["coordinates"]
        assert event.id == f"earthquakes:{item['id']}"
        assert event.geom.coordinates == (lon, lat)
        assert event.attrs["depth_km"] == depth
        assert event.severity == item["properties"]["mag"]
        assert event.confidence is Confidence.OBSERVED
        assert event.source_id == MANIFEST.provenance.source_id
        assert event.t_start == datetime.fromtimestamp(
            item["properties"]["time"] / 1000, tz=UTC
        )
        assert event.retrieved_at == RETRIEVED_AT


def test_longitude_comes_first() -> None:
    [event] = normalize(feed(feature()), RETRIEVED_AT)
    assert event.geom.lon == 90.4
    assert event.geom.lat == 23.8


def test_null_magnitude_gives_no_severity() -> None:
    [event] = normalize(feed(feature(mag=None)), RETRIEVED_AT)
    assert event.severity is None


def test_category_comes_from_event_type() -> None:
    [event] = normalize(feed(feature(type="quarry blast")), RETRIEVED_AT)
    assert event.category == "quarry blast"


def test_invalid_feature_is_skipped_not_fatal() -> None:
    bad = feature("bad")
    bad["geometry"]["coordinates"] = [200.0, 23.8, 10.0]
    events = normalize(feed(feature("good"), bad), RETRIEVED_AT)
    assert [e.id for e in events] == ["earthquakes:good"]


def test_broken_feed_raises() -> None:
    with pytest.raises(ValueError):
        normalize(b'{"not": "a feed"}', RETRIEVED_AT)


@respx.mock
async def test_fetch_returns_body() -> None:
    respx.get(source.URL).mock(return_value=httpx.Response(200, content=FIXTURE))
    async with httpx.AsyncClient() as client:
        assert await source.fetch(client, SETTINGS) == FIXTURE


@respx.mock
async def test_fetch_raises_on_http_error() -> None:
    respx.get(source.URL).mock(return_value=httpx.Response(503))
    async with httpx.AsyncClient() as client:
        with pytest.raises(httpx.HTTPStatusError):
            await source.fetch(client, SETTINGS)
