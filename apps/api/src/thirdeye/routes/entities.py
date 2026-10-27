from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import AwareDatetime, JsonValue

from thirdeye.deps import ReaderDep
from thirdeye.ontology import Confidence, EntityKind
from thirdeye.reads import EntityRecord, FixRecord
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
    heading: float | None = None
    alt: float | None
    confidence: Confidence


class FixOut(Out):
    t: AwareDatetime
    position: Position
    sog: float | None
    cog: float | None
    heading: float | None
    alt: float | None
    confidence: Confidence


class FixHistory(Out):
    entity_id: UUID
    fixes: list[FixOut]


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
        heading=record.obs_heading,
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


DEFAULT_FIXES = 120
MAX_FIXES = 500


def fix_out(record: FixRecord) -> FixOut:
    return FixOut(
        t=record.t,
        position=Position(lon=record.lon, lat=record.lat),
        sog=record.sog,
        cog=record.cog,
        heading=record.heading,
        alt=record.alt,
        confidence=record.confidence,
    )


@router.get("/entities/{entity_id}/fixes")
async def get_entity_fixes(
    entity_id: UUID,
    reader: ReaderDep,
    limit: Annotated[int, Query(ge=1, le=MAX_FIXES)] = DEFAULT_FIXES,
) -> FixHistory:
    if await reader.entity(entity_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No entity {entity_id}")
    records = await reader.fixes(entity_id, limit)
    return FixHistory(entity_id=entity_id, fixes=[fix_out(r) for r in records])
