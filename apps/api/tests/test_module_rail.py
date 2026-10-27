from collections.abc import Callable, Mapping
from datetime import UTC, datetime, timedelta
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
from thirdeye.routes.modules import (
    STALE_AFTER_CADENCES,
    STALE_AFTER_MIN_SECONDS,
    health_out,
    module_state,
    stale_after,
)

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
            "key_envs": () if key_env is None else (key_env,),
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
        registry = build_registry([REGISTRY["earthquakes"], fake_module("fakequake")])
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
        registry = build_registry([REGISTRY["earthquakes"], fake_module("fakequake")])
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


class TestSeveralKeys:
    def registry(self) -> Mapping[str, Module]:
        module = fake_module("sky")
        manifest = module.manifest.model_copy(
            update={
                "requires_key": True,
                "key_envs": ("OPENSKY_CLIENT_ID", "OPENSKY_CLIENT_SECRET"),
            }
        )
        return build_registry([Module(manifest, module.fetch, module.normalize)])

    def test_one_missing_key_is_enough_to_call_the_module_keyless(
        self, make_registry_client: MakeRegistryClient
    ) -> None:
        settings = settings_for(
            modules_enabled=["sky"], opensky_client_id=SecretStr("id")
        )
        [sky] = listing(make_registry_client(settings, self.registry()))
        assert sky["health"]["state"] == "missing_key"
        assert sky["key_env"] == "OPENSKY_CLIENT_SECRET"

    def test_both_keys_make_the_module_usable(
        self, make_registry_client: MakeRegistryClient
    ) -> None:
        settings = settings_for(
            modules_enabled=["sky"],
            opensky_client_id=SecretStr("id"),
            opensky_client_secret=SecretStr("secret"),
        )
        [sky] = listing(make_registry_client(settings, self.registry()))
        assert sky["health"]["state"] == "pending"
        assert sky["key_env"] == "OPENSKY_CLIENT_ID"

    def test_neither_key_names_the_first(
        self, make_registry_client: MakeRegistryClient
    ) -> None:
        settings = settings_for(modules_enabled=["sky"])
        [sky] = listing(make_registry_client(settings, self.registry()))
        assert sky["key_env"] == "OPENSKY_CLIENT_ID"


class TestCooldown:
    def registry(self) -> Mapping[str, Module]:
        return build_registry([fake_module("sky")])

    def health(self, **changes: Any) -> dict[str, HealthRecord]:
        fields: dict[str, Any] = {
            "module_id": "sky",
            "status": "ok",
            "fetched_at": NOW,
            "record_count": 40,
            "reason": "cooldown until 11:32Z",
            "cooldown_until": datetime.now(UTC) + timedelta(minutes=10),
        }
        return {"sky": HealthRecord(**(fields | changes))}

    def test_a_module_in_cooldown_says_so_and_keeps_its_last_good_time(
        self, make_registry_client: MakeRegistryClient, reader: FakeReader
    ) -> None:
        reader.health_rows = self.health()
        [sky] = listing(
            make_registry_client(settings_for(modules_enabled=["sky"]), self.registry())
        )
        assert sky["health"]["state"] == "cooldown"
        assert sky["health"]["cooldown_until"] is not None
        assert sky["health"]["fetched_at"] == NOW.isoformat().replace("+00:00", "Z")
        assert sky["health"]["record_count"] == 40
        assert sky["health"]["reason"] == "cooldown until 11:32Z"

    def test_an_ended_cooldown_is_not_reported(
        self, make_registry_client: MakeRegistryClient, reader: FakeReader
    ) -> None:
        reader.health_rows = self.health(
            cooldown_until=datetime.now(UTC) - timedelta(minutes=1)
        )
        [sky] = listing(
            make_registry_client(settings_for(modules_enabled=["sky"]), self.registry())
        )
        assert sky["health"]["state"] != "cooldown"
        assert sky["health"]["cooldown_until"] is None

    def test_a_module_not_in_cooldown_has_no_cooldown_time(
        self, make_registry_client: MakeRegistryClient, reader: FakeReader
    ) -> None:
        reader.health_rows = self.health(cooldown_until=None, reason=None)
        [sky] = listing(
            make_registry_client(settings_for(modules_enabled=["sky"]), self.registry())
        )
        assert sky["health"]["cooldown_until"] is None


class TestDefaultFilter:
    def test_every_enabled_module_starts_on_by_default(
        self, make_registry_client: MakeRegistryClient
    ) -> None:
        registry = build_registry([REGISTRY["earthquakes"], fake_module("fakequake")])
        settings = settings_for(modules_enabled=["earthquakes", "fakequake"])
        body = listing(make_registry_client(settings, registry))
        assert [m["default_filter"] for m in body] == ["all", "all"]

    def test_default_on_limits_which_modules_start_on(
        self, make_registry_client: MakeRegistryClient
    ) -> None:
        registry = build_registry([REGISTRY["earthquakes"], fake_module("fakequake")])
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
        with pytest.raises(ValidationError, match="key_envs"):
            ModuleManifest.model_validate(self.data(requires_key=True))

    def test_env_name_without_requiring_a_key_is_rejected(self) -> None:
        with pytest.raises(ValidationError, match="key_envs"):
            ModuleManifest.model_validate(self.data(key_envs=("FIRMS_MAP_KEY",)))

    def test_env_name_must_look_like_an_env_var(self) -> None:
        with pytest.raises(ValidationError, match="key_envs"):
            ModuleManifest.model_validate(
                self.data(requires_key=True, key_envs=("firms key",))
            )

    def test_a_module_can_need_more_than_one_key(self) -> None:
        manifest = ModuleManifest.model_validate(
            self.data(requires_key=True, key_envs=("A_ID", "A_SECRET"))
        )
        assert manifest.key_envs == ("A_ID", "A_SECRET")

    def test_a_key_name_cannot_repeat(self) -> None:
        with pytest.raises(ValidationError, match="repeat"):
            ModuleManifest.model_validate(
                self.data(requires_key=True, key_envs=("A_ID", "A_ID"))
            )


class TestSettingsKeys:
    def test_has_key_reads_the_matching_field(self) -> None:
        settings = settings_for(aisstream_api_key=SecretStr("abc"))
        assert settings.has_key("AISSTREAM_API_KEY") is True
        assert settings.has_key("FIRMS_MAP_KEY") is False

    def test_unknown_env_name_is_not_present(self) -> None:
        assert settings_for().has_key("NOT_A_REAL_KEY") is False


class TestStreamHealth:
    def record(self, age_seconds: float, module_id: str = "ships") -> HealthRecord:
        return HealthRecord(
            module_id=module_id,
            status="ok",
            fetched_at=datetime.now(UTC) - timedelta(seconds=age_seconds),
            record_count=10,
            reason=None,
            cooldown_until=None,
        )

    def test_a_polled_module_without_a_heartbeat_keeps_its_rule(self) -> None:
        assert stale_after(60) == timedelta(
            seconds=max(60 * STALE_AFTER_CADENCES, STALE_AFTER_MIN_SECONDS)
        )
        assert stale_after(0) is None

    def test_a_streaming_module_goes_stale_after_missing_its_heartbeats(self) -> None:
        limit = stale_after(0, 60)
        assert limit == timedelta(
            seconds=max(60 * STALE_AFTER_CADENCES, STALE_AFTER_MIN_SECONDS)
        )

    def test_a_recent_heartbeat_is_fresh(self) -> None:
        now = datetime.now(UTC)
        state = module_state(self.record(30), 0, now, heartbeat_seconds=60)
        assert state == "fresh"

    def test_a_silent_stream_goes_stale(self) -> None:
        now = datetime.now(UTC)
        state = module_state(self.record(3600), 0, now, heartbeat_seconds=60)
        assert state == "stale"

    def test_an_unpolled_module_with_no_heartbeat_never_goes_stale(self) -> None:
        now = datetime.now(UTC)
        assert module_state(self.record(10**7), 0, now) == "fresh"

    def test_the_health_report_says_when_it_goes_stale(self) -> None:
        now = datetime.now(UTC)
        limit = stale_after(0, 60)
        assert limit is not None
        health = health_out(self.record(30), 0, now, heartbeat_seconds=60)
        assert health.stale_after_seconds == int(limit.total_seconds())

    def test_the_vessels_module_reports_a_stale_after_time(
        self, make_registry_client: MakeRegistryClient, reader: FakeReader
    ) -> None:
        reader.health_rows = {"vessels": self.record(30, "vessels")}
        client = make_registry_client(
            settings_for(modules_enabled=["vessels"], aisstream_api_key=SecretStr("k")),
            {"vessels": REGISTRY["vessels"]},
        )
        [vessels] = listing(client)
        assert vessels["health"]["state"] == "fresh"
        assert vessels["health"]["stale_after_seconds"] is not None
        assert vessels["render_delay_seconds"] == 180
        assert vessels["cadence_seconds"] == 0
        assert vessels["kind"] == "entities"
        assert vessels["key_env"] == "AISSTREAM_API_KEY"
