from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter
from pydantic import AwareDatetime

from thirdeye.config import Settings
from thirdeye.deps import DefaultOnDep, EnabledDep, ReaderDep, RegistryDep, SettingsDep
from thirdeye.ontology import Domain
from thirdeye.reads import HealthRecord
from thirdeye.registry import Module
from thirdeye.routes.models import HealthState, Out, ProvenanceOut, provenance_out

STALE_AFTER_CADENCES = 3
STALE_AFTER_MIN_SECONDS = 180
DOMAIN_ORDER = {domain: index for index, domain in enumerate(Domain)}

router = APIRouter(tags=["modules"])


class HealthOut(Out):
    state: HealthState
    fetched_at: AwareDatetime | None
    record_count: int
    reason: str | None
    stale_after_seconds: int | None
    cooldown_until: AwareDatetime | None


class ZoomRange(Out):
    min: int
    max: int


class ModuleOut(Out):
    id: str
    name: str
    domain: Domain
    kind: Literal["events", "entities"]
    enabled: bool
    cadence_seconds: int
    zoom_range: ZoomRange | None
    requires_key: bool
    key_env: str | None
    default_filter: Literal["all", "none"]
    viewport: bool
    provenance: ProvenanceOut
    health: HealthOut


def key_env_name(module: Module, settings: Settings) -> str | None:
    names = module.missing_keys(settings) or module.manifest.key_envs
    return names[0] if names else None


def stale_after(cadence_seconds: int) -> timedelta | None:
    if cadence_seconds == 0:
        return None
    return timedelta(
        seconds=max(STALE_AFTER_CADENCES * cadence_seconds, STALE_AFTER_MIN_SECONDS)
    )


def _active_cooldown(record: HealthRecord | None, now: datetime) -> datetime | None:
    if record is None or record.cooldown_until is None:
        return None
    return record.cooldown_until if record.cooldown_until > now else None


def module_state(
    record: HealthRecord | None,
    cadence_seconds: int,
    now: datetime,
    *,
    key_missing: bool = False,
) -> HealthState:
    if key_missing:
        return "missing_key"
    if record is None:
        return "pending"
    if record.cooldown_until is not None and record.cooldown_until > now:
        return "cooldown"
    if record.status == "failed":
        return "failed"
    limit = stale_after(cadence_seconds)
    if limit is not None and now - record.fetched_at > limit:
        return "stale"
    if record.record_count == 0:
        return "empty"
    return "fresh"


def health_out(
    record: HealthRecord | None,
    cadence_seconds: int,
    now: datetime,
    *,
    key_missing: bool = False,
) -> HealthOut:
    limit = stale_after(cadence_seconds)
    return HealthOut(
        state=module_state(record, cadence_seconds, now, key_missing=key_missing),
        fetched_at=None if record is None else record.fetched_at,
        record_count=0 if record is None else record.record_count,
        reason=None if record is None else record.reason,
        stale_after_seconds=None if limit is None else int(limit.total_seconds()),
        cooldown_until=_active_cooldown(record, now),
    )


@router.get("/modules")
async def list_modules(
    reader: ReaderDep,
    enabled: EnabledDep,
    registry: RegistryDep,
    settings: SettingsDep,
    default_on: DefaultOnDep,
) -> list[ModuleOut]:
    health = await reader.health()
    now = datetime.now(UTC)
    ordered = sorted(registry.values(), key=lambda m: DOMAIN_ORDER[m.manifest.domain])
    modules: list[ModuleOut] = []
    for module in ordered:
        manifest = module.manifest
        modules.append(
            ModuleOut(
                id=module.id,
                name=manifest.name,
                domain=manifest.domain,
                kind=manifest.kind,
                enabled=module.id in enabled,
                cadence_seconds=manifest.cadence_seconds,
                zoom_range=(
                    None
                    if manifest.zoom_range is None
                    else ZoomRange(
                        min=manifest.zoom_range[0], max=manifest.zoom_range[1]
                    )
                ),
                requires_key=manifest.requires_key,
                key_env=key_env_name(module, settings),
                default_filter="all" if module.id in default_on else "none",
                viewport=manifest.viewport_lookback_seconds is not None,
                provenance=provenance_out(manifest),
                health=health_out(
                    health.get(module.id),
                    manifest.cadence_seconds,
                    now,
                    key_missing=module.key_missing(settings),
                ),
            )
        )
    return modules
