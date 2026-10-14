from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime

import httpx

from thirdeye.config import Settings
from thirdeye.modules.earthquakes import manifest as earthquakes_manifest
from thirdeye.modules.earthquakes import records as earthquakes_records
from thirdeye.modules.earthquakes import source as earthquakes_source
from thirdeye.modules.wildfires import manifest as wildfires_manifest
from thirdeye.modules.wildfires import records as wildfires_records
from thirdeye.modules.wildfires import source as wildfires_source
from thirdeye.ontology import Event, ModuleManifest

type Fetch = Callable[[httpx.AsyncClient, Settings], Awaitable[bytes]]
type Normalize = Callable[[bytes, datetime], list[Event]]
type Accept = Callable[[Event, Settings], bool]


class RegistryError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class Module:
    manifest: ModuleManifest
    fetch: Fetch
    normalize: Normalize
    accept: Accept | None = None

    @property
    def id(self) -> str:
        return self.manifest.id

    def key_missing(self, settings: Settings) -> bool:
        key_env = self.manifest.key_env
        return self.manifest.requires_key and (
            key_env is None or not settings.has_key(key_env)
        )


def build_registry(modules: Iterable[Module]) -> dict[str, Module]:
    registry: dict[str, Module] = {}
    for module in modules:
        if module.id in registry:
            raise RegistryError(f"duplicate module id {module.id!r}")
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
