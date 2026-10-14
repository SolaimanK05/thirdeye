import csv
import io
from datetime import UTC, date, datetime, time
from typing import Annotated

import structlog
from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    JsonValue,
    ValidationError,
)

from thirdeye.config import Settings
from thirdeye.modules.wildfires.manifest import MANIFEST
from thirdeye.ontology import Confidence, Event, Point

log = structlog.get_logger()

REQUIRED_COLUMNS = ("latitude", "longitude", "acq_date", "acq_time")

CONFIDENCE_LABEL = {"l": "low", "n": "nominal", "h": "high"}

ID_DECIMALS = 3

CONFIDENCE_RANK = {"low": 0, "nominal": 1, "high": 2}


def blank_to_none(value: object) -> object:
    if isinstance(value, str) and value.strip() == "":
        return None
    return value


class Raw(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)


class RawRow(Raw):
    latitude: Annotated[float, Field(ge=-90, le=90)]
    longitude: Annotated[float, Field(ge=-180, le=180)]
    acq_date: date
    acq_time: Annotated[str, Field(pattern=r"^\d{1,4}$")]
    satellite: Annotated[str | None, BeforeValidator(blank_to_none)] = None
    instrument: Annotated[str | None, BeforeValidator(blank_to_none)] = None
    confidence: Annotated[str | None, BeforeValidator(blank_to_none)] = None
    daynight: Annotated[str | None, BeforeValidator(blank_to_none)] = None
    version: Annotated[str | None, BeforeValidator(blank_to_none)] = None
    bright_ti4: Annotated[float | None, BeforeValidator(blank_to_none)] = None
    bright_ti5: Annotated[float | None, BeforeValidator(blank_to_none)] = None
    frp: Annotated[float | None, BeforeValidator(blank_to_none)] = None
    scan: Annotated[float | None, BeforeValidator(blank_to_none)] = None
    track: Annotated[float | None, BeforeValidator(blank_to_none)] = None


class FirmsFormatError(ValueError):
    pass


def acquired_at(row: RawRow) -> datetime:
    padded = row.acq_time.zfill(4)
    return datetime.combine(
        row.acq_date, time(int(padded[:2]), int(padded[2:])), tzinfo=UTC
    )


def stable_id(row: RawRow, when: datetime) -> str:
    satellite = (row.satellite or "unknown").strip().lower()
    lat = f"{row.latitude:.{ID_DECIMALS}f}"
    lon = f"{row.longitude:.{ID_DECIMALS}f}"
    return f"{MANIFEST.id}:{satellite}:{when:%Y%m%dT%H%M}:{lat}:{lon}"


def to_event(row: RawRow, retrieved_at: datetime) -> Event:
    when = acquired_at(row)
    code = (row.confidence or "").strip().lower()
    details: dict[str, JsonValue] = {
        "satellite": row.satellite,
        "instrument": row.instrument,
        "detection_confidence": CONFIDENCE_LABEL.get(code, code or None),
        "day_night": row.daynight,
        "brightness_ti4_k": row.bright_ti4,
        "brightness_ti5_k": row.bright_ti5,
        "frp_mw": row.frp,
        "scan_km": row.scan,
        "track_km": row.track,
        "version": row.version,
    }
    return Event(
        id=stable_id(row, when),
        module_id=MANIFEST.id,
        category="thermal-anomaly",
        geom=Point.at(row.longitude, row.latitude),
        t_start=when,
        t_end=when,
        severity=row.frp,
        attrs={k: v for k, v in details.items() if v is not None},
        source_id=MANIFEST.provenance.source_id,
        retrieved_at=retrieved_at,
        confidence=Confidence.DERIVED,
    )


def check_header(columns: list[str] | None) -> None:
    if not columns:
        raise FirmsFormatError("FIRMS CSV has no header row")
    missing = [name for name in REQUIRED_COLUMNS if name not in columns]
    if missing:
        raise FirmsFormatError(
            f"FIRMS CSV is missing columns {missing}; got {columns[:20]}"
        )


def normalize(raw: bytes, retrieved_at: datetime) -> list[Event]:
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
    check_header(
        [name.strip().lower() for name in reader.fieldnames]
        if reader.fieldnames
        else None
    )
    events: dict[str, Event] = {}
    for number, record in enumerate(reader, start=2):
        row = {
            (key or "").strip().lower(): value
            for key, value in record.items()
            if isinstance(value, str)
        }
        try:
            event = to_event(RawRow.model_validate(row), retrieved_at)
        except (ValidationError, ValueError) as exc:
            log.warning(
                "wildfires.row_rejected",
                line=number,
                errors=exc.error_count() if isinstance(exc, ValidationError) else 1,
            )
            continue
        events.setdefault(event.id, event)
    return list(events.values())


def accept(event: Event, settings: Settings) -> bool:
    floor = CONFIDENCE_RANK[settings.firms_min_confidence]
    label = event.attrs.get("detection_confidence")
    rank = CONFIDENCE_RANK.get(label, -1) if isinstance(label, str) else -1
    if floor > 0 and rank < floor:
        return False
    minimum = settings.firms_min_frp_mw
    return minimum <= 0 or (event.severity is not None and event.severity >= minimum)
