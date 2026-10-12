from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime

import httpx

from thirdeye.modules.earthquakes import manifest as earthquakes_manifest
from thirdeye.modules.earthquakes import records as earthquakes_records
from thirdeye.modules.earthquakes import source as earthquakes_source
from thirdeye.ontology import Event, ModuleManifest

type Fetch = Callable[[httpx.AsyncClient], Awaitable[bytes]]
type Normalize = Callable[[bytes, datetime], list[Event]]


class RegistryError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class Module:
    manifest: ModuleManifest
    fetch: Fetch
    normalize: Normalize

    @property
    def id(self) -> str:
        return self.manifest.id


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
