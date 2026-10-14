from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import AwareDatetime, JsonValue

from thirdeye.deps import ReaderDep
from thirdeye.ontology import Confidence, EntityKind
from thirdeye.reads import EntityRecord
from thirdeye.registry import REGISTRY
from thirdeye.routes.models import (
    Out,
    Position,
    ProvenanceOut,
    SourceOut,
    provenance_out,
    source_out,
)

router = APIRouter(tags=["entities"])


class ObservationOut(Out):
    t: AwareDatetime
    position: Position
    sog: float | None
    cog: float | None
    alt: float | None
    confidence: Confidence


class EntityDetail(Out):
    id: UUID
    kind: EntityKind
    names: list[str]
    identifiers: dict[str, JsonValue]
    attrs: dict[str, JsonValue]
    first_seen: AwareDatetime
    last_seen: AwareDatetime
    retrieved_at: AwareDatetime
    last_observation: ObservationOut | None
    source: SourceOut
    provenance: ProvenanceOut | None


def last_observation(record: EntityRecord) -> ObservationOut | None:
    if (
        record.obs_t is None
        or record.obs_lon is None
        or record.obs_lat is None
        or record.obs_confidence is None
    ):
        return None
    return ObservationOut(
        t=record.obs_t,
        position=Position(lon=record.obs_lon, lat=record.obs_lat),
        sog=record.obs_sog,
        cog=record.obs_cog,
        alt=record.obs_alt,
        confidence=record.obs_confidence,
    )


def entity_detail(record: EntityRecord) -> EntityDetail:
    module = REGISTRY.get(record.source_module_id)
    return EntityDetail(
        id=record.id,
        kind=record.kind,
        names=record.names,
        identifiers=record.identifiers,
        attrs=record.attrs,
        first_seen=record.first_seen,
        last_seen=record.last_seen,
        retrieved_at=record.retrieved_at,
        last_observation=last_observation(record),
        source=source_out(record),
        provenance=None if module is None else provenance_out(module.manifest),
    )


@router.get("/entities/{entity_id}")
async def get_entity(entity_id: UUID, reader: ReaderDep) -> EntityDetail:
    record = await reader.entity(entity_id)
    if record is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No entity {entity_id}")
    return entity_detail(record)
