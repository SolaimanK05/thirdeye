import json
from datetime import UTC, datetime, timedelta
from typing import Annotated

import structlog
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    StringConstraints,
    ValidationError,
    field_validator,
)

from thirdeye.ontology import Entity, EntityKind, EntityReport, Identifiers

log = structlog.get_logger()

SOURCE_ID = "celestrak"
MAX_NORAD_ID = 999_999_999
MAX_MEAN_MOTION = 20.0
EPOCH_FUTURE_TOLERANCE = timedelta(days=2)
REJECTED_LOGGED = 3

Name = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]


class Omm(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    OBJECT_NAME: Name | None = None
    OBJECT_ID: Name | None = None
    EPOCH: str
    MEAN_MOTION: Annotated[float, Field(gt=0, le=MAX_MEAN_MOTION, allow_inf_nan=False)]
    ECCENTRICITY: Annotated[float, Field(ge=0, lt=1, allow_inf_nan=False)]
    INCLINATION: Annotated[float, Field(ge=0, le=180, allow_inf_nan=False)]
    RA_OF_ASC_NODE: Annotated[float, Field(ge=0, le=360, allow_inf_nan=False)]
    ARG_OF_PERICENTER: Annotated[float, Field(ge=0, le=360, allow_inf_nan=False)]
    MEAN_ANOMALY: Annotated[float, Field(ge=0, le=360, allow_inf_nan=False)]
    EPHEMERIS_TYPE: int = 0
    CLASSIFICATION_TYPE: Annotated[str, StringConstraints(max_length=1)] = "U"
    NORAD_CAT_ID: Annotated[int, Field(ge=1, le=MAX_NORAD_ID)]
    ELEMENT_SET_NO: int = 999
    REV_AT_EPOCH: int = 0
    BSTAR: Annotated[float, Field(allow_inf_nan=False)] = 0.0
    MEAN_MOTION_DOT: Annotated[float, Field(allow_inf_nan=False)] = 0.0
    MEAN_MOTION_DDOT: Annotated[float, Field(allow_inf_nan=False)] = 0.0

    @field_validator("EPOCH")
    @classmethod
    def check_epoch(cls, text: str) -> str:
        parse_epoch(text)
        return text


class Skipped(Exception):
    pass


class BadAnswer(ValueError):
    pass


def parse_epoch(text: str) -> datetime:
    try:
        moment = datetime.fromisoformat(text.strip())
    except ValueError:
        raise ValueError(f"EPOCH {text!r} is not an ISO 8601 time") from None
    return (
        moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment.astimezone(UTC)
    )


def omm_attrs(omm: Omm, retrieved_at: datetime) -> dict[str, JsonValue]:
    if parse_epoch(omm.EPOCH) - retrieved_at > EPOCH_FUTURE_TOLERANCE:
        raise Skipped("the element set is dated in the future")
    return omm.model_dump(mode="json", exclude_none=True)


def to_report(omm: Omm, retrieved_at: datetime) -> EntityReport:
    names = () if omm.OBJECT_NAME in (None, "") else (omm.OBJECT_NAME or "",)
    return EntityReport(
        entity=Entity(
            kind=EntityKind.SATELLITE,
            names=names,
            identifiers=Identifiers(norad_id=omm.NORAD_CAT_ID),
            attrs={"omm": omm_attrs(omm, retrieved_at)},
            first_seen=retrieved_at,
            last_seen=retrieved_at,
            source_id=SOURCE_ID,
            retrieved_at=retrieved_at,
        )
    )


def reason(exc: Exception) -> str:
    if isinstance(exc, ValidationError):
        first = exc.errors()[0]
        where = ".".join(str(part) for part in first["loc"]) or "record"
        return f"{where}: {first['msg']}"
    return str(exc)


def normalize_entities(raw: bytes, retrieved_at: datetime) -> list[EntityReport]:
    try:
        document = json.loads(raw)
    except ValueError:
        raise BadAnswer(
            "the CelesTrak answer is not JSON; the group name may be wrong"
        ) from None
    if not isinstance(document, list):
        raise BadAnswer("the CelesTrak answer is not a list of element sets")
    latest: dict[int, tuple[datetime, EntityReport]] = {}
    rejected = 0
    for item in document:
        try:
            omm = Omm.model_validate(item)
            report = to_report(omm, retrieved_at)
        except (ValidationError, Skipped) as exc:
            rejected += 1
            if rejected <= REJECTED_LOGGED:
                log.warning("satellites.record_rejected", reason=reason(exc))
            continue
        epoch = parse_epoch(omm.EPOCH)
        known = latest.get(omm.NORAD_CAT_ID)
        if known is None or epoch > known[0]:
            latest[omm.NORAD_CAT_ID] = (epoch, report)
    if rejected:
        log.warning("satellites.rejected_total", rejected=rejected, kept=len(latest))
    return [report for _, report in latest.values()]
