import os
from collections.abc import AsyncIterator, Callable, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from uuid import UUID

import psycopg_pool
import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@127.0.0.1:1/test")

from thirdeye.app import create_app
from thirdeye.config import Settings
from thirdeye.db import get_pool
from thirdeye.deps import get_layer_cache, get_reader
from thirdeye.layers import LayerCache
from thirdeye.reads import EntityRecord, EventRecord, HealthRecord, SnapshotRecord
from thirdeye.registry import Module

NOW = datetime(2026, 10, 14, 6, 0, tzinfo=UTC)


class FakeConnection:
    async def execute(self, query: str) -> None:
        return None


class FakePool:
    def __init__(self, healthy: bool) -> None:
        self.healthy = healthy

    @asynccontextmanager
    async def connection(self) -> AsyncIterator[FakeConnection]:
        if not self.healthy:
            raise psycopg_pool.PoolTimeout("couldn't get a connection")
        yield FakeConnection()


@dataclass
class FakeReader:
    snapshots: dict[str, SnapshotRecord] = field(default_factory=dict)
    health_rows: dict[str, HealthRecord] = field(default_factory=dict)
    events: dict[str, EventRecord] = field(default_factory=dict)
    entities: dict[UUID, EntityRecord] = field(default_factory=dict)
    healthy: bool = True
    snapshot_calls: int = 0

    def check(self) -> None:
        if not self.healthy:
            raise psycopg_pool.PoolTimeout("couldn't get a connection")

    async def snapshot(self, module_id: str) -> SnapshotRecord | None:
        self.check()
        self.snapshot_calls += 1
        return self.snapshots.get(module_id)

    async def health(self) -> dict[str, HealthRecord]:
        self.check()
        return self.health_rows

    async def event(self, event_id: str) -> EventRecord | None:
        self.check()
        return self.events.get(event_id)

    async def entity(self, entity_id: UUID) -> EntityRecord | None:
        self.check()
        return self.entities.get(entity_id)


@pytest.fixture
def settings() -> Settings:
    return Settings(
        database_url="postgresql://test:test@127.0.0.1:1/test",
        modules_enabled=["earthquakes"],
        _env_file=None,
    )


@pytest.fixture
def reader() -> FakeReader:
    return FakeReader()


@pytest.fixture
def make_client(settings: Settings, reader: FakeReader) -> Callable[[bool], TestClient]:
    def factory(db_healthy: bool = True) -> TestClient:
        app = create_app(settings)
        reader.healthy = db_healthy
        cache = LayerCache(reader.snapshot)
        app.dependency_overrides[get_pool] = lambda: FakePool(db_healthy)
        app.dependency_overrides[get_reader] = lambda: reader
        app.dependency_overrides[get_layer_cache] = lambda: cache
        return TestClient(app)

    return factory


@pytest.fixture
def make_registry_client(
    reader: FakeReader,
) -> Callable[[Settings, Mapping[str, Module]], TestClient]:
    def factory(settings: Settings, registry: Mapping[str, Module]) -> TestClient:
        app = create_app(settings, registry)
        cache = LayerCache(reader.snapshot)
        app.dependency_overrides[get_pool] = lambda: FakePool(True)
        app.dependency_overrides[get_reader] = lambda: reader
        app.dependency_overrides[get_layer_cache] = lambda: cache
        return TestClient(app)

    return factory
