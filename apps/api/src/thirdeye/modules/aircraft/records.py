import json
import re
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Annotated, Any

import structlog
from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    JsonValue,
    StrictBool,
    ValidationError,
    model_validator,
)

from thirdeye.modules.aircraft.manifest import MANIFEST
from thirdeye.ontology import (
    Confidence,
    Entity,
    EntityKind,
    EntityReport,
    Fix,
    Identifiers,
    Point,
)

log = structlog.get_logger()

FIELDS = (
    "icao24",
    "callsign",
    "origin_country",
    "time_position",
    "last_contact",
    "longitude",
    "latitude",
    "baro_altitude",
    "on_ground",
    "velocity",
    "true_track",
    "vertical_rate",
    "sensors",
    "geo_altitude",
    "squawk",
    "spi",
    "position_source",
    "category",
)
REQUIRED_FIELDS = 17
KNOTS_PER_METRE_PER_SECOND = 1.943844
SQUAWK = r"^[0-7]{4}$"


def blank_to_none(value: object) -> object:
    if isinstance(value, str):
        return value.strip() or None
    return value


def lower_hex(value: object) -> object:
    return value.strip().lower() if isinstance(value, str) else value


def clean_squawk(value: object) -> object:
    text = blank_to_none(value)
    if isinstance(text, str) and re.fullmatch(SQUAWK, text):
        return text
    return None


Number = Annotated[float | None, Field(allow_inf_nan=False)]
Text = Annotated[str | None, BeforeValidator(blank_to_none)]
Squawk = Annotated[str | None, BeforeValidator(clean_squawk)]


class RawState(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    icao24: Annotated[str, BeforeValidator(lower_hex), Field(pattern=r"^[0-9a-f]{6}$")]
    callsign: Text = None
    origin_country: Text = None
    time_position: int | None = None
    last_contact: int | None = None
    longitude: Number = None
    latitude: Number = None
    baro_altitude: Number = None
    on_ground: StrictBool = False
    velocity: Annotated[float | None, Field(ge=0, allow_inf_nan=False)] = None
    true_track: Number = None
    vertical_rate: Number = None
    geo_altitude: Number = None
    squawk: Squawk = None
    position_source: int | None = None
    category: Annotated[int | None, Field(ge=0, le=20)] = None

    @model_validator(mode="before")
    @classmethod
    def from_vector(cls, value: object) -> object:
        if isinstance(value, Sequence) and not isinstance(value, str | bytes):
            if len(value) < REQUIRED_FIELDS:
                raise ValueError(
                    f"a state vector has {REQUIRED_FIELDS} fields, this one has {len(value)}"
                )
            return dict(zip(FIELDS, value, strict=False))
        return value


class AircraftFormatError(ValueError):
    pass


def read_states(raw: bytes) -> list[Any]:
    try:
        document = json.loads(raw)
    except ValueError:
        raise AircraftFormatError("the OpenSky reply is not JSON") from None
    if not isinstance(document, dict) or "states" not in document:
        raise AircraftFormatError('the OpenSky reply has no "states" field')
    states = document["states"]
    if states is None:
        return []
    if not isinstance(states, list):
        raise AircraftFormatError('the OpenSky "states" field is not a list')
    return states


def fix_time(state: RawState) -> datetime:
    seconds = (
        state.time_position if state.time_position is not None else state.last_contact
    )
    if seconds is None:
        raise ValueError("state has no time")
    return datetime.fromtimestamp(seconds, UTC)


def to_report(state: RawState, retrieved_at: datetime) -> EntityReport | None:
    if state.longitude is None or state.latitude is None:
        return None
    altitude = (
        state.geo_altitude if state.geo_altitude is not None else state.baro_altitude
    )
    cog = None if state.true_track is None else state.true_track % 360
    attrs: dict[str, JsonValue] = {
        "on_ground": state.on_ground,
        "category": state.category,
        "squawk": state.squawk,
        "vertical_rate": state.vertical_rate,
        "origin_country": state.origin_country,
        "position_source": state.position_source,
    }
    return EntityReport(
        entity=Entity(
            kind=EntityKind.AIRCRAFT,
            names=() if state.callsign is None else (state.callsign,),
            identifiers=Identifiers(icao24=state.icao24, callsign=state.callsign),
            attrs={key: value for key, value in attrs.items() if value is not None},
            first_seen=retrieved_at,
            last_seen=retrieved_at,
            source_id=MANIFEST.provenance.source_id,
            retrieved_at=retrieved_at,
        ),
        fix=Fix(
            t=fix_time(state),
            geom=Point.at(state.longitude, state.latitude),
            sog=(
                None
                if state.velocity is None
                else round(state.velocity * KNOTS_PER_METRE_PER_SECOND, 1)
            ),
            cog=cog,
            alt=altitude,
            confidence=Confidence.OBSERVED,
        ),
    )


def normalize_entities(raw: bytes, retrieved_at: datetime) -> list[EntityReport]:
    reports: dict[str, EntityReport] = {}
    unplaced = 0
    rejected = 0
    for vector in read_states(raw):
        try:
            state = RawState.model_validate(vector)
            report = to_report(state, retrieved_at)
        except (ValidationError, ValueError) as exc:
            rejected += 1
            if rejected <= REJECTED_LOGGED:
                log.warning("aircraft.state_rejected", reason=_reason(exc))
            continue
        if report is None:
            unplaced += 1
            continue
        icao24 = report.entity.identifiers.icao24
        if icao24 is not None:
            reports.setdefault(icao24, report)
    if rejected or unplaced:
        log.info(
            "aircraft.states_skipped", rejected=rejected, without_position=unplaced
        )
    return list(reports.values())


REJECTED_LOGGED = 5


def _reason(exc: ValidationError | ValueError) -> str:
    if isinstance(exc, ValidationError):
        return "; ".join(
            f"{'.'.join(str(part) for part in error['loc'])}: {error['msg']}"
            for error in exc.errors()
        )
    return str(exc)
