from collections.abc import Callable, Mapping
from typing import Any

import pytest
from conftest import NOW, FakeReader
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from thirdeye import worker
from thirdeye.config import Settings
from thirdeye.modules.earthquakes.manifest import MANIFEST
from thirdeye.ontology import Domain, ModuleManifest
from thirdeye.reads import HealthRecord
from thirdeye.registry import REGISTRY, Module, RegistryError, build_registry

type MakeRegistryClient = Callable[[Settings, Mapping[str, Module]], TestClient]

URL = "postgresql://test:test@127.0.0.1:1/test"


def fake_module(
    module_id: str,
    domain: Domain = Domain.EARTH,
    *,
    key_env: str | None = None,
    cadence_seconds: int = 60,
) -> Module:
    manifest = MANIFEST.model_copy(
        update={
            "id": module_id,
            "name": module_id.title(),
            "domain": domain,
            "requires_key": key_env is not None,
            "key_env": key_env,
            "cadence_seconds": cadence_seconds,
        }
    )
    return Module(manifest, REGISTRY["earthquakes"].fetch, lambda raw, at: [])


def settings_for(**changes: Any) -> Settings:
    data: dict[str, Any] = {"database_url": URL, "_env_file": None} | changes
    return Settings(**data)


def listing(client: TestClient) -> list[dict[str, Any]]:
    response = client.get("/v1/modules")
    assert response.status_code == 200
    body: list[dict[str, Any]] = response.json()
    return body


class TestRegistryEndpoint:
    def test_an_injected_module_is_listed_without_other_changes(
        self, make_registry_client: MakeRegistryClient
    ) -> None:
        registry = build_registry([*REGISTRY.values(), fake_module("fakequake")])
        settings = settings_for(modules_enabled=["earthquakes", "fakequake"])
        body = listing(make_registry_client(settings, registry))
        assert [m["id"] for m in body] == ["earthquakes", "fakequake"]
        assert all(m["enabled"] for m in body)

    def test_modules_are_grouped_by_domain_order(
        self, make_registry_client: MakeRegistryClient
    ) -> None:
        registry = build_registry(
            [
                fake_module("grid", Domain.INFRASTRUCTURE),
                fake_module("boats", Domain.MOVERS),
                fake_module("quakes", Domain.EARTH),
                fake_module("news", Domain.GEOPOLITICS),
                fake_module("cams", Domain.STREET),
                fake_module("fires", Domain.EARTH),
            ]
        )
        body = listing(make_registry_client(settings_for(), registry))
        assert [m["domain"] for m in body] == [
            "earth",
            "earth",
            "movers",
            "street",
            "geopolitics",
            "infrastructure",
        ]
        assert [m["id"] for m in body[:2]] == ["quakes", "fires"]

    def test_unlisted_modules_are_not_enabled(
        self, make_registry_client: MakeRegistryClient
    ) -> None:
        registry = build_registry([*REGISTRY.values(), fake_module("fakequake")])
        body = listing(
            make_registry_client(
                settings_for(modules_enabled=["earthquakes"]), registry
            )
        )
        assert {m["id"]: m["enabled"] for m in body} == {
            "earthquakes": True,
            "fakequake": False,
        }


class TestMissingKey:
    def registry(self) -> Mapping[str, Module]:
        return build_registry([fake_module("fires", key_env="FIRMS_MAP_KEY")])

    def test_module_without_its_key_reports_missing_key(
        self, make_registry_client: MakeRegistryClient, reader: FakeReader
    ) -> None:
        reader.health_rows = {
            "fires": HealthRecord(
                module_id="fires",
                status="ok",
                fetched_at=NOW,
                record_count=5,
                reason=None,
            ),
        }
        settings = settings_for(modules_enabled=["fires"])
        [fires] = listing(make_registry_client(settings, self.registry()))
        assert fires["health"]["state"] == "missing_key"
        assert fires["key_env"] == "FIRMS_MAP_KEY"
        assert fires["requires_key"] is True

    def test_module_with_its_key_reports_normal_health(
        self, make_registry_client: MakeRegistryClient
    ) -> None:
        settings = settings_for(modules_enabled=["fires"], firms_map_key="secret")
        [fires] = listing(make_registry_client(settings, self.registry()))
        assert fires["health"]["state"] == "pending"

    def test_blank_key_counts_as_missing(
        self, make_registry_client: MakeRegistryClient
    ) -> None:
        settings = settings_for(modules_enabled=["fires"], firms_map_key="   ")
        [fires] = listing(make_registry_client(settings, self.registry()))
        assert fires["health"]["state"] == "missing_key"

    def test_key_value_never_appears_in_the_response(
        self, make_registry_client: MakeRegistryClient
    ) -> None:
        settings = settings_for(modules_enabled=["fires"], firms_map_key="s3cr3t-value")
        client = make_registry_client(settings, self.registry())
        assert "s3cr3t-value" not in client.get("/v1/modules").text

    async def test_worker_skips_modules_without_keys(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setitem(
            REGISTRY, "fires", fake_module("fires", key_env="FIRMS_MAP_KEY")
        )
        settings = settings_for(modules_enabled=["fires"])
        assert await worker.run(settings, once=True) == 0


class TestDefaultFilter:
    def test_every_enabled_module_starts_on_by_default(
        self, make_registry_client: MakeRegistryClient
    ) -> None:
        registry = build_registry([*REGISTRY.values(), fake_module("fakequake")])
        settings = settings_for(modules_enabled=["earthquakes", "fakequake"])
        body = listing(make_registry_client(settings, registry))
        assert [m["default_filter"] for m in body] == ["all", "all"]

    def test_default_on_limits_which_modules_start_on(
        self, make_registry_client: MakeRegistryClient
    ) -> None:
        registry = build_registry([*REGISTRY.values(), fake_module("fakequake")])
        settings = settings_for(
            modules_enabled=["earthquakes", "fakequake"],
            modules_default_on=["earthquakes"],
        )
        body = listing(make_registry_client(settings, registry))
        assert {m["id"]: m["default_filter"] for m in body} == {
            "earthquakes": "all",
            "fakequake": "none",
        }

    def test_unknown_default_on_module_is_rejected(self) -> None:
        from thirdeye.app import create_app

        with pytest.raises(RegistryError, match="MODULES_DEFAULT_ON"):
            create_app(settings_for(modules_default_on=["unicorns"]))


class TestManifestKey:
    def data(self, **changes: Any) -> dict[str, Any]:
        return MANIFEST.model_dump() | changes

    def test_requiring_a_key_needs_an_env_name(self) -> None:
        with pytest.raises(ValidationError, match="key_env"):
            ModuleManifest.model_validate(self.data(requires_key=True))

    def test_env_name_without_requiring_a_key_is_rejected(self) -> None:
        with pytest.raises(ValidationError, match="key_env"):
            ModuleManifest.model_validate(self.data(key_env="FIRMS_MAP_KEY"))

    def test_env_name_must_look_like_an_env_var(self) -> None:
        with pytest.raises(ValidationError, match="key_env"):
            ModuleManifest.model_validate(
                self.data(requires_key=True, key_env="firms key")
            )


class TestSettingsKeys:
    def test_has_key_reads_the_matching_field(self) -> None:
        settings = settings_for(aisstream_api_key=SecretStr("abc"))
        assert settings.has_key("AISSTREAM_API_KEY") is True
        assert settings.has_key("FIRMS_MAP_KEY") is False

    def test_unknown_env_name_is_not_present(self) -> None:
        assert settings_for().has_key("NOT_A_REAL_KEY") is False
