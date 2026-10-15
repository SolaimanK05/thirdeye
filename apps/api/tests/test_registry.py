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


def entity_manifest(**changes: Any) -> ModuleManifest:
    return ModuleManifest.model_validate(
        manifest_data(id="things", kind="entities", **changes)
    )


async def no_fetch(client: object, settings: object) -> bytes:
    return b""


def test_an_entity_module_must_make_entities() -> None:
    with pytest.raises(RegistryError, match="declared as entities"):
        build_registry([Module(entity_manifest(), no_fetch, lambda raw, at: [])])


def test_an_event_module_cannot_make_entities() -> None:
    module = Module(
        MANIFEST, REGISTRY["earthquakes"].fetch, normalize_entities=lambda raw, at: []
    )
    with pytest.raises(RegistryError, match="declared as events"):
        build_registry([module])


def test_a_module_needs_exactly_one_normaliser() -> None:
    with pytest.raises(RegistryError, match="exactly one"):
        build_registry([Module(MANIFEST, REGISTRY["earthquakes"].fetch)])
    both = Module(
        MANIFEST,
        REGISTRY["earthquakes"].fetch,
        lambda raw, at: [],
        normalize_entities=lambda raw, at: [],
    )
    with pytest.raises(RegistryError, match="exactly one"):
        build_registry([both])


def test_only_a_module_that_is_never_polled_can_skip_fetch() -> None:
    polled = Module(MANIFEST, None, lambda raw, at: [])
    with pytest.raises(RegistryError, match="cadence must be 0"):
        build_registry([polled])
    quiet = Module(
        entity_manifest(cadence_seconds=0), None, normalize_entities=lambda raw, at: []
    )
    assert "things" in build_registry([quiet])


def test_only_event_modules_can_filter_events() -> None:
    module = Module(
        entity_manifest(cadence_seconds=0),
        None,
        normalize_entities=lambda raw, at: [],
        accept=lambda event, settings: True,
    )
    with pytest.raises(RegistryError, match="filters events"):
        build_registry([module])


def test_an_entity_manifest_cannot_use_event_retention() -> None:
    with pytest.raises(ValidationError, match="observation_retention_seconds"):
        entity_manifest(retention_seconds=3600)
    with pytest.raises(ValidationError, match="observation_retention_seconds"):
        entity_manifest(viewport_lookback_seconds=3600)


def test_an_event_manifest_cannot_use_observation_retention() -> None:
    with pytest.raises(ValidationError, match="only for entity modules"):
        ModuleManifest.model_validate(manifest_data(observation_retention_seconds=3600))
    with pytest.raises(ValidationError, match="only for entity modules"):
        ModuleManifest.model_validate(manifest_data(snapshot_window_seconds=60))


def test_ports_is_registered_as_an_entity_module() -> None:
    ports = REGISTRY["ports"]
    assert ports.manifest.kind == "entities"
    assert REGISTRY["earthquakes"].manifest.kind == "events"
