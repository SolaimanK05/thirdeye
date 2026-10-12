from datetime import UTC, datetime
from typing import Any, Literal

import structlog
from pydantic import BaseModel, ConfigDict, Field, JsonValue, ValidationError

from thirdeye.modules.earthquakes.manifest import MANIFEST
from thirdeye.ontology import Confidence, Event, Point

log = structlog.get_logger()


class Raw(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)


class RawGeometry(Raw):
    type: Literal["Point"]
    coordinates: tuple[float, float, float]


class RawProperties(Raw):
    mag: float | None = None
    place: str | None = None
    time: int
    updated: int | None = None
    url: str | None = None
    status: str | None = None
    tsunami: int = 0
    sig: int | None = None
    mag_type: str | None = Field(default=None, alias="magType")
    type: str = "earthquake"
    title: str | None = None
    alert: str | None = None
    felt: int | None = None


class RawFeature(Raw):
    id: str
    properties: RawProperties
    geometry: RawGeometry


class RawFeed(Raw):
    type: Literal["FeatureCollection"]
    features: list[dict[str, Any]]


def from_epoch_ms(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=UTC)


def to_event(feature: RawFeature, retrieved_at: datetime) -> Event:
    lon, lat, depth_km = feature.geometry.coordinates
    props = feature.properties
    t = from_epoch_ms(props.time)
    details: dict[str, JsonValue] = {
        "depth_km": depth_km,
        "place": props.place,
        "title": props.title,
        "mag_type": props.mag_type,
        "status": props.status,
        "tsunami": bool(props.tsunami),
        "sig": props.sig,
        "felt": props.felt,
        "alert": props.alert,
        "url": props.url,
        "updated": from_epoch_ms(props.updated).isoformat() if props.updated else None,
    }
    return Event(
        id=f"{MANIFEST.id}:{feature.id}",
        module_id=MANIFEST.id,
        category=props.type,
        geom=Point.at(lon, lat),
        t_start=t,
        t_end=t,
        severity=props.mag,
        attrs={k: v for k, v in details.items() if v is not None},
        source_id=MANIFEST.provenance.source_id,
        retrieved_at=retrieved_at,
        confidence=Confidence.OBSERVED,
    )


def normalize(raw: bytes, retrieved_at: datetime) -> list[Event]:
    feed = RawFeed.model_validate_json(raw)
    events: list[Event] = []
    for item in feed.features:
        try:
            events.append(to_event(RawFeature.model_validate(item), retrieved_at))
        except ValidationError as exc:
            log.warning(
                "earthquakes.feature_rejected",
                feature_id=item.get("id"),
                errors=exc.error_count(),
            )
    return events
