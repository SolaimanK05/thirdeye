from typing import Any

import pytest
from pydantic import ValidationError

from thirdeye.modules.earthquakes.manifest import MANIFEST
from thirdeye.ontology import ModuleManifest
from thirdeye.registry import REGISTRY, Module, RegistryError, build_registry, enabled


def manifest_data(**changes: Any) -> dict[str, Any]:
    data = MANIFEST.model_dump()
    data.update(changes)
    return data


def test_registry_contains_earthquakes() -> None:
    assert REGISTRY["earthquakes"].manifest.cadence_seconds == 60


def test_manifest_needs_two_limitations() -> None:
    provenance = MANIFEST.provenance.model_dump() | {"limitations": ("only one",)}
    with pytest.raises(ValidationError, match="limitations"):
        ModuleManifest.model_validate(manifest_data(provenance=provenance))


def test_manifest_rejects_zoom_outside_one_to_four() -> None:
    with pytest.raises(ValidationError, match="zoom_range"):
        ModuleManifest.model_validate(manifest_data(zoom_range=(0, 4)))


def test_manifest_rejects_inverted_zoom() -> None:
    with pytest.raises(ValidationError, match="zoom_range"):
        ModuleManifest.model_validate(manifest_data(zoom_range=(4, 2)))


def test_duplicate_module_ids_are_rejected() -> None:
    module = REGISTRY["earthquakes"]
    with pytest.raises(RegistryError, match="duplicate"):
        build_registry(
            [module, Module(module.manifest, module.fetch, module.normalize)]
        )


def test_unknown_enabled_module_is_rejected() -> None:
    with pytest.raises(RegistryError, match="unknown modules"):
        enabled(["earthquakes", "unicorns"])


def test_enabled_keeps_order_and_drops_repeats() -> None:
    assert [m.id for m in enabled(["earthquakes", "earthquakes"])] == ["earthquakes"]
