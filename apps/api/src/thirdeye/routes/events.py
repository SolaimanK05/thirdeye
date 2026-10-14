from fastapi import APIRouter, HTTPException, status
from pydantic import AwareDatetime, JsonValue

from thirdeye.deps import ReaderDep
from thirdeye.ontology import Confidence
from thirdeye.reads import EventRecord
from thirdeye.registry import REGISTRY
from thirdeye.routes.models import (
    Out,
    Position,
    ProvenanceOut,
    SourceOut,
    provenance_out,
    source_out,
)

router = APIRouter(tags=["events"])


class EventDetail(Out):
    id: str
    module_id: str
    category: str
    geometry: dict[str, JsonValue]
    position: Position
    t_start: AwareDatetime
    t_end: AwareDatetime | None
    severity: float | None
    attrs: dict[str, JsonValue]
    confidence: Confidence
    retrieved_at: AwareDatetime
    source: SourceOut
    provenance: ProvenanceOut | None


def event_detail(record: EventRecord) -> EventDetail:
    module = REGISTRY.get(record.module_id)
    return EventDetail(
        id=record.id,
        module_id=record.module_id,
        category=record.category,
        geometry=record.geometry,
        position=Position(lon=record.lon, lat=record.lat),
        t_start=record.t_start,
        t_end=record.t_end,
        severity=record.severity,
        attrs=record.attrs,
        confidence=record.confidence,
        retrieved_at=record.retrieved_at,
        source=source_out(record),
        provenance=None if module is None else provenance_out(module.manifest),
    )


@router.get("/events/{event_id}")
async def get_event(event_id: str, reader: ReaderDep) -> EventDetail:
    record = await reader.event(event_id)
    if record is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No event {event_id!r}")
    return event_detail(record)
