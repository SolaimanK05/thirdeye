import os
from collections.abc import AsyncIterator, Callable, Mapping, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, cast
from uuid import UUID

import psycopg_pool
import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@127.0.0.1:1/test")

from thirdeye import store
from thirdeye.app import create_app
from thirdeye.config import Settings
from thirdeye.db import Pool, get_pool
from thirdeye.deps import get_layer_cache, get_reader, get_writer
from thirdeye.layers import LayerCache, ViewLoader
from thirdeye.reads import (
    EntityRecord,
    EventRecord,
    FixRecord,
    HealthRecord,
    SearchRecord,
    SnapshotRecord,
    Viewport,
    ViewRecord,
    WatchRecord,
)
from thirdeye.registry import REGISTRY, Module

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
    fix_rows: dict[UUID, list[FixRecord]] = field(default_factory=dict)
    fix_calls: list[tuple[UUID, int]] = field(default_factory=list)
    healthy: bool = True
    snapshot_calls: int = 0
    view_rows: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    view_fetched_at: dict[str, datetime] = field(default_factory=dict)
    window_calls: list[tuple[str, int, Viewport]] = field(default_factory=list)
    watch_records: list[WatchRecord] = field(default_factory=list)
    search_records: list[SearchRecord] = field(default_factory=list)
    search_calls: list[tuple[str, list[str], list[str], int]] = field(
        default_factory=list
    )

    def check(self) -> None:
        if not self.healthy:
            raise psycopg_pool.PoolTimeout("couldn't get a connection")

    async def snapshot(self, module_id: str) -> SnapshotRecord | None:
        self.check()
        self.snapshot_calls += 1
        return self.snapshots.get(module_id)

    async def fetched_at(self, module_id: str) -> datetime | None:
        self.check()
        snapshot = self.snapshots.get(module_id)
        return None if snapshot is None else snapshot.fetched_at

    async def window(
        self, module_id: str, lookback_seconds: int, viewport: Viewport
    ) -> ViewRecord | None:
        self.check()
        self.window_calls.append((module_id, lookback_seconds, viewport))
        fetched_at = self.view_fetched_at.get(module_id)
        if fetched_at is None:
            return None
        inside = [
            row
            for row in self.view_rows.get(module_id, [])
            if viewport.south <= row["lat"] <= viewport.north
            and (
                (viewport.west <= row["lon"] <= viewport.east)
                if not viewport.wraps
                else (row["lon"] >= viewport.west or row["lon"] <= viewport.east)
            )
        ]
        inside.sort(key=lambda row: -(row["severity"] or 0))
        return ViewRecord(
            rows=inside[: viewport.limit], matched=len(inside), fetched_at=fetched_at
        )

    async def watchlist(self) -> list[WatchRecord]:
        self.check()
        return list(self.watch_records)

    async def search(
        self,
        text: str,
        modules: Sequence[str],
        named_modules: Sequence[str],
        limit: int,
    ) -> list[SearchRecord]:
        self.check()
        self.search_calls.append((text, list(modules), list(named_modules), limit))
        return self.search_records[:limit]

    async def health(self) -> dict[str, HealthRecord]:
        self.check()
        return self.health_rows

    async def event(self, event_id: str) -> EventRecord | None:
        self.check()
        return self.events.get(event_id)

    async def entity(self, entity_id: UUID) -> EntityRecord | None:
        self.check()
        return self.entities.get(entity_id)

    async def fixes(self, entity_id: UUID, limit: int) -> list[FixRecord]:
        self.check()
        self.fix_calls.append((entity_id, limit))
        return self.fix_rows.get(entity_id, [])[-limit:]


@dataclass
class FakeWriter:
    known: set[UUID] = field(default_factory=set)
    starred: set[UUID] = field(default_factory=set)

    async def star(self, entity_id: UUID) -> bool:
        if entity_id not in self.known:
            return False
        self.starred.add(entity_id)
        return True

    async def unstar(self, entity_id: UUID) -> None:
        self.starred.discard(entity_id)


@pytest.fixture
def writer() -> FakeWriter:
    return FakeWriter()


def view_loader_for(reader: FakeReader, registry: Mapping[str, Module]) -> ViewLoader:
    async def load(module_id: str, viewport: Viewport) -> ViewRecord | None:
        lookback = registry[module_id].manifest.viewport_lookback_seconds or 0
        return await reader.window(module_id, lookback, viewport)

    return load


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
def make_client(
    settings: Settings, reader: FakeReader, writer: FakeWriter
) -> Callable[[bool], TestClient]:
    def factory(db_healthy: bool = True) -> TestClient:
        app = create_app(settings)
        reader.healthy = db_healthy
        cache = LayerCache(reader.snapshot, view_loader_for(reader, REGISTRY))
        app.dependency_overrides[get_pool] = lambda: FakePool(db_healthy)
        app.dependency_overrides[get_reader] = lambda: reader
        app.dependency_overrides[get_writer] = lambda: writer
        app.dependency_overrides[get_layer_cache] = lambda: cache
        return TestClient(app)

    return factory


@pytest.fixture
def make_registry_client(
    reader: FakeReader, writer: FakeWriter
) -> Callable[[Settings, Mapping[str, Module]], TestClient]:
    def factory(settings: Settings, registry: Mapping[str, Module]) -> TestClient:
        app = create_app(settings, registry)
        cache = LayerCache(reader.snapshot, view_loader_for(reader, registry))
        app.dependency_overrides[get_pool] = lambda: FakePool(True)
        app.dependency_overrides[get_reader] = lambda: reader
        app.dependency_overrides[get_writer] = lambda: writer
        app.dependency_overrides[get_layer_cache] = lambda: cache
        return TestClient(app)

    return factory


class WorkerPool:
    @asynccontextmanager
    async def connection(self) -> AsyncIterator[object]:
        yield object()


POOL = cast(Pool, WorkerPool())


class Recorder:
    def __init__(self) -> None:
        self.writes: list[tuple[str, int]] = []
        self.snapshot_rows: dict[str, bool] = {}
        self.failures: list[tuple[str, str]] = []
        self.prunes: list[tuple[str, int]] = []
        self.entity_writes: list[dict[str, Any]] = []
        self.observation_prunes: list[tuple[str, int]] = []
        self.cooldowns: list[tuple[str, datetime, str]] = []
        self.metas: list[tuple[str, dict[str, Any]]] = []

    async def prune_events(
        self, conn: object, module_id: str, keep_seconds: int, now: datetime
    ) -> int:
        self.prunes.append((module_id, keep_seconds))
        return 0

    async def write_events(
        self,
        conn: object,
        module_id: str,
        events: list[Any],
        fetched_at: datetime,
        *,
        snapshot_rows: bool = True,
    ) -> None:
        self.writes.append((module_id, len(events)))
        self.snapshot_rows[module_id] = snapshot_rows

    async def write_entities(
        self,
        conn: object,
        module_id: str,
        source_id: str,
        reports: list[Any],
        fetched_at: datetime,
        *,
        latest_only: bool,
        snapshot_window_seconds: int | None,
    ) -> int:
        self.entity_writes.append(
            {
                "module_id": module_id,
                "source_id": source_id,
                "count": len(reports),
                "latest_only": latest_only,
                "window": snapshot_window_seconds,
            }
        )
        return len(reports)

    async def prune_observations(
        self, conn: object, source_id: str, keep_seconds: int, now: datetime
    ) -> int:
        self.observation_prunes.append((source_id, keep_seconds))
        return 0

    async def record_failure(
        self, conn: object, module_id: str, reason: str, failed_at: datetime
    ) -> None:
        self.failures.append((module_id, reason))

    async def record_cooldown(
        self,
        conn: object,
        module_id: str,
        until: datetime,
        reason: str,
        now: datetime,
    ) -> None:
        self.cooldowns.append((module_id, until, reason))

    async def record_meta(
        self, conn: object, module_id: str, meta: dict[str, Any]
    ) -> None:
        self.metas.append((module_id, dict(meta)))


@pytest.fixture
def recorder(monkeypatch: pytest.MonkeyPatch) -> Recorder:
    rec = Recorder()
    monkeypatch.setattr(store, "write_events", rec.write_events)
    monkeypatch.setattr(store, "record_failure", rec.record_failure)
    monkeypatch.setattr(store, "prune_events", rec.prune_events)
    monkeypatch.setattr(store, "write_entities", rec.write_entities)
    monkeypatch.setattr(store, "prune_observations", rec.prune_observations)
    monkeypatch.setattr(store, "record_cooldown", rec.record_cooldown)
    monkeypatch.setattr(store, "record_meta", rec.record_meta)
    return rec
