import csv
import io
import json
import re
from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any, Self

import structlog
from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    JsonValue,
    ValidationError,
    model_validator,
)

from thirdeye.modules.ports.manifest import MANIFEST
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

REQUIRED_FIELDS = ("portNumber", "portName", "countryCode")
POSITION_FIELDS = (("latitude", "longitude"), ("ycoord", "xcoord"))

DMS = re.compile(
    r"""^\s*(?P<deg>\d{1,3})\s*[°º]\s*
        (?:(?P<min>\d{1,2})\s*['′]\s*)?
        (?:(?P<sec>\d{1,2}(?:\.\d+)?)\s*["″]\s*)?
        (?P<hemisphere>[NSEWnsew])\s*$""",
    re.VERBOSE,
)
UNLOCODE = re.compile(r"^[A-Z]{2}[A-Z0-9]{3}$")

HARBOR_SIZES = frozenset("LMSV")


class PortsFormatError(ValueError):
    pass


def blank_to_none(value: object) -> object:
    if value is None:
        return None
    if isinstance(value, str):
        return value.strip() or None
    return value


def as_text(value: object) -> object:
    value = blank_to_none(value)
    if isinstance(value, bool):
        return value
    if isinstance(value, int | float):
        return str(int(value)) if float(value).is_integer() else str(value)
    return value


Text = Annotated[str | None, BeforeValidator(as_text)]
Coordinate = Annotated[float | str | None, BeforeValidator(blank_to_none)]


class RawPort(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    port_number: Annotated[
        str, BeforeValidator(as_text), Field(alias="portNumber", min_length=1)
    ]
    port_name: Annotated[
        str, BeforeValidator(as_text), Field(alias="portName", min_length=1)
    ]
    alternate_name: Annotated[Text, Field(alias="alternateName")] = None
    country_code: Annotated[
        str,
        BeforeValidator(as_text),
        Field(alias="countryCode", pattern=r"^[A-Za-z]{2}$"),
    ]
    country_name: Annotated[Text, Field(alias="countryName")] = None
    region_name: Annotated[Text, Field(alias="regionName")] = None
    unlo_code: Annotated[Text, Field(alias="unloCode")] = None
    harbor_size: Annotated[Text, Field(alias="harborSize")] = None
    harbor_type: Annotated[Text, Field(alias="harborType")] = None
    latitude: Coordinate = None
    longitude: Coordinate = None
    ycoord: Coordinate = None
    xcoord: Coordinate = None

    @model_validator(mode="after")
    def check_position_present(self) -> Self:
        has_dms = self.latitude is not None and self.longitude is not None
        has_decimal = self.ycoord is not None and self.xcoord is not None
        if not has_dms and not has_decimal:
            raise ValueError("port has no position")
        return self


def parse_dms(text: str, axis: str) -> float:
    match = DMS.match(text)
    if match is None:
        raise ValueError(f"{axis} {text!r} is not degrees, minutes, seconds")
    hemisphere = match["hemisphere"].upper()
    if hemisphere not in ("NS" if axis == "latitude" else "EW"):
        raise ValueError(f"{axis} {text!r} has the wrong hemisphere")
    degrees = int(match["deg"])
    minutes = int(match["min"] or 0)
    seconds = float(match["sec"] or 0)
    if minutes > 60 or seconds > 60:
        raise ValueError(f"{axis} {text!r} has minutes or seconds out of range")
    value = degrees + minutes / 60 + seconds / 3600
    limit = 90 if axis == "latitude" else 180
    if value > limit:
        raise ValueError(f"{axis} {text!r} is out of range")
    return round(-value if hemisphere in "SW" else value, 6)


def parse_coordinate(value: float | str, axis: str) -> float:
    if isinstance(value, float | int):
        number = float(value)
    else:
        try:
            number = float(value)
        except ValueError:
            return parse_dms(value, axis)
    limit = 90 if axis == "latitude" else 180
    if not -limit <= number <= limit:
        raise ValueError(f"{axis} {value!r} is out of range")
    return number


def port_position(port: RawPort) -> Point:
    if port.ycoord is not None and port.xcoord is not None:
        try:
            return Point.at(
                parse_coordinate(port.xcoord, "longitude"),
                parse_coordinate(port.ycoord, "latitude"),
            )
        except ValueError:
            if port.latitude is None or port.longitude is None:
                raise
    if port.latitude is None or port.longitude is None:
        raise ValueError("port has no position")
    return Point.at(
        parse_coordinate(port.longitude, "longitude"),
        parse_coordinate(port.latitude, "latitude"),
    )


def clean_unlocode(value: str | None) -> str | None:
    if value is None:
        return None
    code = value.replace(" ", "").upper()
    return code if UNLOCODE.match(code) else None


def names_of(port: RawPort) -> tuple[str, ...]:
    names = [port.port_name]
    alternate = port.alternate_name
    if alternate is not None and alternate.casefold() != port.port_name.casefold():
        names.append(alternate)
    return tuple(names)


def to_report(port: RawPort, retrieved_at: datetime) -> EntityReport:
    size = (port.harbor_size or "").upper()
    attrs: dict[str, JsonValue] = {
        "country_code": port.country_code.upper(),
        "country": port.country_name,
        "region": port.region_name,
        "harbor_size": size if size in HARBOR_SIZES else None,
        "harbor_type": (port.harbor_type or "").upper() or None,
    }
    return EntityReport(
        entity=Entity(
            kind=EntityKind.FACILITY,
            names=names_of(port),
            identifiers=Identifiers(
                wpi=port.port_number, unlocode=clean_unlocode(port.unlo_code)
            ),
            attrs={key: value for key, value in attrs.items() if value is not None},
            first_seen=retrieved_at,
            last_seen=retrieved_at,
            source_id=MANIFEST.provenance.source_id,
            retrieved_at=retrieved_at,
        ),
        fix=Fix(
            t=retrieved_at,
            geom=port_position(port),
            confidence=Confidence.REPORTED,
        ),
    )


def decode(raw: bytes) -> str:
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise PortsFormatError("the file is not UTF-8 text") from None


def check_fields(available: set[str]) -> None:
    missing = [name for name in REQUIRED_FIELDS if name not in available]
    if not any(all(name in available for name in pair) for pair in POSITION_FIELDS):
        missing.append("latitude and longitude (or ycoord and xcoord)")
    if missing:
        raise PortsFormatError(
            f"the World Port Index file is missing {missing}; "
            f"it has {sorted(available)[:12]} and more"
        )


def read_csv(text: str) -> list[Mapping[str, Any]]:
    reader = csv.DictReader(io.StringIO(text, newline=""))
    names = [name.strip() for name in reader.fieldnames or [] if name.strip()]
    if not names:
        raise PortsFormatError("the CSV file has no header row")
    check_fields(set(names))
    return [
        {(key or "").strip(): value for key, value in row.items() if key}
        for row in reader
    ]


def read_json(text: str) -> list[Mapping[str, Any]]:
    try:
        document = json.loads(text)
    except json.JSONDecodeError as exc:
        raise PortsFormatError(f"the JSON file is not valid JSON: {exc.msg}") from None
    ports = document.get("ports") if isinstance(document, dict) else None
    if not isinstance(ports, list):
        raise PortsFormatError('the JSON file has no "ports" list')
    records: list[Mapping[str, Any]] = [
        port for port in ports if isinstance(port, dict)
    ]
    available = {key for record in records for key in record}
    if not records:
        raise PortsFormatError('the JSON file has an empty "ports" list')
    check_fields(available)
    return records


def read_records(raw: bytes) -> list[Mapping[str, Any]]:
    text = decode(raw)
    if text.lstrip().startswith(("{", "[")):
        return read_json(text)
    return read_csv(text)


def normalize_entities(raw: bytes, retrieved_at: datetime) -> list[EntityReport]:
    reports: dict[str, EntityReport] = {}
    rejected: list[str] = []
    for number, record in enumerate(read_records(raw), start=1):
        try:
            report = to_report(RawPort.model_validate(record), retrieved_at)
        except (ValidationError, ValueError) as exc:
            label = str(record.get("portNumber") or f"record {number}")
            rejected.append(label)
            log.warning(
                "ports.record_rejected",
                port=label,
                reason=_reason(exc),
            )
            continue
        wpi = report.entity.identifiers.wpi
        if wpi is not None:
            reports.setdefault(wpi, report)
    if rejected:
        log.warning("ports.records_skipped", count=len(rejected), ports=rejected[:20])
    return list(reports.values())


def _reason(exc: ValidationError | ValueError) -> str:
    if isinstance(exc, ValidationError):
        return "; ".join(
            f"{'.'.join(str(part) for part in error['loc'])}: {error['msg']}"
            for error in exc.errors()
        )
    return str(exc)
