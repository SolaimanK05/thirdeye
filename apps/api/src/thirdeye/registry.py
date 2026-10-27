from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime

import httpx

from thirdeye.config import Settings
from thirdeye.governor import Fetched, GovernorSpec
from thirdeye.ingest import entity_stream
from thirdeye.modules.aircraft import manifest as aircraft_manifest
from thirdeye.modules.aircraft import records as aircraft_records
from thirdeye.modules.aircraft import source as aircraft_source
from thirdeye.modules.earthquakes import manifest as earthquakes_manifest
from thirdeye.modules.earthquakes import records as earthquakes_records
from thirdeye.modules.earthquakes import source as earthquakes_source
from thirdeye.modules.ports import manifest as ports_manifest
from thirdeye.modules.ports import records as ports_records
from thirdeye.modules.ports import source as ports_source
from thirdeye.modules.vessels import manifest as vessels_manifest
from thirdeye.modules.vessels import records as vessels_records
from thirdeye.modules.vessels import source as vessels_source
from thirdeye.modules.wildfires import manifest as wildfires_manifest
from thirdeye.modules.wildfires import records as wildfires_records
from thirdeye.modules.wildfires import source as wildfires_source
from thirdeye.ontology import EntityReport, Event, ModuleManifest
from thirdeye.streams import StreamRunner

type Fetch = Callable[[httpx.AsyncClient, Settings], Awaitable[bytes | Fetched]]
type Normalize = Callable[[bytes, datetime], list[Event]]
type NormalizeEntities = Callable[[bytes, datetime], list[EntityReport]]
type Accept = Callable[[Event, Settings], bool]


class RegistryError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class Module:
    manifest: ModuleManifest
    fetch: Fetch | None
    normalize: Normalize | None = None
    accept: Accept | None = None
    normalize_entities: NormalizeEntities | None = None
    governor: GovernorSpec | None = None
    stream: StreamRunner | None = None

    @property
    def id(self) -> str:
        return self.manifest.id

    def missing_keys(self, settings: Settings) -> tuple[str, ...]:
        return tuple(
            name for name in self.manifest.key_envs if not settings.has_key(name)
        )

    def key_missing(self, settings: Settings) -> bool:
        return self.manifest.requires_key and bool(self.missing_keys(settings))


def check_module(module: Module) -> None:
    manifest = module.manifest
    if (module.normalize is None) == (module.normalize_entities is None):
        raise RegistryError(
            f"module {module.id!r} must set exactly one of normalize "
            "and normalize_entities"
        )
    produces = "events" if module.normalize is not None else "entities"
    if manifest.kind != produces:
        raise RegistryError(
            f"module {module.id!r} is declared as {manifest.kind} "
            f"but its normaliser produces {produces}"
        )
    if module.accept is not None and module.normalize is None:
        raise RegistryError(f"module {module.id!r} filters events it never makes")
    if module.governor is not None and (
        module.fetch is None or manifest.cadence_seconds == 0
    ):
        raise RegistryError(f"module {module.id!r} is governed, so it must be polled")
    if module.stream is not None:
        if module.fetch is not None or module.normalize_entities is None:
            raise RegistryError(
                f"module {module.id!r} streams, so it has no fetch and makes entities"
            )
        if manifest.cadence_seconds != 0 or module.governor is not None:
            raise RegistryError(
                f"module {module.id!r} streams, so it is not polled or governed"
            )
    if (module.stream is None) != (manifest.heartbeat_seconds is None):
        raise RegistryError(
            f"module {module.id!r} must have a heartbeat exactly when it streams"
        )
    if module.fetch is None and manifest.cadence_seconds != 0:
        raise RegistryError(
            f"module {module.id!r} has no fetch, so its cadence must be 0"
        )


def build_registry(modules: Iterable[Module]) -> dict[str, Module]:
    registry: dict[str, Module] = {}
    for module in modules:
        if module.id in registry:
            raise RegistryError(f"duplicate module id {module.id!r}")
        check_module(module)
        registry[module.id] = module
    return registry


REGISTRY = build_registry(
    [
        Module(
            earthquakes_manifest.MANIFEST,
            earthquakes_source.fetch,
            earthquakes_records.normalize,
        ),
        Module(
            wildfires_manifest.MANIFEST,
            wildfires_source.fetch,
            wildfires_records.normalize,
            wildfires_records.accept,
        ),
        Module(
            ports_manifest.MANIFEST,
            ports_source.fetch,
            normalize_entities=ports_records.normalize_entities,
        ),
        Module(
            aircraft_manifest.MANIFEST,
            aircraft_source.fetch,
            normalize_entities=aircraft_records.normalize_entities,
            governor=GovernorSpec(
                budget=aircraft_source.daily_budget,
                cost=aircraft_source.credit_cost,
                floor_seconds=float(aircraft_manifest.MANIFEST.cadence_seconds),
            ),
        ),
        Module(
            vessels_manifest.MANIFEST,
            None,
            normalize_entities=vessels_records.normalize_entities,
            stream=entity_stream(
                vessels_manifest.MANIFEST,
                vessels_source.read,
                vessels_records.normalize_entities,
                vessels_source.tuning,
            ),
        ),
    ]
)


def enabled(
    module_ids: Iterable[str], registry: Mapping[str, Module] = REGISTRY
) -> list[Module]:
    wanted = list(dict.fromkeys(module_ids))
    unknown = [m for m in wanted if m not in registry]
    if unknown:
        raise RegistryError(
            f"MODULES_ENABLED lists unknown modules {unknown}; "
            f"known modules are {sorted(registry)}"
        )
    return [registry[m] for m in wanted]


def check_default_on(
    module_ids: Iterable[str], registry: Mapping[str, Module] = REGISTRY
) -> frozenset[str]:
    wanted = frozenset(module_ids)
    unknown = sorted(wanted - registry.keys())
    if unknown:
        raise RegistryError(
            f"MODULES_DEFAULT_ON lists unknown modules {unknown}; "
            f"known modules are {sorted(registry)}"
        )
    return wanted
