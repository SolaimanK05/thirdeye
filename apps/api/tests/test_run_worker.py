import asyncio
from typing import Any

import pytest

from thirdeye import app as app_module
from thirdeye.config import Settings

SETTINGS = {"database_url": "postgresql://t:t@127.0.0.1:1/t", "_env_file": None}


class StubPool:
    def __init__(self) -> None:
        self.opened = False
        self.closed = False

    async def open(self) -> None:
        self.opened = True

    async def close(self) -> None:
        self.closed = True


async def idle(*args: Any, **kwargs: Any) -> None:
    await asyncio.Event().wait()


def test_the_worker_stays_out_of_the_api_unless_asked() -> None:
    assert Settings(**SETTINGS).run_worker is False  # type: ignore[arg-type]
    assert Settings(run_worker=True, **SETTINGS).run_worker is True  # type: ignore[arg-type]


async def test_the_worker_runs_inside_the_api_and_stops_with_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pool = StubPool()
    seen: dict[str, Any] = {}
    stopped = asyncio.Event()

    async def fake_worker(settings: Settings, *, once: bool, pool: object) -> int:
        seen.update(once=once, pool=pool)
        try:
            await asyncio.Event().wait()
        finally:
            stopped.set()
        return 0

    monkeypatch.setattr(app_module, "create_pool", lambda settings: pool)
    monkeypatch.setattr(app_module, "listen_for_layers", idle)
    monkeypatch.setattr(app_module, "run_worker", fake_worker)
    app = app_module.create_app(Settings(run_worker=True, **SETTINGS))  # type: ignore[arg-type]

    async with app.router.lifespan_context(app):
        await asyncio.sleep(0)
        assert seen == {"once": False, "pool": pool}
        assert not stopped.is_set()
    assert stopped.is_set()
    assert pool.closed


async def test_a_worker_that_crashes_does_not_take_the_api_down(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pool = StubPool()

    async def broken_worker(settings: Settings, *, once: bool, pool: object) -> int:
        raise RuntimeError("boom")

    monkeypatch.setattr(app_module, "create_pool", lambda settings: pool)
    monkeypatch.setattr(app_module, "listen_for_layers", idle)
    monkeypatch.setattr(app_module, "run_worker", broken_worker)
    app = app_module.create_app(Settings(run_worker=True, **SETTINGS))  # type: ignore[arg-type]

    async with app.router.lifespan_context(app):
        await asyncio.sleep(0.01)
    assert pool.closed


async def test_no_worker_task_is_started_by_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pool = StubPool()

    async def never(*args: Any, **kwargs: Any) -> int:
        raise AssertionError("the worker must not start")

    monkeypatch.setattr(app_module, "create_pool", lambda settings: pool)
    monkeypatch.setattr(app_module, "listen_for_layers", idle)
    monkeypatch.setattr(app_module, "run_worker", never)
    app = app_module.create_app(Settings(**SETTINGS))  # type: ignore[arg-type]

    async with app.router.lifespan_context(app):
        await asyncio.sleep(0)
    assert pool.opened
