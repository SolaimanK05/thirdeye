import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
import respx

from thirdeye.config import Settings
from thirdeye.modules.satellites import source
from thirdeye.modules.satellites.manifest import MANIFEST
from thirdeye.modules.satellites.records import BadAnswer, normalize_entities
from thirdeye.ontology import Confidence, EntityKind, EntityReport
from thirdeye.registry import REGISTRY

FIXTURE = Path(__file__).parents[1] / "src/thirdeye/modules/satellites/fixture.json"
NOW = datetime(2026, 10, 27, 6, 0, tzinfo=UTC)
SETTINGS = Settings(database_url="postgresql://t:t@127.0.0.1:1/t", _env_file=None)


def omm(**changes: object) -> dict[str, object]:
    base: dict[str, object] = {
        "OBJECT_NAME": "ISS (ZARYA)",
        "OBJECT_ID": "1998-067A",
        "EPOCH": "2026-10-26T12:34:56.123456",
        "MEAN_MOTION": 15.4991,
        "ECCENTRICITY": 0.0006,
        "INCLINATION": 51.6416,
        "RA_OF_ASC_NODE": 120.5,
        "ARG_OF_PERICENTER": 80.1,
        "MEAN_ANOMALY": 280.0,
        "NORAD_CAT_ID": 25544,
        "BSTAR": 0.00025,
    }
    return base | changes


def as_json(*items: dict[str, object]) -> bytes:
    return json.dumps(list(items)).encode()


def reports(*items: dict[str, object]) -> list[EntityReport]:
    return normalize_entities(as_json(*items), NOW)


def test_satellites_is_a_polled_entity_module_that_downloads_daily() -> None:
    module = REGISTRY["satellites"]
    assert module.manifest is MANIFEST
    assert MANIFEST.kind == "entities"
    assert MANIFEST.cadence_seconds == 86_400
    assert MANIFEST.requires_key is False
    assert MANIFEST.provenance.confidence is Confidence.DERIVED


def test_the_worker_is_asked_to_follow_the_celestrak_download_rules() -> None:
    assert MANIFEST.honor_last_fetch is True
    assert MANIFEST.min_retry_seconds == 7_200


def test_the_fixture_is_read_in_full() -> None:
    found = normalize_entities(FIXTURE.read_bytes(), NOW)
    ids = sorted(r.entity.identifiers.norad_id or 0 for r in found)
    assert ids == [20580, 25544, 33591, 35752, 41866, 44713, 270001]


def test_a_report_is_a_satellite_without_a_position() -> None:
    (report,) = reports(omm())
    assert report.entity.kind is EntityKind.SATELLITE
    assert report.fix is None
    assert report.entity.names == ("ISS (ZARYA)",)
    assert report.entity.identifiers.norad_id == 25544
    assert report.entity.source_id == "celestrak"


def test_the_element_set_is_kept_for_the_browser() -> None:
    (report,) = reports(omm())
    kept = report.entity.attrs["omm"]
    assert isinstance(kept, dict)
    assert kept["MEAN_MOTION"] == 15.4991
    assert kept["NORAD_CAT_ID"] == 25544
    assert kept["EPOCH"] == "2026-10-26T12:34:56.123456"


def test_a_six_digit_catalogue_number_is_accepted_and_a_missing_name_is_fine() -> None:
    (report,) = reports(omm(NORAD_CAT_ID=270001, OBJECT_NAME=None, OBJECT_ID=None))
    assert report.entity.identifiers.norad_id == 270001
    assert report.entity.names == ()


@pytest.mark.parametrize(
    "bad",
    [
        {"MEAN_MOTION": 0},
        {"MEAN_MOTION": 25.0},
        {"MEAN_MOTION": float("nan")},
        {"ECCENTRICITY": 1.0},
        {"ECCENTRICITY": -0.1},
        {"INCLINATION": 181},
        {"RA_OF_ASC_NODE": 361},
        {"NORAD_CAT_ID": 0},
        {"NORAD_CAT_ID": 1_000_000_000},
        {"EPOCH": "yesterday"},
        {"EPOCH": (NOW + timedelta(days=30)).isoformat()},
    ],
)
def test_an_implausible_element_set_is_dropped(bad: dict[str, object]) -> None:
    assert reports(omm(**bad), omm(NORAD_CAT_ID=33591)) != []
    assert [r.entity.identifiers.norad_id for r in reports(omm(**bad))] == []


def test_a_record_missing_a_required_field_is_dropped() -> None:
    broken = omm()
    del broken["MEAN_ANOMALY"]
    assert reports(broken) == []


def test_the_newest_epoch_wins_when_a_number_appears_twice() -> None:
    older = omm(EPOCH="2026-10-25T00:00:00", MEAN_MOTION=15.0)
    newer = omm(EPOCH="2026-10-26T00:00:00", MEAN_MOTION=15.5)
    for ordering in ((older, newer), (newer, older)):
        (report,) = reports(*ordering)
        kept = report.entity.attrs["omm"]
        assert isinstance(kept, dict)
        assert kept["MEAN_MOTION"] == 15.5


def test_unknown_fields_are_not_stored() -> None:
    (report,) = reports(omm(SECRET="x", COMMENT="y"))
    kept = report.entity.attrs["omm"]
    assert isinstance(kept, dict)
    assert "SECRET" not in kept
    assert "COMMENT" not in kept


def test_an_answer_that_is_not_json_names_the_likely_cause() -> None:
    with pytest.raises(BadAnswer, match="group name"):
        normalize_entities(b"Invalid query: GROUP=nope", NOW)


def test_an_answer_that_is_not_a_list_is_refused() -> None:
    with pytest.raises(BadAnswer, match="list of element sets"):
        normalize_entities(b'{"error": "x"}', NOW)


def test_an_empty_list_is_valid_and_gives_nothing() -> None:
    assert normalize_entities(b"[]", NOW) == []


async def download(response: httpx.Response, settings: Settings = SETTINGS) -> bytes:
    with respx.mock() as mock:
        route = mock.get(source.request_url(settings)).mock(return_value=response)
        async with httpx.AsyncClient() as client:
            body = await source.fetch(client, settings)
        assert route.call_count == 1
        return body


async def test_the_download_asks_for_the_configured_group_as_json() -> None:
    settings = SETTINGS.model_copy(update={"satellite_group": "stations"})
    with respx.mock() as mock:
        route = mock.get(source.URL).mock(
            return_value=httpx.Response(200, content=as_json(omm()))
        )
        async with httpx.AsyncClient() as client:
            await source.fetch(client, settings)
    assert dict(route.calls.last.request.url.params) == {
        "GROUP": "stations",
        "FORMAT": "json",
    }


async def test_the_download_uses_the_official_host() -> None:
    assert source.URL.startswith("https://celestrak.org/")


async def test_a_good_download_is_returned() -> None:
    raw = await download(httpx.Response(200, content=as_json(omm())))
    assert len(normalize_entities(raw, NOW)) == 1


@pytest.mark.parametrize("code", [301, 403, 404, 500, 503])
async def test_any_other_status_stops_without_a_follow_up_request(code: int) -> None:
    headers = {"location": "https://celestrak.com/x"} if code == 301 else {}
    with pytest.raises(source.CelesTrakError, match=f"HTTP {code}"):
        await download(httpx.Response(code, headers=headers))


async def test_an_oversized_download_is_refused() -> None:
    chunk = b"x" * (1024 * 1024)

    async def stream() -> AsyncIterator[bytes]:
        for _ in range(source.MAX_BYTES // len(chunk) + 2):
            yield chunk

    with pytest.raises(source.CelesTrakError, match="larger than"):
        await download(httpx.Response(200, content=stream()))


async def test_a_test_url_replaces_the_official_one() -> None:
    settings = SETTINGS.model_copy(update={"celestrak_url": "http://127.0.0.1:9/x"})
    assert source.request_url(settings) == "http://127.0.0.1:9/x"
