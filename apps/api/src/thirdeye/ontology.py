from enum import StrEnum
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    StringConstraints,
    model_validator,
)

Slug = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_-]{1,39}$")]
Longitude = Annotated[float, Field(ge=-180, le=180)]
Latitude = Annotated[float, Field(ge=-90, le=90)]
ZoomLevel = Annotated[int, Field(ge=1, le=4)]
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
EnvName = Annotated[str, StringConstraints(pattern=r"^[A-Z][A-Z0-9_]*$")]


class EntityKind(StrEnum):
    VESSEL = "vessel"
    AIRCRAFT = "aircraft"
    SATELLITE = "satellite"
    FACILITY = "facility"
    ORG = "org"
    PLACE = "place"


class Confidence(StrEnum):
    OBSERVED = "observed"
    REPORTED = "reported"
    DERIVED = "derived"
    INFERRED = "inferred"


class SourceReliability(StrEnum):
    PRIMARY = "primary"
    AGGREGATED = "aggregated"
    DERIVED = "derived"


class Domain(StrEnum):
    EARTH = "earth"
    MOVERS = "movers"
    STREET = "street"
    GEOPOLITICS = "geopolitics"
    INFRASTRUCTURE = "infrastructure"


class Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class Point(Model):
    type: Literal["Point"] = "Point"
    coordinates: tuple[Longitude, Latitude]

    @classmethod
    def at(cls, lon: float, lat: float) -> Self:
        return cls(coordinates=(lon, lat))

    @property
    def lon(self) -> float:
        return self.coordinates[0]

    @property
    def lat(self) -> float:
        return self.coordinates[1]


class Identifiers(Model):
    imo: str | None = None
    mmsi: str | None = None
    icao24: str | None = None
    reg: str | None = None
    callsign: str | None = None
    norad_id: int | None = None
    lei: str | None = None
    osm_id: str | None = None
    wpi: str | None = None
    unlocode: str | None = None


class Source(Model):
    id: Slug
    module_id: Slug
    url: str
    licence: str
    reliability: SourceReliability


class Entity(Model):
    id: UUID | None = None
    kind: EntityKind
    names: tuple[str, ...] = ()
    identifiers: Identifiers = Identifiers()
    attrs: dict[str, JsonValue] = {}
    first_seen: AwareDatetime
    last_seen: AwareDatetime
    source_id: Slug
    retrieved_at: AwareDatetime

    @model_validator(mode="after")
    def check_seen(self) -> Self:
        if self.last_seen < self.first_seen:
            raise ValueError("last_seen must not be before first_seen")
        return self


class Observation(Model):
    entity_id: UUID
    t: AwareDatetime
    source_id: Slug
    geom: Point
    sog: Annotated[float, Field(ge=0)] | None = None
    cog: Annotated[float, Field(ge=0, lt=360)] | None = None
    heading: Annotated[float, Field(ge=0, lt=360)] | None = None
    alt: float | None = None
    confidence: Confidence


class Fix(Model):
    t: AwareDatetime
    geom: Point
    sog: Annotated[float, Field(ge=0)] | None = None
    cog: Annotated[float, Field(ge=0, lt=360)] | None = None
    heading: Annotated[float, Field(ge=0, lt=360)] | None = None
    alt: float | None = None
    confidence: Confidence


class EntityReport(Model):
    entity: Entity
    fix: Fix | None = None


class Event(Model):
    id: Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_-]*:.+$")]
    module_id: Slug
    category: str
    geom: Point
    t_start: AwareDatetime
    t_end: AwareDatetime | None = None
    severity: float | None = None
    attrs: dict[str, JsonValue] = {}
    source_id: Slug
    retrieved_at: AwareDatetime
    confidence: Confidence

    @model_validator(mode="after")
    def check_event(self) -> Self:
        if not self.id.startswith(f"{self.module_id}:"):
            raise ValueError(
                f"event id {self.id!r} must start with '{self.module_id}:'"
            )
        if self.t_end is not None and self.t_end < self.t_start:
            raise ValueError("t_end must not be before t_start")
        return self


class Provenance(Model):
    source_id: Slug
    source: str
    licence: str
    attribution: str
    freshness: str
    confidence: Confidence
    limitations: Annotated[tuple[Text, ...], Field(min_length=2)]


class ModuleManifest(Model):
    id: Slug
    name: str
    domain: Domain
    kind: Literal["events", "entities"] = "events"
    cadence_seconds: Annotated[int, Field(ge=0)]
    zoom_range: tuple[ZoomLevel, ZoomLevel] | None
    requires_key: bool
    key_envs: tuple[EnvName, ...] = ()
    provenance: Provenance
    viewport_lookback_seconds: Annotated[int, Field(gt=0)] | None = None
    retention_seconds: Annotated[int, Field(gt=0)] | None = None
    observation_retention_seconds: Annotated[int, Field(gt=0)] | None = None
    snapshot_window_seconds: Annotated[int, Field(gt=0)] | None = None

    @model_validator(mode="after")
    def check_kind(self) -> Self:
        if self.kind == "entities":
            if (
                self.retention_seconds is not None
                or self.viewport_lookback_seconds is not None
            ):
                raise ValueError(
                    "an entity module keeps observations, not events: use "
                    "observation_retention_seconds instead of retention_seconds "
                    "or viewport_lookback_seconds"
                )
        elif (
            self.observation_retention_seconds is not None
            or self.snapshot_window_seconds is not None
        ):
            raise ValueError(
                "observation_retention_seconds and snapshot_window_seconds "
                "are only for entity modules"
            )
        return self

    @model_validator(mode="after")
    def check_retention(self) -> Self:
        if (
            self.retention_seconds is not None
            and self.viewport_lookback_seconds is not None
            and self.retention_seconds < self.viewport_lookback_seconds
        ):
            raise ValueError(
                "retention_seconds must cover viewport_lookback_seconds, "
                "or the map would ask for rows that were already deleted"
            )
        return self

    @model_validator(mode="after")
    def check_zoom(self) -> Self:
        if self.zoom_range is not None and self.zoom_range[0] > self.zoom_range[1]:
            raise ValueError(f"zoom_range {self.zoom_range} must be (min, max)")
        return self

    @model_validator(mode="after")
    def check_key(self) -> Self:
        if self.requires_key and not self.key_envs:
            raise ValueError("a module that requires a key must name its key_envs")
        if not self.requires_key and self.key_envs:
            raise ValueError("key_envs is only for modules that require a key")
        if len(set(self.key_envs)) != len(self.key_envs):
            raise ValueError("key_envs must not repeat a name")
        return self
