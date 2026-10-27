import json
import re
from collections import Counter
from collections.abc import Callable, Mapping
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

import structlog
from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    JsonValue,
    ValidationError,
)

from thirdeye.modules.vessels.manifest import MANIFEST
from thirdeye.modules.vessels.mid import flag_of
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

SOG_NOT_AVAILABLE = 102.3
FUTURE_TOLERANCE = timedelta(seconds=60)
REJECTED_LOGGED = 3
NAV_STATUS_UNDEFINED = 15
IMO_DIGITS = 7
MMSI_DIGITS = 9
FIRST_SHIP_MID = 201
LAST_SHIP_MID = 775
TIME_UTC = re.compile(
    r"^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d+))? ([+-]\d{4})(?: UTC)?$"
)

SHIP_CATEGORIES: tuple[tuple[range, str], ...] = (
    (range(20, 30), "wing_in_ground"),
    (range(30, 31), "fishing"),
    (range(31, 33), "tug"),
    (range(33, 35), "special"),
    (range(35, 36), "military"),
    (range(36, 38), "pleasure"),
    (range(40, 50), "high_speed"),
    (range(50, 52), "special"),
    (range(52, 53), "tug"),
    (range(53, 60), "special"),
    (range(60, 70), "passenger"),
    (range(70, 80), "cargo"),
    (range(80, 90), "tanker"),
    (range(90, 100), "other"),
)


def clean_text(value: object) -> object:
    if isinstance(value, str):
        text = " ".join(value.replace("@", " ").split())
        return text or None
    return value


Text = Annotated[str | None, BeforeValidator(clean_text)]
Number = Annotated[float | None, Field(allow_inf_nan=False)]


class Body(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True, populate_by_name=True)


class Dimension(Body):
    a: int = Field(default=0, alias="A")
    b: int = Field(default=0, alias="B")
    c: int = Field(default=0, alias="C")
    d: int = Field(default=0, alias="D")


class Eta(Body):
    month: int = Field(default=0, alias="Month")
    day: int = Field(default=0, alias="Day")
    hour: int = Field(default=24, alias="Hour")
    minute: int = Field(default=60, alias="Minute")


class Meta(Body):
    ship_name: Text = Field(default=None, alias="ShipName")
    time_utc: str | None = None


class PositionBody(Body):
    user_id: int = Field(alias="UserID")
    valid: bool = Field(default=True, alias="Valid")
    latitude: Number = Field(alias="Latitude")
    longitude: Number = Field(alias="Longitude")
    sog: Number = Field(default=None, alias="Sog")
    cog: Number = Field(default=None, alias="Cog")
    true_heading: Number = Field(default=None, alias="TrueHeading")
    navigational_status: int | None = Field(default=None, alias="NavigationalStatus")
    name: Text = Field(default=None, alias="Name")
    ship_type: int | None = Field(default=None, alias="Type")
    dimension: Dimension | None = Field(default=None, alias="Dimension")


class StaticBody(Body):
    user_id: int = Field(alias="UserID")
    valid: bool = Field(default=True, alias="Valid")
    imo_number: int | None = Field(default=None, alias="ImoNumber")
    call_sign: Text = Field(default=None, alias="CallSign")
    name: Text = Field(default=None, alias="Name")
    ship_type: int | None = Field(default=None, alias="Type")
    dimension: Dimension | None = Field(default=None, alias="Dimension")
    eta: Eta | None = Field(default=None, alias="Eta")
    destination: Text = Field(default=None, alias="Destination")
    draught: Number = Field(default=None, alias="MaximumStaticDraught")


class PartA(Body):
    valid: bool = Field(default=True, alias="Valid")
    name: Text = Field(default=None, alias="Name")


class PartB(Body):
    valid: bool = Field(default=True, alias="Valid")
    ship_type: int | None = Field(default=None, alias="ShipType")
    call_sign: Text = Field(default=None, alias="CallSign")
    dimension: Dimension | None = Field(default=None, alias="Dimension")


class ClassBStaticBody(Body):
    user_id: int = Field(alias="UserID")
    valid: bool = Field(default=True, alias="Valid")
    part_number: bool = Field(default=False, alias="PartNumber")
    report_a: PartA | None = Field(default=None, alias="ReportA")
    report_b: PartB | None = Field(default=None, alias="ReportB")


class Skipped(Exception):
    pass


def valid_mmsi(user_id: int) -> str:
    text = f"{user_id:0{MMSI_DIGITS}d}"
    if len(text) != MMSI_DIGITS or not FIRST_SHIP_MID <= int(text[:3]) <= LAST_SHIP_MID:
        raise Skipped("the MMSI is not a ship's")
    return text


def valid_imo(number: int | None) -> str | None:
    if number is None or number <= 0:
        return None
    text = str(number)
    if len(text) != IMO_DIGITS:
        return None
    total = sum(int(digit) * weight for digit, weight in zip(text, range(7, 1, -1)))
    return text if total % 10 == int(text[-1]) else None


def ship_category(code: int | None) -> str | None:
    if code is None or code <= 0 or code > 99:
        return None
    for codes, category in SHIP_CATEGORIES:
        if code in codes:
            return category
    return "other"


def parse_time(text: str | None, fallback: datetime) -> datetime:
    if text is None:
        return fallback
    found = TIME_UTC.match(text.strip())
    if found is None:
        return fallback
    day, clock, fraction, offset = found.groups()
    micro = (fraction or "0")[:6].ljust(6, "0")
    try:
        moment = datetime.strptime(
            f"{day} {clock}.{micro} {offset}", "%Y-%m-%d %H:%M:%S.%f %z"
        )
    except ValueError:
        return fallback
    return fallback if moment - fallback > FUTURE_TOLERANCE else moment.astimezone(UTC)


def dimension_attrs(dimension: Dimension | None) -> dict[str, JsonValue]:
    if dimension is None:
        return {}
    length = dimension.a + dimension.b
    beam = dimension.c + dimension.d
    attrs: dict[str, JsonValue] = {}
    if length > 0:
        attrs["length"] = length
    if beam > 0:
        attrs["beam"] = beam
    return attrs


def type_attrs(code: int | None) -> dict[str, JsonValue]:
    category = ship_category(code)
    if category is None:
        return {}
    return {"ship_type": category, "ship_type_code": code}


def eta_text(eta: Eta | None) -> str | None:
    if eta is None or not (1 <= eta.month <= 12 and 1 <= eta.day <= 31):
        return None
    date = f"{eta.month:02d}-{eta.day:02d}"
    if 0 <= eta.hour <= 23 and 0 <= eta.minute <= 59:
        return f"{date} {eta.hour:02d}:{eta.minute:02d}Z"
    return date


def entity(
    mmsi: str,
    *,
    imo: str | None = None,
    callsign: str | None = None,
    names: tuple[str, ...] = (),
    attrs: Mapping[str, JsonValue],
    seen: datetime,
    retrieved_at: datetime,
) -> Entity:
    flag = flag_of(mmsi)
    merged: dict[str, JsonValue] = dict(attrs)
    if flag is not None:
        merged["flag"] = flag
    return Entity(
        kind=EntityKind.VESSEL,
        names=names,
        identifiers=Identifiers(mmsi=mmsi, imo=imo, callsign=callsign),
        attrs={key: value for key, value in merged.items() if value is not None},
        first_seen=seen,
        last_seen=seen,
        source_id=MANIFEST.provenance.source_id,
        retrieved_at=retrieved_at,
    )


def position_report(
    body: PositionBody, meta: Meta, retrieved_at: datetime
) -> EntityReport:
    mmsi = valid_mmsi(body.user_id)
    if not body.valid:
        raise Skipped("the position report is marked invalid")
    lat, lon = body.latitude, body.longitude
    if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise Skipped("the position is not available")
    if lat == 0 and lon == 0:
        raise Skipped("the position is 0, 0")
    seen = parse_time(meta.time_utc, retrieved_at)
    sog = body.sog
    cog = body.cog
    heading = body.true_heading
    status = body.navigational_status
    name = meta.ship_name or body.name
    attrs: dict[str, JsonValue] = {
        "nav_status": (
            status
            if status is not None and 0 <= status < NAV_STATUS_UNDEFINED
            else None
        ),
        **type_attrs(body.ship_type),
        **dimension_attrs(body.dimension),
    }
    return EntityReport(
        entity=entity(
            mmsi,
            names=() if name is None else (name,),
            attrs=attrs,
            seen=seen,
            retrieved_at=retrieved_at,
        ),
        fix=Fix(
            t=seen,
            geom=Point.at(lon, lat),
            sog=(
                round(sog, 1)
                if sog is not None and 0 <= sog < SOG_NOT_AVAILABLE
                else None
            ),
            cog=round(cog, 1) if cog is not None and 0 <= cog < 360 else None,
            heading=(
                round(heading) if heading is not None and 0 <= heading < 360 else None
            ),
            confidence=Confidence.OBSERVED,
        ),
    )


def static_report(body: StaticBody, meta: Meta, retrieved_at: datetime) -> EntityReport:
    mmsi = valid_mmsi(body.user_id)
    if not body.valid:
        raise Skipped("the static report is marked invalid")
    seen = parse_time(meta.time_utc, retrieved_at)
    name = body.name or meta.ship_name
    attrs: dict[str, JsonValue] = {
        **type_attrs(body.ship_type),
        **dimension_attrs(body.dimension),
        "destination": body.destination,
        "eta": eta_text(body.eta),
        "draught": (
            body.draught if body.draught is not None and body.draught > 0 else None
        ),
    }
    return EntityReport(
        entity=entity(
            mmsi,
            imo=valid_imo(body.imo_number),
            callsign=body.call_sign,
            names=() if name is None else (name,),
            attrs=attrs,
            seen=seen,
            retrieved_at=retrieved_at,
        )
    )


def class_b_static_report(
    body: ClassBStaticBody, meta: Meta, retrieved_at: datetime
) -> EntityReport:
    mmsi = valid_mmsi(body.user_id)
    if not body.valid:
        raise Skipped("the static report is marked invalid")
    part_a = body.report_a if body.report_a and body.report_a.valid else None
    part_b = body.report_b if body.report_b and body.report_b.valid else None
    name = (part_a.name if part_a else None) or meta.ship_name
    attrs: dict[str, JsonValue] = {}
    if part_b is not None:
        attrs |= type_attrs(part_b.ship_type) | dimension_attrs(part_b.dimension)
    if name is None and part_b is None:
        raise Skipped("the static report holds nothing usable")
    return EntityReport(
        entity=entity(
            mmsi,
            callsign=part_b.call_sign if part_b else None,
            names=() if name is None else (name,),
            attrs=attrs,
            seen=parse_time(meta.time_utc, retrieved_at),
            retrieved_at=retrieved_at,
        )
    )


type Build = Callable[[Any, Meta, datetime], EntityReport]
type Handler = tuple[type[Body], Build]

HANDLERS: Mapping[str, Handler] = {
    "PositionReport": (PositionBody, position_report),
    "StandardClassBPositionReport": (PositionBody, position_report),
    "ExtendedClassBPositionReport": (PositionBody, position_report),
    "ShipStaticData": (StaticBody, static_report),
    "StaticDataReport": (ClassBStaticBody, class_b_static_report),
}
POSITION_TYPES = frozenset(
    {"PositionReport", "StandardClassBPositionReport", "ExtendedClassBPositionReport"}
)


def read_message(
    line: bytes, retrieved_at: datetime
) -> tuple[str, EntityReport] | None:
    document = json.loads(line)
    if not isinstance(document, dict):
        raise Skipped("the frame is not a JSON object")
    kind = document.get("MessageType")
    if not isinstance(kind, str):
        return None
    handler = HANDLERS.get(kind)
    if handler is None:
        return None
    body = (document.get("Message") or {}).get(kind)
    if not isinstance(body, dict):
        raise Skipped(f"the {kind} frame has no {kind} body")
    meta = Meta.model_validate(document.get("MetaData") or {})
    model, build = handler
    return kind, build(model.model_validate(body), meta, retrieved_at)


def static_key(report: EntityReport) -> tuple[str, str | None]:
    identifiers = report.entity.identifiers
    return identifiers.mmsi or "", identifiers.imo


def merge_statics(older: EntityReport, newer: EntityReport) -> EntityReport:
    before, after = older.entity, newer.entity
    names = tuple(dict.fromkeys([*after.names, *before.names]))
    identifiers = before.identifiers.model_copy(
        update=after.identifiers.model_dump(exclude_none=True)
    )
    merged = after.model_copy(
        update={
            "names": names,
            "identifiers": identifiers,
            "attrs": {**before.attrs, **after.attrs},
            "first_seen": min(before.first_seen, after.first_seen),
        }
    )
    return EntityReport(entity=merged)


def normalize_entities(raw: bytes, retrieved_at: datetime) -> list[EntityReport]:
    statics: dict[tuple[str, str | None], EntityReport] = {}
    positions: dict[str, EntityReport] = {}
    counts: Counter[str] = Counter()
    for line in raw.splitlines():
        if not line.strip():
            continue
        try:
            found = read_message(line, retrieved_at)
        except Skipped:
            counts["skipped"] += 1
            continue
        except (ValidationError, ValueError) as exc:
            counts["rejected"] += 1
            if counts["rejected"] <= REJECTED_LOGGED:
                log.warning("vessels.message_rejected", reason=_reason(exc))
            continue
        if found is None:
            counts["ignored"] += 1
            continue
        kind, report = found
        mmsi = report.entity.identifiers.mmsi or ""
        if kind in POSITION_TYPES and report.fix is not None:
            known = positions.get(mmsi)
            if known is None or known.fix is None or report.fix.t >= known.fix.t:
                positions[mmsi] = report
        else:
            key = static_key(report)
            known_static = statics.get(key)
            statics[key] = (
                report if known_static is None else merge_statics(known_static, report)
            )
    if counts["rejected"] or counts["skipped"]:
        log.info(
            "vessels.messages_skipped",
            rejected=counts["rejected"],
            unusable=counts["skipped"],
        )
    return [*statics.values(), *positions.values()]


def _reason(exc: ValidationError | ValueError) -> str:
    if isinstance(exc, ValidationError):
        return "; ".join(
            f"{'.'.join(str(part) for part in error['loc'])}: {error['msg']}"
            for error in exc.errors()
        )
    return str(exc)
