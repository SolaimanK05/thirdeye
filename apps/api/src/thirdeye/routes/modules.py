from datetime import UTC, datetime, timedelta

from fastapi import APIRouter
from pydantic import AwareDatetime

from thirdeye.deps import EnabledDep, ReaderDep
from thirdeye.ontology import Domain
from thirdeye.reads import HealthRecord
from thirdeye.registry import REGISTRY
from thirdeye.routes.models import HealthState, Out, ProvenanceOut, provenance_out

STALE_AFTER_CADENCES = 3
STALE_AFTER_MIN_SECONDS = 180

router = APIRouter(tags=["modules"])


class HealthOut(Out):
    state: HealthState
    fetched_at: AwareDatetime | None
    record_count: int
    reason: str | None
    stale_after_seconds: int | None


class ZoomRange(Out):
    min: int
    max: int


class ModuleOut(Out):
    id: str
    name: str
    domain: Domain
    enabled: bool
    cadence_seconds: int
    zoom_range: ZoomRange | None
    requires_key: bool
    provenance: ProvenanceOut
    health: HealthOut


def stale_after(cadence_seconds: int) -> timedelta | None:
    if cadence_seconds == 0:
        return None
    return timedelta(
        seconds=max(STALE_AFTER_CADENCES * cadence_seconds, STALE_AFTER_MIN_SECONDS)
    )


def module_state(
    record: HealthRecord | None, cadence_seconds: int, now: datetime
) -> HealthState:
    if record is None:
        return "pending"
    if record.status == "failed":
        return "failed"
    limit = stale_after(cadence_seconds)
    if limit is not None and now - record.fetched_at > limit:
        return "stale"
    if record.record_count == 0:
        return "empty"
    return "fresh"


def health_out(
    record: HealthRecord | None, cadence_seconds: int, now: datetime
) -> HealthOut:
    limit = stale_after(cadence_seconds)
    return HealthOut(
        state=module_state(record, cadence_seconds, now),
        fetched_at=None if record is None else record.fetched_at,
        record_count=0 if record is None else record.record_count,
        reason=None if record is None else record.reason,
        stale_after_seconds=None if limit is None else int(limit.total_seconds()),
    )


@router.get("/modules")
async def list_modules(reader: ReaderDep, enabled: EnabledDep) -> list[ModuleOut]:
    health = await reader.health()
    now = datetime.now(UTC)
    modules: list[ModuleOut] = []
    for module_id, module in REGISTRY.items():
        manifest = module.manifest
        modules.append(
            ModuleOut(
                id=module_id,
                name=manifest.name,
                domain=manifest.domain,
                enabled=module_id in enabled,
                cadence_seconds=manifest.cadence_seconds,
                zoom_range=(
                    None
                    if manifest.zoom_range is None
                    else ZoomRange(
                        min=manifest.zoom_range[0], max=manifest.zoom_range[1]
                    )
                ),
                requires_key=manifest.requires_key,
                provenance=provenance_out(manifest),
                health=health_out(health.get(module_id), manifest.cadence_seconds, now),
            )
        )
    return modules
