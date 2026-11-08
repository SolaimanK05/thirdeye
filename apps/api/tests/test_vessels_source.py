import asyncio
import json
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

import pytest
from pydantic import SecretStr
from websockets.asyncio.server import Server, ServerConnection, serve
from websockets.frames import CloseCode

from thirdeye.config import BBox, Settings
from thirdeye.modules.vessels import source
from thirdeye.streams import Connected, Disconnected, LinkEvent

KEY = "ais-key-secret-789"
SUBSCRIPTION_DEADLINE_SECONDS = 3.0

type Behaviour = Callable[[ServerConnection], Awaitable[None]]


@dataclass
class Visit:
    opened_at: float
    subscription: str | None = None
    received_at: float | None = None


@dataclass
class FakeAis:
    behaviours: list[Behaviour]
    visits: list[Visit] = field(default_factory=list)
    url: str = ""

    async def handle(self, socket: ServerConnection) -> None:
        visit = Visit(opened_at=time.monotonic())
        self.visits.append(visit)
        try:
            async with asyncio.timeout(SUBSCRIPTION_DEADLINE_SECONDS):
                first = await socket.recv()
        except TimeoutError:
            await socket.close(CloseCode.POLICY_VIOLATION, "no subscription")
            return
        visit.received_at = time.monotonic()
        visit.subscription = first if isinstance(first, str) else first.decode()
        index = min(len(self.visits), len(self.behaviours)) - 1
        await self.behaviours[index](socket)


def settings_for(url: str = "", **changes: Any) -> Settings:
    data: dict[str, Any] = {
        "database_url": "postgresql://t:t@127.0.0.1:1/t",
        "aisstream_api_key": SecretStr(KEY),
        "aisstream_url": url or None,
        "_env_file": None,
    }
    return Settings(**(data | changes))


async def serve_frames(socket: ServerConnection, *frames: bytes | str) -> None:
    for frame in frames:
        await socket.send(frame)


def sending(*frames: bytes | str, close: int | None = None) -> Behaviour:
    async def behave(socket: ServerConnection) -> None:
        await serve_frames(socket, *frames)
        if close is not None:
            await socket.close(close, "going away")
            return
        await socket.wait_closed()

    return behave


@dataclass
class Run:
    server: FakeAis
    frames: list[bytes] = field(default_factory=list)
    events: list[LinkEvent] = field(default_factory=list)
    stop: asyncio.Event = field(default_factory=asyncio.Event)
    task: asyncio.Task[None] | None = None

    async def until(self, ready: Callable[[], bool], seconds: float = 5.0) -> None:
        async with asyncio.timeout(seconds):
            while not ready():
                await asyncio.sleep(0.01)

    async def finish(self) -> None:
        self.stop.set()
        assert self.task is not None
        async with asyncio.timeout(5):
            await self.task


async def running(
    behaviours: list[Behaviour], **changes: Any
) -> tuple[Server, Run, Settings]:
    fake = FakeAis(behaviours)
    server = await serve(fake.handle, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    fake.url = f"ws://127.0.0.1:{port}"
    return server, Run(fake), settings_for(fake.url, **changes)


async def launch(run: Run, settings: Settings) -> None:
    run.task = asyncio.create_task(
        source.read(
            settings,
            run.stop,
            run.frames.append,
            run.events.append,
            delay_for=lambda failures: 0.02 * failures,
        )
    )


def position_frame(mmsi: int = 405000123) -> bytes:
    return json.dumps(
        {
            "MessageType": "PositionReport",
            "Message": {"PositionReport": {"UserID": mmsi}},
            "MetaData": {},
        }
    ).encode()


async def test_the_subscription_arrives_at_once_with_the_documented_shape() -> None:
    server, run, settings = await running(
        [sending(position_frame())], aisstream_bbox=BBox(80, 5, 100, 25)
    )
    async with server:
        await launch(run, settings)
        await run.until(lambda: len(run.frames) == 1)
        await run.finish()
    visit = run.server.visits[0]
    assert visit.received_at is not None
    assert visit.received_at - visit.opened_at < SUBSCRIPTION_DEADLINE_SECONDS
    assert visit.subscription is not None
    assert json.loads(visit.subscription) == {
        "APIKey": KEY,
        "BoundingBoxes": [[[5.0, 80.0], [25.0, 100.0]]],
        "FilterMessageTypes": list(source.MESSAGE_TYPES),
    }


async def test_text_and_binary_frames_both_arrive_as_bytes() -> None:
    server, run, settings = await running(
        [sending(position_frame(1), position_frame(2).decode())]
    )
    async with server:
        await launch(run, settings)
        await run.until(lambda: len(run.frames) == 2)
        await run.finish()
    assert all(isinstance(frame, bytes) for frame in run.frames)
    assert [
        json.loads(f)["Message"]["PositionReport"]["UserID"] for f in run.frames
    ] == [1, 2]


async def test_the_link_is_reported_connected_on_the_first_frame() -> None:
    server, run, settings = await running([sending(position_frame())])
    async with server:
        await launch(run, settings)
        await run.until(lambda: len(run.events) == 1)
        await run.finish()
    assert run.events == [Connected()]


async def test_a_dropped_link_reconnects_and_resubscribes() -> None:
    server, run, settings = await running(
        [
            sending(position_frame(1), close=CloseCode.INTERNAL_ERROR),
            sending(position_frame(2)),
        ]
    )
    async with server:
        await launch(run, settings)
        await run.until(lambda: len(run.frames) == 2)
        await run.finish()
    assert len(run.server.visits) == 2
    assert run.server.visits[0].subscription == run.server.visits[1].subscription
    kinds = [type(event) for event in run.events]
    assert kinds == [Connected, Disconnected, Connected]
    drop = run.events[1]
    assert isinstance(drop, Disconnected)
    assert "1011" in drop.reason
    assert "going away" in drop.reason
    assert drop.failures == 1


async def test_repeated_failures_back_off_and_count_up() -> None:
    server, run, settings = await running([sending(close=CloseCode.TRY_AGAIN_LATER)])
    async with server:
        await launch(run, settings)
        await run.until(
            lambda: len([e for e in run.events if isinstance(e, Disconnected)]) >= 3
        )
        await run.finish()
    drops = [e for e in run.events if isinstance(e, Disconnected)]
    assert [d.failures for d in drops[:3]] == [1, 2, 3]
    assert [d.retry_in for d in drops[:3]] == pytest.approx([0.02, 0.04, 0.06])
    assert Connected() not in run.events


async def test_a_success_resets_the_failure_count() -> None:
    server, run, settings = await running(
        [
            sending(close=CloseCode.TRY_AGAIN_LATER),
            sending(close=CloseCode.TRY_AGAIN_LATER),
            sending(position_frame(), close=CloseCode.TRY_AGAIN_LATER),
            sending(close=CloseCode.TRY_AGAIN_LATER),
        ]
    )
    async with server:
        await launch(run, settings)
        await run.until(
            lambda: len([e for e in run.events if isinstance(e, Disconnected)]) >= 4
        )
        await run.finish()
    drops = [e for e in run.events if isinstance(e, Disconnected)]
    assert [d.failures for d in drops[:4]] == [1, 2, 1, 2]


async def test_an_error_frame_is_a_failure_with_its_detail_and_no_key() -> None:
    error = json.dumps({"error": "Api Key Is Not Valid"}).encode()
    server, run, settings = await running([sending(error)])
    async with server:
        await launch(run, settings)
        await run.until(lambda: any(isinstance(e, Disconnected) for e in run.events))
        await run.finish()
    drop = next(e for e in run.events if isinstance(e, Disconnected))
    assert "Api Key Is Not Valid" in drop.reason
    assert KEY not in drop.reason
    assert run.frames == []
    assert Connected() not in run.events


async def test_an_unreachable_server_is_retried_until_stopped() -> None:
    server, run, settings = await running([sending()])
    server.close()
    await server.wait_closed()
    await launch(run, settings)
    await run.until(
        lambda: len([e for e in run.events if isinstance(e, Disconnected)]) >= 2
    )
    await run.finish()
    drop = next(e for e in run.events if isinstance(e, Disconnected))
    assert drop.failures == 1


async def test_stopping_ends_a_quiet_open_connection() -> None:
    server, run, settings = await running([sending()])
    async with server:
        await launch(run, settings)
        await run.until(lambda: len(run.server.visits) == 1)
        await run.until(lambda: run.server.visits[0].subscription is not None)
        await run.finish()
    assert run.events == []


async def test_stopping_during_the_wait_to_reconnect_returns_promptly() -> None:
    server, run, settings = await running([sending(close=CloseCode.TRY_AGAIN_LATER)])
    async with server:
        run.task = asyncio.create_task(
            source.read(
                settings,
                run.stop,
                run.frames.append,
                run.events.append,
                delay_for=lambda failures: 30.0,
            )
        )
        await run.until(lambda: any(isinstance(e, Disconnected) for e in run.events))
        started = time.monotonic()
        await run.finish()
    assert time.monotonic() - started < 2.0
    assert len(run.server.visits) == 1


async def test_a_missing_key_never_opens_a_connection() -> None:
    server, run, settings = await running([sending()], aisstream_api_key=None)
    async with server:
        run.task = asyncio.create_task(
            source.read(settings, run.stop, run.frames.append, run.events.append)
        )
        with pytest.raises(source.AisStreamError):
            async with asyncio.timeout(5):
                await run.task
    assert run.server.visits == []
