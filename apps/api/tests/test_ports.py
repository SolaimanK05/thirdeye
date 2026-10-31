import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from thirdeye.modules.ports import source as ports_source
from thirdeye.modules.ports.manifest import MANIFEST
from thirdeye.modules.ports.records import (
    PortsFormatError,
    clean_unlocode,
    normalize_entities,
    parse_coordinate,
    parse_dms,
)
from thirdeye.ontology import Confidence, EntityKind, EntityReport
from thirdeye.registry import REGISTRY

FIXTURE = Path(__file__).parents[1] / "src/thirdeye/modules/ports/fixture.csv"
NOW = datetime(2026, 10, 15, 12, 0, tzinfo=UTC)


def by_wpi() -> dict[str, EntityReport]:
    reports = normalize_entities(FIXTURE.read_bytes(), NOW)
    return {r.entity.identifiers.wpi: r for r in reports if r.entity.identifiers.wpi}


def port_json(**changes: object) -> dict[str, object]:
    port: dict[str, object] = {
        "portNumber": 48600,
        "portName": "Karachi",
        "countryCode": "PK",
        "countryName": "Pakistan",
        "regionName": "PAKISTAN",
        "harborSize": "M",
        "harborType": "CN",
        "unloCode": "PK KHI",
        "alternateName": "",
        "latitude": "24°47'00\"N",
        "longitude": "66°59'00\"E",
        "ycoord": 24.783333,
        "xcoord": 66.983333,
    }
    return port | changes


def as_json(*ports: dict[str, object]) -> bytes:
    return json.dumps({"ports": list(ports)}).encode()


def as_csv(header: str, *rows: str) -> bytes:
    return "\n".join([header, *rows]).encode()


def test_ports_is_an_entity_module_the_worker_downloads_weekly() -> None:
    module = REGISTRY["ports"]
    assert module.manifest is MANIFEST
    assert MANIFEST.kind == "entities"
    assert MANIFEST.cadence_seconds == 7 * 24 * 3600
    assert module.fetch is ports_source.fetch
    assert module.normalize is None
    assert module.normalize_entities is normalize_entities


def test_a_failed_download_is_not_retried_for_six_hours() -> None:
    assert MANIFEST.honor_last_fetch is True
    assert MANIFEST.min_retry_seconds == 6 * 3600


def test_the_manifest_names_the_source_and_its_limits() -> None:
    provenance = MANIFEST.provenance
    assert provenance.source_id == "nga-wpi"
    assert provenance.attribution == "NGA"
    assert provenance.confidence is Confidence.REPORTED
    assert len(provenance.limitations) >= 3


class TestFixture:
    def test_every_good_row_becomes_one_facility(self) -> None:
        reports = by_wpi()
        assert len(reports) == 23
        assert {r.entity.kind for r in reports.values()} == {EntityKind.FACILITY}

    def test_the_row_with_an_impossible_latitude_is_skipped(self) -> None:
        assert "99999" not in by_wpi()

    def test_a_port_carries_its_identifiers_names_and_position(self) -> None:
        karachi = by_wpi()["48600"]
        assert karachi.entity.names == ("Karachi",)
        assert karachi.entity.identifiers.unlocode == "PKKHI"
        assert karachi.entity.source_id == "nga-wpi"
        assert karachi.entity.first_seen == NOW
        assert karachi.entity.attrs == {
            "country_code": "PK",
            "country": "Pakistan",
            "region": "PAKISTAN",
            "harbor_size": "M",
            "harbor_type": "CN",
        }
        assert karachi.fix is not None
        assert karachi.fix.t == NOW
        assert karachi.fix.confidence is Confidence.REPORTED
        assert karachi.fix.geom.lon == pytest.approx(66.983333, abs=1e-5)
        assert karachi.fix.geom.lat == pytest.approx(24.783333, abs=1e-5)

    def test_an_alternate_name_follows_the_main_name(self) -> None:
        assert by_wpi()["50000"].entity.names == (
            "Keppel - (East Singapore)",
            "Keppel Harbor",
        )

    def test_a_missing_or_malformed_un_locode_is_dropped_not_fatal(self) -> None:
        reports = by_wpi()
        assert reports["42070"].entity.identifiers.unlocode is None
        assert reports["35600"].entity.identifiers.unlocode is None
        assert reports["38433"].entity.identifiers.unlocode is None

    def test_a_un_locode_loses_its_space(self) -> None:
        assert by_wpi()["46340"].entity.identifiers.unlocode == "GCCOG"

    def test_a_blank_harbour_size_is_left_out(self) -> None:
        assert "harbor_size" not in by_wpi()["61541"].entity.attrs

    def test_minutes_of_sixty_carry_into_the_degree(self) -> None:
        position = by_wpi()["14860"].fix
        assert position is not None
        assert position.geom.lat == pytest.approx(-17.0)
        assert position.geom.lon == pytest.approx(-72.116667, abs=1e-5)

    def test_decimal_seconds_are_kept(self) -> None:
        position = by_wpi()["33400"].fix
        assert position is not None
        assert position.geom.lon == pytest.approx(-(4 + 49 / 60 + 10.04 / 3600))

    def test_importing_the_same_bytes_twice_gives_the_same_reports(self) -> None:
        assert normalize_entities(FIXTURE.read_bytes(), NOW) == normalize_entities(
            FIXTURE.read_bytes(), NOW
        )


class TestCoordinates:
    @pytest.mark.parametrize(
        ("text", "axis", "expected"),
        [
            ("30°20'00\"N", "latitude", 30.333333),
            ("30°20'00\"S", "latitude", -30.333333),
            ("48°17'00\"E", "longitude", 48.283333),
            ("48°17'00\"W", "longitude", -48.283333),
            ("0°00'00\"N", "latitude", 0.0),
            ("10°30'00.5\"E", "longitude", 10.500139),
            ("17°N", "latitude", 17.0),
            ("17°30'N", "latitude", 17.5),
            ("90°00'00\"N", "latitude", 90.0),
            ("180°00'00\"W", "longitude", -180.0),
        ],
    )
    def test_degrees_minutes_seconds(
        self, text: str, axis: str, expected: float
    ) -> None:
        assert parse_dms(text, axis) == pytest.approx(expected, abs=1e-5)

    @pytest.mark.parametrize(
        ("text", "axis"),
        [
            ("30°20'00\"E", "latitude"),
            ("30°20'00\"N", "longitude"),
            ("91°00'00\"N", "latitude"),
            ("181°00'00\"E", "longitude"),
            ("30°61'00\"N", "latitude"),
            ("30°20'61\"N", "latitude"),
            ("90°00'01\"N", "latitude"),
            ("north", "latitude"),
            ("", "latitude"),
        ],
    )
    def test_impossible_positions_are_rejected(self, text: str, axis: str) -> None:
        with pytest.raises(ValueError):
            parse_dms(text, axis)

    def test_plain_decimals_are_accepted_and_range_checked(self) -> None:
        assert parse_coordinate("24.5", "latitude") == 24.5
        assert parse_coordinate(-33.9, "latitude") == -33.9
        with pytest.raises(ValueError, match="out of range"):
            parse_coordinate(95.0, "latitude")
        with pytest.raises(ValueError, match="out of range"):
            parse_coordinate("181", "longitude")

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("PK KHI", "PKKHI"),
            ("pk khi", "PKKHI"),
            ("PKKHI", "PKKHI"),
            ('GB ME"', None),
            (" ", None),
            ("", None),
            (None, None),
            ("P1 KHI", None),
        ],
    )
    def test_un_locode_cleaning(self, raw: str | None, expected: str | None) -> None:
        assert clean_unlocode(raw) == expected


class TestJson:
    def test_a_ports_object_is_read(self) -> None:
        reports = normalize_entities(as_json(port_json()), NOW)
        assert len(reports) == 1
        karachi = reports[0]
        assert karachi.entity.identifiers.wpi == "48600"
        assert karachi.entity.identifiers.unlocode == "PKKHI"
        assert karachi.entity.names == ("Karachi",)

    def test_decimal_coordinates_win_over_the_text_ones(self) -> None:
        report = normalize_entities(as_json(port_json(ycoord=10.0, xcoord=20.0)), NOW)[
            0
        ]
        assert report.fix is not None
        assert (report.fix.geom.lon, report.fix.geom.lat) == (20.0, 10.0)

    def test_text_coordinates_are_used_when_the_decimals_are_missing(self) -> None:
        port = port_json()
        del port["ycoord"], port["xcoord"]
        report = normalize_entities(as_json(port), NOW)[0]
        assert report.fix is not None
        assert report.fix.geom.lat == pytest.approx(24.783333, abs=1e-5)

    def test_a_bad_decimal_falls_back_to_the_text_coordinates(self) -> None:
        report = normalize_entities(as_json(port_json(ycoord=99.0)), NOW)[0]
        assert report.fix is not None
        assert report.fix.geom.lat == pytest.approx(24.783333, abs=1e-5)

    def test_a_bad_record_is_skipped_and_the_rest_kept(self) -> None:
        bad = port_json(portNumber=2, ycoord=None, xcoord=None, latitude="north")
        reports = normalize_entities(as_json(bad, port_json()), NOW)
        assert [r.entity.identifiers.wpi for r in reports] == ["48600"]

    def test_a_repeated_port_number_keeps_the_first(self) -> None:
        reports = normalize_entities(
            as_json(port_json(), port_json(portName="Karachi Again")), NOW
        )
        assert [r.entity.names for r in reports] == [("Karachi",)]

    def test_an_alternate_name_equal_to_the_name_is_not_repeated(self) -> None:
        report = normalize_entities(as_json(port_json(alternateName="KARACHI")), NOW)[0]
        assert report.entity.names == ("Karachi",)

    def test_a_file_without_a_ports_list_is_refused(self) -> None:
        with pytest.raises(PortsFormatError, match="ports"):
            normalize_entities(b'{"data": []}', NOW)
        with pytest.raises(PortsFormatError, match="ports"):
            normalize_entities(b"[1, 2]", NOW)

    def test_an_empty_ports_list_is_refused(self) -> None:
        with pytest.raises(PortsFormatError, match="empty"):
            normalize_entities(b'{"ports": []}', NOW)

    def test_broken_json_is_refused(self) -> None:
        with pytest.raises(PortsFormatError, match="not valid JSON"):
            normalize_entities(b'{"ports": [', NOW)

    def test_missing_fields_are_named(self) -> None:
        port = port_json()
        del port["countryCode"]
        with pytest.raises(PortsFormatError, match="countryCode"):
            normalize_entities(as_json(port), NOW)


class TestCsvFormat:
    HEADER = "portNumber,portName,countryCode,latitude,longitude,"

    def test_the_trailing_empty_column_is_ignored(self) -> None:
        raw = as_csv(self.HEADER, '1,Alpha,GB,"51°00\'00""N","1°00\'00""E",')
        reports = normalize_entities(raw, NOW)
        assert [r.entity.names for r in reports] == [("Alpha",)]

    def test_a_byte_order_mark_is_ignored(self) -> None:
        raw = b"\xef\xbb\xbf" + as_csv(self.HEADER, "1,Alpha,GB,51.5,-0.1,")
        assert len(normalize_entities(raw, NOW)) == 1

    def test_missing_columns_are_named(self) -> None:
        raw = as_csv("portNumber,portName,latitude,longitude", "1,Alpha,51.5,-0.1")
        with pytest.raises(PortsFormatError, match="countryCode"):
            normalize_entities(raw, NOW)

    def test_a_renamed_position_is_reported_as_missing(self) -> None:
        raw = as_csv("portNumber,portName,countryCode,lat,lon", "1,Alpha,GB,1,2")
        with pytest.raises(PortsFormatError, match="latitude and longitude"):
            normalize_entities(raw, NOW)

    def test_an_old_style_header_fails_clearly(self) -> None:
        raw = as_csv(
            "World Port Index Number,Main Port Name,Latitude,Longitude", "1,A,1,2"
        )
        with pytest.raises(PortsFormatError, match="missing"):
            normalize_entities(raw, NOW)

    def test_a_file_without_a_header_row_is_refused(self) -> None:
        with pytest.raises(PortsFormatError, match="no header"):
            normalize_entities(b"", NOW)

    def test_a_file_that_is_not_text_is_refused(self) -> None:
        with pytest.raises(PortsFormatError, match="UTF-8"):
            normalize_entities(b"\xff\xfe\x00\x00", NOW)

    def test_a_row_with_a_blank_name_is_skipped(self) -> None:
        raw = as_csv(self.HEADER, "1,,GB,51.5,-0.1,", "2,Beta,GB,51.5,-0.1,")
        assert [r.entity.identifiers.wpi for r in normalize_entities(raw, NOW)] == ["2"]

    def test_a_row_with_a_bad_country_code_is_skipped(self) -> None:
        raw = as_csv(self.HEADER, "1,Alpha,GBR,51.5,-0.1,", "2,Beta,GB,51.5,-0.1,")
        assert [r.entity.identifiers.wpi for r in normalize_entities(raw, NOW)] == ["2"]
