import csv
import io
import logging
from collections.abc import Iterator, MutableMapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx
import structlog
import structlog.testing
from conftest import POOL, Recorder
from pydantic import SecretStr

from thirdeye import worker
from thirdeye.config import Settings
from thirdeye.logs import configure_logging
from thirdeye.modules.earthquakes import source as quake_source
from thirdeye.modules.wildfires import records, source
from thirdeye.modules.wildfires.manifest import MANIFEST
from thirdeye.modules.wildfires.records import FirmsFormatError, normalize
from thirdeye.ontology import Confidence
from thirdeye.registry import REGISTRY, Module

FIXTURE = (
    Path(__file__).parents[1] / "src/thirdeye/modules/wildfires/fixture.csv"
).read_bytes()
QUAKES = (
    Path(__file__).parents[1] / "src/thirdeye/modules/earthquakes/fixture.json"
).read_bytes()
RETRIEVED_AT = datetime(2026, 10, 14, 9, 0, tzinfo=UTC)
KEY = "k3y-0123456789abcdef-SECRET"
DB = "postgresql://t:t@127.0.0.1:1/t"

HEADER = [
    "latitude",
    "longitude",
    "bright_ti4",
    "scan",
    "track",
    "acq_date",
    "acq_time",
    "satellite",
    "instrument",
    "confidence",
    "version",
    "bright_ti5",
    "frp",
    "daynight",
]


def settings_for(**changes: Any) -> Settings:
    data: dict[str, Any] = {"database_url": DB, "_env_file": None} | changes
    return Settings(**data)


def table(*rows: dict[str, str], header: list[str] | None = None) -> bytes:
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=header or HEADER, lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    return out.getvalue().encode()


def row(**changes: str) -> dict[str, str]:
    base = {
        "latitude": "21.84512",
        "longitude": "94.60231",
        "bright_ti4": "343.51",
        "scan": "0.39",
        "track": "0.36",
        "acq_date": "2026-10-13",
        "acq_time": "0712",
        "satellite": "N",
        "instrument": "VIIRS",
        "confidence": "n",
        "version": "2.0NRT",
        "bright_ti5": "298.12",
        "frp": "4.21",
        "daynight": "D",
    }
    return base | changes


@pytest.fixture
def logs(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[MutableMapping[str, Any]]]:
    monkeypatch.setattr(worker, "log", structlog.get_logger())
    monkeypatch.setattr(records, "log", structlog.get_logger())
    with structlog.testing.capture_logs() as captured:
        yield captured


class TestManifest:
    def test_is_registered_and_needs_its_key(self) -> None:
        module = REGISTRY["wildfires"]
        assert module.manifest.requires_key is True
        assert module.manifest.key_envs == ("FIRMS_MAP_KEY",)
        assert module.manifest.cadence_seconds == 10_800
        assert module.manifest.provenance.source_id == "nasa-firms"

    def test_limitations_are_honest(self) -> None:
        text = " ".join(MANIFEST.provenance.limitations).lower()
        assert "not a confirmed fire" in text
        assert "cloud" in text

    def test_key_is_missing_without_the_setting(self) -> None:
        module = REGISTRY["wildfires"]
        assert module.key_missing(settings_for()) is True
        assert module.key_missing(settings_for(firms_map_key=KEY)) is False


class TestNormalize:
    def test_fixture_gives_one_event_per_valid_unique_row(self) -> None:
        events = normalize(FIXTURE, RETRIEVED_AT)
        assert len(events) == 11
        assert len({e.id for e in events}) == len(events)

    def test_event_fields(self) -> None:
        [event] = normalize(table(row()), RETRIEVED_AT)
        assert event.id == "wildfires:n:20261013T0712:21.845:94.602"
        assert event.module_id == "wildfires"
        assert event.category == "thermal-anomaly"
        assert event.geom.lon == 94.60231
        assert event.geom.lat == 21.84512
        assert event.t_start == datetime(2026, 10, 13, 7, 12, tzinfo=UTC)
        assert event.t_end == event.t_start
        assert event.severity == 4.21
        assert event.confidence is Confidence.DERIVED
        assert event.source_id == "nasa-firms"
        assert event.retrieved_at == RETRIEVED_AT
        assert event.attrs == {
            "satellite": "N",
            "instrument": "VIIRS",
            "detection_confidence": "nominal",
            "day_night": "D",
            "brightness_ti4_k": 343.51,
            "brightness_ti5_k": 298.12,
            "frp_mw": 4.21,
            "scan_km": 0.39,
            "track_km": 0.36,
            "version": "2.0NRT",
        }

    def test_longitude_comes_first_in_the_point(self) -> None:
        [event] = normalize(
            table(row(latitude="10.5", longitude="95.25")), RETRIEVED_AT
        )
        assert event.geom.coordinates == (95.25, 10.5)

    def test_short_time_is_zero_padded(self) -> None:
        [event] = normalize(table(row(acq_time="47")), RETRIEVED_AT)
        assert event.t_start == datetime(2026, 10, 13, 0, 47, tzinfo=UTC)

    def test_refetching_overlapping_windows_gives_the_same_ids(self) -> None:
        first = normalize(table(row(), row(latitude="20.1")), RETRIEVED_AT)
        later = normalize(
            table(row(latitude="20.1"), row(), row(latitude="19.9")),
            datetime(2026, 10, 14, 12, 0, tzinfo=UTC),
        )
        assert {e.id for e in first} <= {e.id for e in later}
        assert len(later) == 3

    def test_duplicate_rows_collapse_to_one_event(self) -> None:
        assert len(normalize(table(row(), row()), RETRIEVED_AT)) == 1

    def test_different_satellite_or_time_is_a_different_event(self) -> None:
        events = normalize(
            table(row(), row(satellite="1"), row(acq_time="0713")), RETRIEVED_AT
        )
        assert len({e.id for e in events}) == 3

    def test_blank_optional_values_are_dropped(self) -> None:
        [event] = normalize(
            table(row(frp="", confidence="", bright_ti5="")), RETRIEVED_AT
        )
        assert event.severity is None
        assert "frp_mw" not in event.attrs
        assert "detection_confidence" not in event.attrs

    def test_unknown_confidence_code_is_kept_as_is(self) -> None:
        [event] = normalize(table(row(confidence="x")), RETRIEVED_AT)
        assert event.attrs["detection_confidence"] == "x"

    def test_bad_rows_are_skipped_not_fatal(self) -> None:
        events = normalize(
            table(
                row(latitude="95"),
                row(latitude="abc"),
                row(acq_date="not-a-date"),
                row(acq_time="2575"),
                row(latitude="12.5"),
            ),
            RETRIEVED_AT,
        )
        assert [e.geom.lat for e in events] == [12.5]

    def test_header_only_means_no_detections(self) -> None:
        assert normalize(table(), RETRIEVED_AT) == []

    def test_extra_columns_are_ignored(self) -> None:
        header = [*HEADER, "new_column"]
        data = row() | {"new_column": "surprise"}
        assert len(normalize(table(data, header=header), RETRIEVED_AT)) == 1

    def test_header_names_are_case_and_space_tolerant(self) -> None:
        header = [f" {name.upper()} " for name in HEADER]
        data = {f" {k.upper()} ": v for k, v in row().items()}
        assert len(normalize(table(data, header=header), RETRIEVED_AT)) == 1

    def test_byte_order_mark_is_tolerated(self) -> None:
        assert len(normalize(b"\xef\xbb\xbf" + table(row()), RETRIEVED_AT)) == 1

    def test_renamed_column_fails_clearly(self) -> None:
        header = ["lat" if name == "latitude" else name for name in HEADER]
        data = {("lat" if k == "latitude" else k): v for k, v in row().items()}
        with pytest.raises(FirmsFormatError, match=r"missing columns \['latitude'\]"):
            normalize(table(data, header=header), RETRIEVED_AT)

    def test_empty_body_fails_clearly(self) -> None:
        with pytest.raises(FirmsFormatError, match="no header"):
            normalize(b"", RETRIEVED_AT)


class TestSource:
    URL = (
        "https://firms.modaps.eosdis.nasa.gov/api/area/csv/"
        f"{KEY}/VIIRS_SNPP_NRT/78,5,100,24/2"
    )

    def settings(self) -> Settings:
        return settings_for(firms_map_key=SecretStr(KEY))

    def test_url_uses_key_product_region_and_window(self) -> None:
        assert source.request_url(KEY, self.settings()) == self.URL

    def test_region_follows_the_settings(self) -> None:
        assert source.area(settings_for(region_bbox=(-180, -90, 180, 90))) == "world"
        assert source.area(settings_for(region_bbox=(-180, -60, 180, 90))) == (
            "-180,-60,180,90"
        )
        custom = settings_for(region_bbox=(-10.5, 35, 4.25, 44))
        assert source.area(custom) == "-10.5,35,4.25,44"

    @respx.mock
    async def test_fetch_returns_the_csv(self) -> None:
        route = respx.get(self.URL).mock(
            return_value=httpx.Response(200, content=FIXTURE)
        )
        async with httpx.AsyncClient() as client:
            assert await source.fetch(client, self.settings()) == FIXTURE
        assert route.call_count == 1

    async def test_fetch_without_a_key_makes_no_request(self) -> None:
        with respx.mock(assert_all_called=False) as mock:
            route = mock.get(url__regex=r".*").mock(return_value=httpx.Response(200))
            async with httpx.AsyncClient() as client:
                with pytest.raises(source.FirmsError, match="FIRMS_MAP_KEY is not set"):
                    await source.fetch(client, settings_for())
                with pytest.raises(source.FirmsError, match="FIRMS_MAP_KEY is not set"):
                    await source.fetch(client, settings_for(firms_map_key="  "))
            assert route.call_count == 0

    @respx.mock
    async def test_http_error_hides_the_key(self) -> None:
        respx.get(self.URL).mock(return_value=httpx.Response(403))
        async with httpx.AsyncClient() as client:
            with pytest.raises(source.FirmsError) as caught:
                await source.fetch(client, self.settings())
        message = str(caught.value)
        assert "403" in message
        assert "FIRMS_MAP_KEY" in message
        assert KEY not in message
        assert caught.value.__context__ is None

    @respx.mock
    async def test_server_error_does_not_blame_the_key(self) -> None:
        respx.get(self.URL).mock(return_value=httpx.Response(503))
        async with httpx.AsyncClient() as client:
            with pytest.raises(source.FirmsError) as caught:
                await source.fetch(client, self.settings())
        assert str(caught.value) == "FIRMS answered HTTP 503"

    @respx.mock
    async def test_network_error_hides_the_key(self) -> None:
        respx.get(self.URL).mock(side_effect=httpx.ConnectTimeout(self.URL))
        async with httpx.AsyncClient() as client:
            with pytest.raises(source.FirmsError) as caught:
                await source.fetch(client, self.settings())
        assert str(caught.value) == "request failed: ConnectTimeout"
        assert caught.value.__cause__ is None
        assert caught.value.__suppress_context__ is True

    @respx.mock
    async def test_plain_text_error_with_status_200_is_rejected(self) -> None:
        respx.get(self.URL).mock(
            return_value=httpx.Response(200, text=f"Invalid MAP_KEY {KEY}.")
        )
        async with httpx.AsyncClient() as client:
            with pytest.raises(source.FirmsError, match="did not return CSV") as caught:
                await source.fetch(client, self.settings())
        assert KEY not in str(caught.value)
        assert source.REDACTED in str(caught.value)


class TestKeyNeverLeaks:
    def test_scrub_replaces_every_occurrence(self) -> None:
        settings = settings_for(firms_map_key=KEY)
        text = f"a {KEY} b {KEY}"
        assert worker.scrub(text, settings) == "a [redacted] b [redacted]"

    def test_secret_values_skips_blank_and_missing(self) -> None:
        assert settings_for().secret_values() == []
        assert settings_for(firms_map_key=" ").secret_values() == []
        assert settings_for(firms_map_key=KEY).secret_values() == [KEY]

    def test_repr_and_dump_of_settings_hide_the_key(self) -> None:
        settings = settings_for(firms_map_key=KEY)
        assert KEY not in repr(settings)
        assert KEY not in str(settings.model_dump())
        assert KEY not in settings.model_dump_json()

    @respx.mock
    async def test_a_failing_run_reports_and_logs_without_the_key(
        self, recorder: Recorder, logs: list[MutableMapping[str, Any]]
    ) -> None:
        settings = settings_for(firms_map_key=KEY)
        url = source.request_url(KEY, settings)
        respx.get(url).mock(return_value=httpx.Response(403))
        async with httpx.AsyncClient() as client:
            ok = await worker.tick(REGISTRY["wildfires"], POOL, client, settings)
        assert ok is False
        assert [e["event"] for e in logs] == ["module.failed"]
        [(module_id, reason)] = recorder.failures
        assert module_id == "wildfires"
        assert "403" in reason
        assert KEY not in reason
        assert KEY not in str(logs)

    @respx.mock
    async def test_unexpected_exceptions_are_scrubbed_by_the_worker(
        self, recorder: Recorder, logs: list[MutableMapping[str, Any]]
    ) -> None:
        settings = settings_for(firms_map_key=KEY)

        async def leaky(client: httpx.AsyncClient, settings: Settings) -> bytes:
            raise RuntimeError(f"boom at https://example.test/{KEY}/x")

        module = Module(MANIFEST, leaky, normalize)
        async with httpx.AsyncClient() as client:
            await worker.tick(module, POOL, client, settings)
        assert KEY not in recorder.failures[0][1]
        assert "[redacted]" in recorder.failures[0][1]
        assert [e["event"] for e in logs] == ["module.failed"]
        assert KEY not in str(logs)

    @respx.mock
    async def test_a_good_run_stores_the_fixture_and_logs_without_the_key(
        self, recorder: Recorder, logs: list[MutableMapping[str, Any]]
    ) -> None:
        settings = settings_for(firms_map_key=KEY)
        respx.get(source.request_url(KEY, settings)).mock(
            return_value=httpx.Response(200, content=FIXTURE)
        )
        async with httpx.AsyncClient() as client:
            ok = await worker.tick(REGISTRY["wildfires"], POOL, client, settings)
        assert ok is True
        assert recorder.writes == [("wildfires", 4)]
        assert recorder.snapshot_rows == {"wildfires": False}
        assert [e["event"] for e in logs] == [
            "wildfires.row_rejected",
            "module.filtered",
            "module.ok",
        ]
        assert KEY not in str(logs)

    def test_http_client_loggers_stay_quiet(self) -> None:
        configure_logging(settings_for())
        assert logging.getLogger("httpx").level == logging.WARNING
        assert logging.getLogger("httpcore").level == logging.WARNING

    @respx.mock
    async def test_worker_skips_the_module_without_a_key_and_keeps_going(
        self,
        recorder: Recorder,
        logs: list[MutableMapping[str, Any]],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        class OpenPool:
            async def open(self) -> None:
                return None

            async def close(self) -> None:
                return None

            connection = POOL.connection

        monkeypatch.setattr(worker, "create_pool", lambda settings: OpenPool())
        quakes = respx.get(quake_source.URL).mock(
            return_value=httpx.Response(200, content=QUAKES)
        )
        fires = respx.get(url__startswith=source.BASE_URL).mock(
            return_value=httpx.Response(200, content=FIXTURE)
        )
        code = await worker.run(
            settings_for(modules_enabled=["earthquakes", "wildfires"]), once=True
        )
        assert code == 0
        assert quakes.call_count == 1
        assert fires.call_count == 0
        assert [m for m, _ in recorder.writes] == ["earthquakes"]
        skipped = [e for e in logs if e["event"] == "module.skipped_no_key"]
        assert [(e["module"], e["keys"]) for e in skipped] == [
            ("wildfires", ("FIRMS_MAP_KEY",))
        ]

    @respx.mock
    async def test_worker_runs_the_module_once_the_key_is_set(
        self,
        recorder: Recorder,
        logs: list[MutableMapping[str, Any]],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        class OpenPool:
            async def open(self) -> None:
                return None

            async def close(self) -> None:
                return None

            connection = POOL.connection

        monkeypatch.setattr(worker, "create_pool", lambda settings: OpenPool())
        settings = settings_for(modules_enabled=["wildfires"], firms_map_key=KEY)
        respx.get(source.request_url(KEY, settings)).mock(
            return_value=httpx.Response(200, content=FIXTURE)
        )
        assert await worker.run(settings, once=True) == 0
        assert recorder.writes == [("wildfires", 4)]
        assert KEY not in str(logs)


class TestThreshold:
    def events_for(self, **changes: Any) -> list[Any]:
        settings = settings_for(**changes)
        return [
            e for e in normalize(FIXTURE, RETRIEVED_AT) if records.accept(e, settings)
        ]

    def test_only_high_confidence_passes_by_default(self) -> None:
        kept = self.events_for()
        assert len(kept) == 4
        assert {e.attrs["detection_confidence"] for e in kept} == {"high"}

    def test_nominal_floor_also_lets_nominal_through(self) -> None:
        kept = self.events_for(firms_min_confidence="nominal")
        assert {e.attrs["detection_confidence"] for e in kept} == {"nominal", "high"}
        assert len(kept) > 4

    def test_low_floor_keeps_everything(self) -> None:
        assert len(self.events_for(firms_min_confidence="low")) == 11

    def test_a_power_floor_applies_on_top_of_confidence(self) -> None:
        strong = self.events_for(firms_min_frp_mw=10)
        assert strong
        assert all((e.severity or 0) >= 10 for e in strong)
        assert len(strong) < 4

    def test_a_power_floor_drops_detections_without_power(self) -> None:
        [event] = normalize(table(row(confidence="h", frp="")), RETRIEVED_AT)
        assert records.accept(event, settings_for())
        assert not records.accept(event, settings_for(firms_min_frp_mw=1))

    def test_power_floor_boundary_is_inclusive(self) -> None:
        [event] = normalize(table(row(confidence="h", frp="5")), RETRIEVED_AT)
        assert records.accept(event, settings_for(firms_min_frp_mw=5))
        assert not records.accept(event, settings_for(firms_min_frp_mw=5.01))

    def test_unknown_confidence_never_passes_a_real_floor(self) -> None:
        [event] = normalize(table(row(confidence="x")), RETRIEVED_AT)
        assert not records.accept(event, settings_for(firms_min_confidence="nominal"))
        assert records.accept(event, settings_for(firms_min_confidence="low"))

    @pytest.mark.parametrize(
        "changes",
        [
            {"firms_min_confidence": "medium"},
            {"firms_min_frp_mw": -1},
            {"firms_min_frp_mw": float("nan")},
        ],
    )
    def test_bad_settings_are_rejected(self, changes: dict[str, Any]) -> None:
        with pytest.raises(ValueError):
            settings_for(**changes)

    @respx.mock
    async def test_the_worker_stores_only_what_passes(
        self, recorder: Recorder, logs: list[MutableMapping[str, Any]]
    ) -> None:
        settings = settings_for(firms_map_key=KEY, firms_min_confidence="low")
        respx.get(source.request_url(KEY, settings)).mock(
            return_value=httpx.Response(200, content=FIXTURE)
        )
        async with httpx.AsyncClient() as client:
            await worker.tick(REGISTRY["wildfires"], POOL, client, settings)
        assert recorder.writes == [("wildfires", 11)]
        assert "module.filtered" not in [e["event"] for e in logs]

    @respx.mock
    async def test_the_filter_log_says_how_many_were_dropped(
        self, recorder: Recorder, logs: list[MutableMapping[str, Any]]
    ) -> None:
        settings = settings_for(firms_map_key=KEY)
        respx.get(source.request_url(KEY, settings)).mock(
            return_value=httpx.Response(200, content=FIXTURE)
        )
        async with httpx.AsyncClient() as client:
            await worker.tick(REGISTRY["wildfires"], POOL, client, settings)
        [entry] = [e for e in logs if e["event"] == "module.filtered"]
        assert (entry["kept"], entry["dropped"]) == (4, 7)
        assert KEY not in str(logs)
