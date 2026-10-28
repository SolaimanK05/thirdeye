from typing import Any

import pytest
from pydantic import ValidationError

from thirdeye.config import Settings
from thirdeye.db import Pool
from thirdeye.modules.earthquakes.manifest import MANIFEST
from thirdeye.ontology import ModuleManifest
from thirdeye.registry import REGISTRY, Module, RegistryError, build_registry, enabled
from thirdeye.streams import Stop


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
    with pytest.raises(ValidationError, match="only for entity modules"):
        ModuleManifest.model_validate(manifest_data(render_delay_seconds=60))


def test_a_render_delay_must_be_positive() -> None:
    assert entity_manifest(render_delay_seconds=105).render_delay_seconds == 105
    assert entity_manifest().render_delay_seconds is None
    with pytest.raises(ValidationError):
        entity_manifest(render_delay_seconds=0)
    with pytest.raises(ValidationError):
        entity_manifest(render_delay_seconds=-5)


def test_only_movers_delay_rendering() -> None:
    delays = {
        module_id: module.manifest.render_delay_seconds
        for module_id, module in REGISTRY.items()
        if module.manifest.render_delay_seconds is not None
    }
    assert delays == {"aircraft": 105, "vessels": 180}


def test_ports_is_registered_as_an_entity_module() -> None:
    ports = REGISTRY["ports"]
    assert ports.manifest.kind == "entities"
    assert REGISTRY["earthquakes"].manifest.kind == "events"


def test_a_governed_module_must_be_polled() -> None:
    spec = REGISTRY["aircraft"].governor
    assert spec is not None
    unpolled = Module(
        entity_manifest(cadence_seconds=0),
        None,
        normalize_entities=lambda raw, at: [],
        governor=spec,
    )
    with pytest.raises(RegistryError, match="governed"):
        build_registry([unpolled])
    no_cadence = Module(
        entity_manifest(cadence_seconds=0),
        REGISTRY["earthquakes"].fetch,
        normalize_entities=lambda raw, at: [],
        governor=spec,
    )
    with pytest.raises(RegistryError, match="governed"):
        build_registry([no_cadence])
    polled = Module(
        entity_manifest(cadence_seconds=30),
        REGISTRY["earthquakes"].fetch,
        normalize_entities=lambda raw, at: [],
        governor=spec,
    )
    assert "things" in build_registry([polled])


def test_aircraft_is_registered_with_a_governor_and_a_fetch() -> None:
    module = REGISTRY["aircraft"]
    assert module.fetch is not None
    assert module.governor is not None
    assert module.governor.floor_seconds == module.manifest.cadence_seconds


def streaming_module(**changes: Any) -> Module:
    async def run(pool: Pool, settings: Settings, stop: Stop) -> None:
        return None

    manifest = entity_manifest(cadence_seconds=0, heartbeat_seconds=60)
    parts: dict[str, Any] = {
        "manifest": manifest,
        "fetch": None,
        "normalize_entities": lambda raw, at: [],
        "stream": run,
    }
    parts.update(changes)
    return Module(
        parts["manifest"],
        parts["fetch"],
        normalize_entities=parts["normalize_entities"],
        stream=parts["stream"],
        governor=parts.get("governor"),
    )


def test_vessels_stream_and_nothing_else_does() -> None:
    streaming = [m.id for m in REGISTRY.values() if m.stream is not None]
    assert streaming == ["vessels"]
    vessels = REGISTRY["vessels"]
    assert vessels.fetch is None
    assert vessels.manifest.cadence_seconds == 0
    assert vessels.manifest.heartbeat_seconds is not None
    assert vessels.key_missing(
        Settings(database_url="postgresql://t:t@127.0.0.1:1/t", _env_file=None)
    )


def test_a_streaming_module_is_accepted() -> None:
    build_registry([streaming_module()])


def test_a_streaming_module_has_no_fetch() -> None:
    with pytest.raises(RegistryError, match="streams"):
        build_registry([streaming_module(fetch=no_fetch)])


def test_a_streaming_module_needs_a_heartbeat() -> None:
    manifest = entity_manifest(cadence_seconds=0)
    with pytest.raises(RegistryError, match="heartbeat"):
        build_registry([streaming_module(manifest=manifest)])


def test_a_heartbeat_without_a_stream_is_refused() -> None:
    manifest = entity_manifest(cadence_seconds=0, heartbeat_seconds=60)
    quiet = Module(manifest, None, normalize_entities=lambda raw, at: [])
    with pytest.raises(RegistryError, match="heartbeat"):
        build_registry([quiet])


def test_a_heartbeat_belongs_to_unpolled_entity_modules() -> None:
    with pytest.raises(ValidationError, match="heartbeat_seconds"):
        entity_manifest(cadence_seconds=30, heartbeat_seconds=60)
    with pytest.raises(ValidationError, match="heartbeat_seconds"):
        ModuleManifest.model_validate(manifest_data(heartbeat_seconds=60))


def test_courtesy_settings_are_only_for_polled_modules() -> None:
    with pytest.raises(ValidationError, match="polled"):
        ModuleManifest(**manifest_data(cadence_seconds=0, honor_last_fetch=True))
    with pytest.raises(ValidationError, match="polled"):
        ModuleManifest(**manifest_data(cadence_seconds=0, min_retry_seconds=60))


def test_a_minimum_retry_interval_must_be_positive() -> None:
    with pytest.raises(ValidationError):
        ModuleManifest(**manifest_data(min_retry_seconds=0))


def test_only_satellites_follow_the_fetch_courtesy_rules() -> None:
    courteous = [m.id for m in REGISTRY.values() if m.manifest.honor_last_fetch]
    assert courteous == ["satellites"]
