import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from thirdeye.modules.aircraft.manifest import MANIFEST
from thirdeye.modules.aircraft.records import (
    AircraftFormatError,
    normalize_entities,
)
from thirdeye.ontology import Confidence, EntityKind, EntityReport
from thirdeye.registry import REGISTRY

FIXTURE = Path(__file__).parents[1] / "src/thirdeye/modules/aircraft/fixture.json"
NOW = datetime(2026, 10, 26, 6, 0, tzinfo=UTC)


def by_icao24() -> dict[str, EntityReport]:
    reports = normalize_entities(FIXTURE.read_bytes(), NOW)
    return {
        r.entity.identifiers.icao24: r for r in reports if r.entity.identifiers.icao24
    }


def vector(**changes: object) -> list[object]:
    fields: dict[str, object] = {
        "icao24": "abc123",
        "callsign": "TEST1   ",
        "origin_country": "Testland",
        "time_position": 1792051198,
        "last_contact": 1792051199,
        "longitude": 10.0,
        "latitude": 20.0,
        "baro_altitude": 1000.0,
        "on_ground": False,
        "velocity": 100.0,
        "true_track": 90.0,
        "vertical_rate": 0.0,
        "sensors": None,
        "geo_altitude": 1050.0,
        "squawk": "1200",
        "spi": False,
        "position_source": 0,
        "category": 3,
    }
    return list((fields | changes).values())


def body(*vectors: list[object]) -> bytes:
    return json.dumps({"time": 1792051200, "states": list(vectors)}).encode()


def test_aircraft_is_a_keyed_governed_entity_module() -> None:
    module = REGISTRY["aircraft"]
    assert module.manifest is MANIFEST
    assert MANIFEST.kind == "entities"
    assert MANIFEST.requires_key
    assert MANIFEST.key_envs == ("OPENSKY_CLIENT_ID", "OPENSKY_CLIENT_SECRET")
    assert module.governor is not None
    assert module.normalize is None
    assert module.normalize_entities is normalize_entities


def test_the_manifest_names_the_source_and_its_limits() -> None:
    provenance = MANIFEST.provenance
    assert provenance.source_id == "opensky"
    assert provenance.attribution == "OpenSky Network"
    assert provenance.confidence is Confidence.OBSERVED
    assert len(provenance.limitations) >= 3


class TestFixture:
    def test_good_states_become_one_aircraft_each(self) -> None:
        reports = by_icao24()
        assert len(reports) == 11
        assert {r.entity.kind for r in reports.values()} == {EntityKind.AIRCRAFT}

    def test_bad_addresses_positions_and_speeds_are_skipped(self) -> None:
        reports = by_icao24()
        assert "zz9999" not in reports
        assert "0d0a00" not in reports
        assert "70c0de" not in reports

    def test_a_state_without_a_position_makes_no_aircraft(self) -> None:
        assert "c01712" not in by_icao24()

    def test_the_first_of_two_states_for_one_address_wins(self) -> None:
        fix = by_icao24()["71be1a"].fix
        assert fix is not None
        assert fix.geom.lon == pytest.approx(126.8123)

    def test_an_aircraft_carries_identity_telemetry_and_confidence(self) -> None:
        report = by_icao24()["06a0a1"]
        assert report.entity.names == ("QTR8123",)
        assert report.entity.identifiers.icao24 == "06a0a1"
        assert report.entity.identifiers.callsign == "QTR8123"
        assert report.entity.source_id == "opensky"
        assert report.entity.attrs == {
            "on_ground": False,
            "category": 6,
            "squawk": "7612",
            "vertical_rate": 0.33,
            "origin_country": "Qatar",
            "position_source": 0,
        }
        fix = report.fix
        assert fix is not None
        assert fix.t == datetime.fromtimestamp(1792051190, UTC)
        assert fix.geom.lon == pytest.approx(54.3812)
        assert fix.geom.lat == pytest.approx(25.0123)
        assert fix.sog == pytest.approx(480.5, abs=0.1)
        assert fix.cog == pytest.approx(312.5)
        assert fix.alt == pytest.approx(11361.42)
        assert fix.confidence is Confidence.OBSERVED

    def test_geometric_altitude_is_preferred_over_barometric(self) -> None:
        fix = by_icao24()["71be1a"].fix
        assert fix is not None
        assert fix.alt == pytest.approx(10850.76)

    def test_barometric_altitude_is_used_when_there_is_no_geometric_one(self) -> None:
        reports = normalize_entities(
            body(vector(geo_altitude=None, baro_altitude=777.0)), NOW
        )
        fix = reports[0].fix
        assert fix is not None
        assert fix.alt == 777.0

    def test_a_track_of_360_is_north(self) -> None:
        fix = by_icao24()["800a3f"].fix
        assert fix is not None
        assert fix.cog == 0

    def test_a_blank_callsign_leaves_the_aircraft_unnamed(self) -> None:
        report = by_icao24()["4ca2b1"]
        assert report.entity.names == ()
        assert report.entity.identifiers.callsign is None
        assert report.entity.attrs["position_source"] == 2

    def test_an_aircraft_on_the_ground_says_so(self) -> None:
        assert by_icao24()["3c4dd2"].entity.attrs["on_ground"] is True

    def test_an_impossible_squawk_does_not_cost_the_aircraft(self) -> None:
        report = by_icao24()["e4840a"]
        assert "squawk" not in report.entity.attrs

    def test_missing_optional_values_are_left_out(self) -> None:
        report = by_icao24()["a1b2c3"]
        assert "category" not in report.entity.attrs
        report = by_icao24()["3c4dd2"]
        assert "squawk" not in report.entity.attrs
        assert report.fix is not None
        assert report.fix.cog is None

    def test_the_same_bytes_give_the_same_reports(self) -> None:
        assert normalize_entities(FIXTURE.read_bytes(), NOW) == normalize_entities(
            FIXTURE.read_bytes(), NOW
        )


class TestValidation:
    def test_an_address_is_lowercased_and_must_be_six_hex_digits(self) -> None:
        reports = normalize_entities(body(vector(icao24=" ABC123 ")), NOW)
        assert reports[0].entity.identifiers.icao24 == "abc123"
        assert normalize_entities(body(vector(icao24="abc12")), NOW) == []
        assert normalize_entities(body(vector(icao24="abc12g")), NOW) == []

    def test_a_short_vector_is_skipped(self) -> None:
        assert normalize_entities(body(["abc123", "X"]), NOW) == []

    def test_an_extended_vector_and_a_plain_one_both_work(self) -> None:
        plain = vector()[:17]
        assert len(normalize_entities(body(plain), NOW)) == 1
        assert len(normalize_entities(body(vector()), NOW)) == 1

    def test_a_squawk_must_be_four_octal_digits_or_it_is_dropped(self) -> None:
        good = normalize_entities(body(vector(squawk="7700")), NOW)
        assert good[0].entity.attrs["squawk"] == "7700"
        bad = normalize_entities(body(vector(squawk="1289")), NOW)
        assert len(bad) == 1
        assert "squawk" not in bad[0].entity.attrs

    def test_a_category_outside_the_published_range_is_skipped(self) -> None:
        assert normalize_entities(body(vector(category=21)), NOW) == []

    @pytest.mark.parametrize("bad", ["yes", 1, None])
    def test_on_ground_must_be_a_real_boolean(self, bad: object) -> None:
        assert normalize_entities(body(vector(on_ground=bad)), NOW) == []

    def test_a_negative_speed_is_skipped(self) -> None:
        assert normalize_entities(body(vector(velocity=-1.0)), NOW) == []

    def test_a_state_with_no_time_at_all_is_skipped(self) -> None:
        assert (
            normalize_entities(body(vector(time_position=None, last_contact=None)), NOW)
            == []
        )

    def test_the_contact_time_is_used_when_there_is_no_position_time(self) -> None:
        reports = normalize_entities(body(vector(time_position=None)), NOW)
        fix = reports[0].fix
        assert fix is not None
        assert fix.t == datetime.fromtimestamp(1792051199, UTC)

    def test_no_aircraft_at_all_is_an_empty_list(self) -> None:
        assert normalize_entities(b'{"time": 1, "states": null}', NOW) == []
        assert normalize_entities(b'{"time": 1, "states": []}', NOW) == []


class TestDocument:
    @pytest.mark.parametrize(
        ("raw", "message"),
        [
            (b"<html>", "not JSON"),
            (b"[]", "no .states. field"),
            (b'{"time": 1}', "no .states. field"),
            (b'{"states": 3}', "not a list"),
        ],
    )
    def test_a_reply_that_is_not_a_state_list_is_refused(
        self, raw: bytes, message: str
    ) -> None:
        with pytest.raises(AircraftFormatError, match=message):
            normalize_entities(raw, NOW)
