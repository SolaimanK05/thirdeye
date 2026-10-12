import os
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager

import psycopg_pool
import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@127.0.0.1:1/test")

from thirdeye.config import Settings
from thirdeye.db import get_pool
from thirdeye.main import create_app


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


@pytest.fixture
def settings() -> Settings:
    return Settings(
        database_url="postgresql://test:test@127.0.0.1:1/test",
        _env_file=None,
    )


@pytest.fixture
def make_client(settings: Settings) -> Callable[[bool], TestClient]:
    def factory(db_healthy: bool = True) -> TestClient:
        app = create_app(settings)
        app.dependency_overrides[get_pool] = lambda: FakePool(db_healthy)
        return TestClient(app)

    return factory
