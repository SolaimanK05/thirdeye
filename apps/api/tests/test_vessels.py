import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from pydantic import SecretStr, ValidationError

from thirdeye.config import BBox, Settings
from thirdeye.modules.vessels import records, source
from thirdeye.modules.vessels.manifest import MANIFEST
from thirdeye.modules.vessels.mid import MID_COUNTRY, flag_of
from thirdeye.ontology import Confidence, EntityKind, EntityReport

FIXTURE = Path(__file__).parents[1] / "src/thirdeye/modules/vessels/fixture.ndjson"
NOW = datetime(2026, 10, 27, 6, 1, tzinfo=UTC)
EXAMPLE_IMO = "9074729"
OTHER_IMO = "9123453"
THIRD_IMO = "9781231"
TANKER_IMO = "9412347"


def settings_for(**changes: Any) -> Settings:
    data: dict[str, Any] = {
        "database_url": "postgresql://t:t@127.0.0.1:1/t",
        "aisstream_api_key": SecretStr("ais-key-123"),
        "_env_file": None,
    }
    return Settings(**(data | changes))


def lines(*documents: object) -> bytes:
    return b"\n".join(json.dumps(d).encode() for d in documents)


def position(mmsi: int = 405000123, **changes: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "UserID": mmsi,
        "Valid": True,
        "Latitude": 22.2,
        "Longitude": 91.8,
        "Sog": 10.0,
        "Cog": 90.0,
        "TrueHeading": 91,
        "NavigationalStatus": 0,
    } | changes
    return {
        "MessageType": "PositionReport",
        "Message": {"PositionReport": body},
        "MetaData": {
            "ShipName": "ALPHA  ",
            "time_utc": "2026-10-27 06:00:00.5 +0000 UTC",
        },
    }


def one(*documents: object) -> EntityReport:
    found = records.normalize_entities(lines(*documents), NOW)
    assert len(found) == 1
    return found[0]


def by_mmsi(found: list[EntityReport], mmsi: str) -> list[EntityReport]:
    return [r for r in found if r.entity.identifiers.mmsi == mmsi]


@pytest.fixture(scope="module")
def fixture_reports() -> list[EntityReport]:
    return records.normalize_entities(FIXTURE.read_bytes(), NOW)


class TestFixture:
    def test_every_usable_message_becomes_a_report(
        self, fixture_reports: list[EntityReport]
    ) -> None:
        assert len(fixture_reports) == 9
        assert {r.entity.kind for r in fixture_reports} == {EntityKind.VESSEL}
        assert all(r.entity.source_id == "aisstream" for r in fixture_reports)

    def test_bad_messages_do_not_spoil_the_good_ones(
        self, fixture_reports: list[EntityReport]
    ) -> None:
        mmsis = {r.entity.identifiers.mmsi for r in fixture_reports}
        assert mmsis == {
            "405000123",
            "477123456",
            "419000555",
            "338123456",
            "563000999",
        }

    def test_a_position_becomes_an_observed_fix(
        self, fixture_reports: list[EntityReport]
    ) -> None:
        star = next(r for r in by_mmsi(fixture_reports, "405000123") if r.fix)
        assert star.fix is not None
        assert star.fix.confidence is Confidence.OBSERVED
        assert star.fix.geom.coordinates == (91.812, 22.209)
        assert (star.fix.sog, star.fix.cog, star.fix.heading) == (12.1, 188.0, 191)
        assert star.fix.t == datetime(2026, 10, 27, 6, 0, 7, 654321, tzinfo=UTC)
        assert star.entity.names == ("MV EXAMPLE STAR",)
        assert star.entity.attrs["nav_status"] == 0
        assert star.entity.attrs["flag"] == "Bangladesh"

    def test_not_available_values_are_dropped_not_stored(
        self, fixture_reports: list[EntityReport]
    ) -> None:
        trader = next(r for r in by_mmsi(fixture_reports, "477123456") if r.fix)
        assert trader.fix is not None
        assert (trader.fix.sog, trader.fix.cog, trader.fix.heading) == (
            None,
            None,
            None,
        )
        assert "nav_status" not in trader.entity.attrs

    def test_static_data_holds_identity_and_declared_voyage(
        self, fixture_reports: list[EntityReport]
    ) -> None:
        static = next(r for r in by_mmsi(fixture_reports, "405000123") if r.fix is None)
        assert static.entity.identifiers.imo == EXAMPLE_IMO
        assert static.entity.identifiers.callsign == "S2AB1"
        assert static.entity.attrs == {
            "ship_type": "cargo",
            "ship_type_code": 70,
            "length": 190,
            "beam": 32,
            "destination": "CHITTAGONG",
            "eta": "10-29 14:30Z",
            "draught": 9.4,
            "flag": "Bangladesh",
        }

    def test_a_class_b_static_pair_becomes_one_report(
        self, fixture_reports: list[EntityReport]
    ) -> None:
        hawks = [r for r in by_mmsi(fixture_reports, "419000555") if r.fix is None]
        assert len(hawks) == 1
        assert hawks[0].entity.names == ("SEA HAWK",)
        assert hawks[0].entity.identifiers.callsign == "VWXY"
        assert hawks[0].entity.attrs["ship_type"] == "fishing"
        assert hawks[0].entity.attrs["length"] == 14

    def test_an_extended_class_b_report_carries_its_own_statics(
        self, fixture_reports: list[EntityReport]
    ) -> None:
        loris = by_mmsi(fixture_reports, "338123456")[0]
        assert loris.fix is not None
        assert loris.entity.names == ("SLOW LORIS",)
        assert loris.entity.attrs["ship_type"] == "pleasure"

    def test_one_mmsi_with_two_imos_stays_two_reports(
        self, fixture_reports: list[EntityReport]
    ) -> None:
        double = by_mmsi(fixture_reports, "563000999")
        assert sorted(r.entity.identifiers.imo or "" for r in double) == [
            OTHER_IMO,
            THIRD_IMO,
        ]

    def test_statics_come_before_positions(
        self, fixture_reports: list[EntityReport]
    ) -> None:
        flags = [r.fix is None for r in fixture_reports]
        assert flags == sorted(flags, reverse=True)


class TestPositions:
    def test_only_the_latest_position_per_vessel_is_kept(self) -> None:
        early = position()
        early["MetaData"]["time_utc"] = "2026-10-27 06:00:00.0 +0000 UTC"
        late = position(Latitude=22.3)
        late["MetaData"]["time_utc"] = "2026-10-27 06:00:05.0 +0000 UTC"
        report = one(late, early)
        assert report.fix is not None
        assert report.fix.geom.lat == 22.3

    @pytest.mark.parametrize(
        "changes",
        [
            {"Latitude": 91.0},
            {"Longitude": 181.0},
            {"Latitude": 0.0, "Longitude": 0.0},
            {"Valid": False},
            {"UserID": 2470123},
            {"UserID": 970123456},
            {"UserID": 992471234},
            {"UserID": 111405123},
        ],
    )
    def test_unusable_positions_are_skipped(self, changes: dict[str, Any]) -> None:
        assert records.normalize_entities(lines(position(**changes)), NOW) == []

    @pytest.mark.parametrize(
        ("changes", "expected"),
        [
            ({"Sog": 102.3}, None),
            ({"Sog": 102.2}, 102.2),
            ({"Sog": -1.0}, None),
            ({"Sog": 0.0}, 0.0),
        ],
    )
    def test_speed_over_ground(
        self, changes: dict[str, Any], expected: float | None
    ) -> None:
        fix = one(position(**changes)).fix
        assert fix is not None
        assert fix.sog == expected

    @pytest.mark.parametrize(
        ("changes", "course", "heading"),
        [
            ({"Cog": 360.0, "TrueHeading": 511}, None, None),
            ({"Cog": 359.9, "TrueHeading": 359}, 359.9, 359),
            ({"Cog": 0.0, "TrueHeading": 0}, 0.0, 0),
        ],
    )
    def test_course_and_heading(
        self, changes: dict[str, Any], course: float | None, heading: int | None
    ) -> None:
        fix = one(position(**changes)).fix
        assert fix is not None
        assert (fix.cog, fix.heading) == (course, heading)

    def test_the_name_is_cleaned(self) -> None:
        doc = position()
        doc["MetaData"]["ShipName"] = "  MV   TEST@@@@ "
        assert one(doc).entity.names == ("MV TEST",)

    def test_a_blank_name_is_no_name(self) -> None:
        doc = position()
        doc["MetaData"]["ShipName"] = "@@@@   "
        assert one(doc).entity.names == ()

    def test_navigational_status_undefined_is_dropped(self) -> None:
        assert "nav_status" not in one(position(NavigationalStatus=15)).entity.attrs
        assert one(position(NavigationalStatus=5)).entity.attrs["nav_status"] == 5

    def test_a_vessel_gets_a_flag_from_its_mmsi(self) -> None:
        assert one(position(563111111)).entity.attrs["flag"] == "Singapore"

    def test_an_unknown_prefix_gets_no_flag(self) -> None:
        assert "flag" not in one(position(260123456)).entity.attrs


class TestStatics:
    def static(self, **body: Any) -> dict[str, Any]:
        return {
            "MessageType": "ShipStaticData",
            "Message": {"ShipStaticData": {"UserID": 405000123, "Valid": True} | body},
            "MetaData": {"time_utc": "2026-10-27 06:00:00 +0000 UTC"},
        }

    def test_a_valid_imo_is_a_strong_identifier(self) -> None:
        assert one(self.static(ImoNumber=9074729)).entity.identifiers.imo == EXAMPLE_IMO

    @pytest.mark.parametrize("number", [0, 9074720, 907472, 90747290, -9074729])
    def test_an_invalid_imo_is_not_an_identifier(self, number: int) -> None:
        assert (
            one(self.static(ImoNumber=number, Name="X")).entity.identifiers.imo is None
        )

    @pytest.mark.parametrize(
        ("number", "valid"),
        [(9074729, True), (9412347, True), (9123453, True), (9123450, False)],
    )
    def test_imo_check_digit(self, number: int, valid: bool) -> None:
        assert (records.valid_imo(number) is not None) is valid

    @pytest.mark.parametrize(
        ("eta", "expected"),
        [
            ({"Month": 10, "Day": 29, "Hour": 14, "Minute": 30}, "10-29 14:30Z"),
            ({"Month": 10, "Day": 29, "Hour": 24, "Minute": 60}, "10-29"),
            ({"Month": 0, "Day": 0, "Hour": 24, "Minute": 60}, None),
            ({"Month": 13, "Day": 1, "Hour": 1, "Minute": 1}, None),
        ],
    )
    def test_eta(self, eta: dict[str, int], expected: str | None) -> None:
        report = one(self.static(Name="X", Eta=eta))
        assert report.entity.attrs.get("eta") == expected

    def test_dimensions_become_length_and_beam(self) -> None:
        dimension = {"A": 100, "B": 20, "C": 5, "D": 7}
        attrs = one(self.static(Name="X", Dimension=dimension)).entity.attrs
        assert (attrs["length"], attrs["beam"]) == (120, 12)

    def test_zero_dimensions_are_not_stored(self) -> None:
        dimension = {"A": 0, "B": 0, "C": 0, "D": 0}
        attrs = one(self.static(Name="X", Dimension=dimension)).entity.attrs
        assert "length" not in attrs
        assert "beam" not in attrs

    def test_a_static_report_has_no_fix(self) -> None:
        assert one(self.static(Name="X")).fix is None

    def test_a_marked_invalid_static_is_skipped(self) -> None:
        assert records.normalize_entities(lines(self.static(Valid=False)), NOW) == []


class TestShipTypes:
    @pytest.mark.parametrize(
        ("code", "category"),
        [
            (0, None),
            (None, None),
            (30, "fishing"),
            (31, "tug"),
            (52, "tug"),
            (35, "military"),
            (36, "pleasure"),
            (37, "pleasure"),
            (45, "high_speed"),
            (51, "special"),
            (60, "passenger"),
            (69, "passenger"),
            (70, "cargo"),
            (79, "cargo"),
            (80, "tanker"),
            (89, "tanker"),
            (99, "other"),
            (100, None),
            (21, "wing_in_ground"),
            (12, "other"),
        ],
    )
    def test_category(self, code: int | None, category: str | None) -> None:
        assert records.ship_category(code) == category


class TestTimes:
    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            (
                "2026-10-27 06:00:00.123456 +0000 UTC",
                datetime(2026, 10, 27, 6, 0, 0, 123456, tzinfo=UTC),
            ),
            (
                "2026-10-27 06:00:00.123456789 +0000 UTC",
                datetime(2026, 10, 27, 6, 0, 0, 123456, tzinfo=UTC),
            ),
            (
                "2026-10-27 06:00:00 +0000 UTC",
                datetime(2026, 10, 27, 6, 0, 0, tzinfo=UTC),
            ),
            (
                "2026-10-27 08:00:00.5 +0200",
                datetime(2026, 10, 27, 6, 0, 0, 500000, tzinfo=UTC),
            ),
        ],
    )
    def test_parse(self, text: str, expected: datetime) -> None:
        assert records.parse_time(text, NOW) == expected

    @pytest.mark.parametrize(
        "text", [None, "", "yesterday", "2026-13-40 99:00:00 +0000"]
    )
    def test_junk_falls_back_to_the_time_it_arrived(self, text: str | None) -> None:
        assert records.parse_time(text, NOW) == NOW

    def test_a_time_in_the_future_falls_back(self) -> None:
        future = (NOW + timedelta(minutes=5)).strftime("%Y-%m-%d %H:%M:%S +0000 UTC")
        assert records.parse_time(future, NOW) == NOW

    def test_a_small_clock_skew_is_kept(self) -> None:
        skewed = (NOW + timedelta(seconds=20)).strftime("%Y-%m-%d %H:%M:%S +0000 UTC")
        assert records.parse_time(skewed, NOW) == NOW + timedelta(seconds=20)


class TestRobustness:
    def test_garbage_lines_are_skipped(self) -> None:
        raw = b"not json\n\n[]\n" + lines(position())
        assert len(records.normalize_entities(raw, NOW)) == 1

    def test_unknown_message_types_are_ignored(self) -> None:
        doc = {"MessageType": "BaseStationReport", "Message": {"BaseStationReport": {}}}
        assert records.normalize_entities(lines(doc), NOW) == []

    def test_a_message_without_its_body_is_skipped(self) -> None:
        doc = {"MessageType": "PositionReport", "Message": {}}
        assert records.normalize_entities(lines(doc), NOW) == []

    def test_empty_input(self) -> None:
        assert records.normalize_entities(b"", NOW) == []

    def test_non_finite_numbers_are_rejected(self) -> None:
        raw = lines(position()).replace(b'"Sog": 10.0', b'"Sog": NaN')
        assert records.normalize_entities(raw, NOW) == []


class TestFlags:
    @pytest.mark.parametrize(
        ("mmsi", "flag"),
        [
            ("405000123", "Bangladesh"),
            ("477123456", "Hong Kong"),
            ("563000999", "Singapore"),
            ("351000001", "Panama"),
            ("636012345", "Liberia"),
            ("538001234", "Marshall Islands"),
            ("232000001", "United Kingdom"),
            ("366000001", "United States"),
            ("412000001", "China"),
            ("419000555", "India"),
            ("306000001", "Netherlands, Caribbean"),
        ],
    )
    def test_the_first_three_digits_name_a_country(self, mmsi: str, flag: str) -> None:
        assert flag_of(mmsi) == flag

    def test_an_unassigned_prefix_has_no_flag(self) -> None:
        assert flag_of("200000001") is None
        assert flag_of("999000001") is None

    def test_the_table_covers_only_ship_prefixes(self) -> None:
        assert all(201 <= int(mid) <= 775 for mid in MID_COUNTRY)
        assert len(MID_COUNTRY) > 250


class TestSubscription:
    def test_the_message_follows_the_documented_shape(self) -> None:
        settings = settings_for(aisstream_bbox=BBox(80, 5, 100, 25))
        message = json.loads(source.subscription(settings))
        assert message == {
            "APIKey": "ais-key-123",
            "BoundingBoxes": [[[5.0, 80.0], [25.0, 100.0]]],
            "FilterMessageTypes": list(source.MESSAGE_TYPES),
        }

    def test_the_area_defaults_to_the_region(self) -> None:
        settings = settings_for(region_bbox=BBox(-180, -90, 180, 90))
        message = json.loads(source.subscription(settings))
        assert message["BoundingBoxes"] == [[[-90.0, -180.0], [90.0, 180.0]]]

    def test_every_message_type_is_one_the_service_documents(self) -> None:
        assert set(source.MESSAGE_TYPES) <= set(records.HANDLERS)
        assert set(records.HANDLERS) == set(source.MESSAGE_TYPES)

    def test_a_missing_key_is_refused_before_any_connection(self) -> None:
        with pytest.raises(source.AisStreamError, match="AISSTREAM_API_KEY"):
            source.subscription(settings_for(aisstream_api_key=None))


class TestSettings:
    def test_vessel_area_falls_back_to_the_region(self) -> None:
        settings = settings_for(region_bbox=BBox(10, 10, 20, 20))
        assert settings.vessel_bbox == BBox(10, 10, 20, 20)
        assert settings_for(aisstream_bbox=BBox(1, 1, 2, 2)).vessel_bbox == BBox(
            1, 1, 2, 2
        )

    def test_the_vessel_area_is_validated(self) -> None:
        with pytest.raises(ValidationError, match="south"):
            settings_for(aisstream_bbox=BBox(0, 10, 5, 5))

    def test_batch_and_queue_defaults(self) -> None:
        settings = settings_for()
        assert settings.ais_batch_seconds == 5
        assert settings.ais_queue_max == 10_000

    @pytest.mark.parametrize("seconds", [0, 0.5, 61, float("nan")])
    def test_the_batch_interval_has_limits(self, seconds: float) -> None:
        with pytest.raises(ValidationError):
            settings_for(ais_batch_seconds=seconds)

    def test_the_queue_has_a_floor(self) -> None:
        with pytest.raises(ValidationError):
            settings_for(ais_queue_max=10)

    def test_the_url_override_must_be_a_websocket(self) -> None:
        assert settings_for(aisstream_url="ws://127.0.0.1:9").aisstream_url
        assert settings_for(aisstream_url="  ").aisstream_url is None
        with pytest.raises(ValidationError, match="ws://"):
            settings_for(aisstream_url="http://example.org")

    def test_the_key_is_a_secret(self) -> None:
        assert "ais-key-123" in settings_for().secret_values()
        assert "ais-key-123" not in repr(settings_for())


class TestManifest:
    def test_the_self_report_warning_comes_first(self) -> None:
        assert MANIFEST.provenance.limitations[0] == (
            "AIS is self-reported. It can be switched off, spoofed, or set to a false identity."
        )

    def test_it_streams_with_a_longer_delay_than_aircraft(self) -> None:
        assert MANIFEST.cadence_seconds == 0
        assert MANIFEST.render_delay_seconds == 180
        assert MANIFEST.observation_retention_seconds == 3_600
        assert MANIFEST.key_envs == ("AISSTREAM_API_KEY",)
