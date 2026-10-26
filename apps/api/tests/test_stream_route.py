import asyncio
from collections.abc import AsyncIterable, AsyncIterator
from contextlib import asynccontextmanager
from datetime import timedelta
from typing import Any, Self

import pytest
from conftest import NOW
from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.sse import EventSourceResponse, ServerSentEvent
from streaming import AsgiStream
from test_stream import LATER, MODULES, World, build, plane, update

from thirdeye.app import create_app
from thirdeye.config import Settings
from thirdeye.db import get_pool
from thirdeye.deps import get_broadcaster
from thirdeye.layers import LayerCache
from thirdeye.stream import event_id

GZIP_MAGIC = b"\x1f\x8b"


class CountingPool:
    def __init__(self) -> None:
        self.checkouts = 0

    @asynccontextmanager
    async def connection(self) -> AsyncIterator[object]:
        self.checkouts += 1
        yield object()


class Rig:
    def __init__(self, settings: Settings) -> None:
        self.world = World()
        self.world.put("aircraft", plane(1), plane(2))
        self.world.put("ports", plane(9) | {"kind": "facility"})
        self.world.put("earthquakes", at=NOW)
        self.broadcaster, self.cache = build(self.world)
        self.pool = CountingPool()
        self.app = create_app(settings)
        self.app.dependency_overrides[get_broadcaster] = lambda: self.broadcaster
        self.app.dependency_overrides[get_pool] = lambda: self.pool

    async def baseline(self) -> None:
        for module_id in MODULES:
            await self.broadcaster.refresh(module_id)

    def stream(self, query: str = "", **headers: str) -> AsgiStream:
        return AsgiStream(self.app, query=query, headers=headers)

    async def move_plane(self, step: int) -> None:
        await update(
            self.world,
            self.broadcaster,
            self.cache,
            "aircraft",
            plane(1, lon=60.0 + step),
            plane(2),
            at=LATER + timedelta(seconds=step),
        )


@pytest.fixture
async def rig(settings: Settings) -> Rig:
    rig = Rig(settings)
    await rig.baseline()
    return rig


class TestTheEndpoint:
    async def test_it_streams_hello_and_the_snapshots(self, rig: Rig) -> None:
        async with rig.stream() as stream:
            assert stream.status == 200
            events = await stream.read_events(3)
        assert [e["event"] for e in events] == ["hello", "snapshot", "snapshot"]
        assert events[0]["data"]["instance"] == "test-instance"
        assert events[0]["retry"] == "3000"
        assert [e["data"]["module_id"] for e in events[1:]] == ["aircraft", "ports"]
        assert len(events[1]["data"]["entities"]) == 2

    async def test_the_headers_tell_proxies_not_to_buffer(self, rig: Rig) -> None:
        async with rig.stream() as stream:
            await stream.read_events(3)
            headers = stream.response_headers
        assert headers["content-type"].startswith("text/event-stream")
        assert headers["cache-control"] == "no-cache"
        assert headers["x-accel-buffering"] == "no"

    async def test_updates_arrive_while_the_connection_stays_open(
        self, rig: Rig
    ) -> None:
        async with rig.stream("entities=aircraft") as stream:
            await stream.read_events(2)
            await rig.move_plane(1)
            events = await stream.read_events(2)
            assert not stream.finished
            await rig.move_plane(2)
            more = await stream.read_events(2)
        assert [e["event"] for e in events] == ["layer", "delta"]
        assert events[1]["data"]["version"] == 2
        assert more[1]["data"]["version"] == 3
        assert events[0]["id"] != more[0]["id"]

    async def test_a_client_can_ask_for_no_entities(self, rig: Rig) -> None:
        async with rig.stream("entities=") as stream:
            [hello] = await stream.read_events(1)
            await rig.move_plane(1)
            [layer] = await stream.read_events(1)
        assert hello["event"] == "hello"
        assert layer["event"] == "layer"

    async def test_a_client_can_pick_modules_and_spaces_are_ignored(
        self, rig: Rig
    ) -> None:
        async with rig.stream("entities=ports%2C%20") as stream:
            events = await stream.read_events(2)
        assert [e["data"].get("module_id") for e in events] == [None, "ports"]

    async def test_a_module_that_is_not_an_entity_module_is_refused(
        self, rig: Rig
    ) -> None:
        async with rig.stream("entities=aircraft,earthquakes,nowhere") as stream:
            assert stream.status == 422
            body = await stream.read_body()
        assert b"earthquakes, nowhere" in body
        assert b'"code":"unprocessable_content"' in body

    async def test_the_baseline_that_cannot_load_is_a_503(
        self, settings: Settings
    ) -> None:
        rig = Rig(settings)
        rig.world.failing = True
        async with rig.stream() as stream:
            assert stream.status == 503
            body = await stream.read_body()
        assert b"Database unavailable" in body
        assert rig.broadcaster.clients == 0

    async def test_a_client_that_resumes_gets_what_it_missed(self, rig: Rig) -> None:
        async with rig.stream("entities=aircraft") as stream:
            events = await stream.read_events(2)
        seen = events[-1]["id"]
        await rig.move_plane(1)
        await rig.move_plane(2)
        async with rig.stream("entities=aircraft", **{"Last-Event-ID": seen}) as stream:
            resumed = await stream.read_events(5)
        assert [e["event"] for e in resumed] == [
            "hello",
            "layer",
            "delta",
            "layer",
            "delta",
        ]
        assert resumed[0]["data"]["resumed"] is True

    async def test_a_client_with_an_unknown_id_starts_over(self, rig: Rig) -> None:
        async with rig.stream(
            "entities=aircraft", **{"Last-Event-ID": "stale-9"}
        ) as stream:
            events = await stream.read_events(2)
        assert [e["event"] for e in events] == ["hello", "snapshot"]
        assert events[0]["data"]["resumed"] is False

    async def test_the_last_snapshot_id_is_a_resume_point(self, rig: Rig) -> None:
        async with rig.stream("entities=aircraft") as stream:
            events = await stream.read_events(2)
        assert events[1]["id"] == event_id(
            rig.broadcaster.epoch, rig.broadcaster.last_seq
        )

    async def test_shutting_down_ends_every_open_stream(self, rig: Rig) -> None:
        streams = [rig.stream() for _ in range(3)]
        for stream in streams:
            await stream.start()
            await stream.read_events(3)
        rig.broadcaster.close()
        for stream in streams:
            assert await stream.read_body() == b""
            await stream.wait_finished(2)
            assert stream.finished
        assert rig.broadcaster.clients == 0

    async def test_the_endpoint_is_in_the_openapi_schema(self, rig: Rig) -> None:
        async with AsgiStream(rig.app, path="/openapi.json") as response:
            body = await response.read_body()
        assert b'"/v1/stream"' in body
        assert b"text/event-stream" in body


class TestNoDatabaseConnectionPerClient:
    async def test_open_streams_check_out_no_connection(self, rig: Rig) -> None:
        streams = [rig.stream() for _ in range(8)]
        for stream in streams:
            await stream.start()
            await stream.read_events(3)
        assert rig.broadcaster.clients == 8
        await rig.move_plane(1)
        for stream in streams:
            await stream.read_events(2)
        assert rig.pool.checkouts == 0
        for stream in streams:
            await stream.close()

    async def test_a_closed_connection_is_forgotten(self, rig: Rig) -> None:
        stream = rig.stream()
        await stream.start()
        await stream.read_events(3)
        assert rig.broadcaster.clients == 1
        await stream.close()
        for _ in range(20):
            if rig.broadcaster.clients == 0:
                break
            await asyncio.sleep(0.01)
        assert rig.broadcaster.clients == 0


class TestGzipDoesNotBufferTheStream:
    async def test_events_are_readable_one_by_one_with_gzip_accepted(
        self, rig: Rig
    ) -> None:
        async with rig.stream(
            "entities=aircraft", **{"Accept-Encoding": "gzip"}
        ) as stream:
            assert "content-encoding" not in stream.response_headers
            first = await stream.read_chunk(2)
            assert first is not None and first.startswith(b"retry: 3000") is False
            assert first.startswith(b"event: hello")
            assert not stream.finished
            second = await stream.read_chunk(2)
            assert second is not None and second.startswith(b"event: snapshot")
            assert not stream.finished
            await rig.move_plane(1)
            third = await stream.read_chunk(2)
            fourth = await stream.read_chunk(2)
            assert third is not None and third.startswith(b"event: layer")
            assert fourth is not None and fourth.startswith(b"event: delta")
            assert not stream.finished
        assert all(not chunk.startswith(GZIP_MAGIC) for chunk in stream.chunks)

    async def test_a_large_snapshot_is_not_compressed_or_held_back(
        self, settings: Settings
    ) -> None:
        rig = Rig(settings)
        rig.world.put("aircraft", *(plane(n, lon=n / 10) for n in range(1, 3001)))
        await rig.baseline()
        async with rig.stream(
            "entities=aircraft", **{"Accept-Encoding": "gzip, br"}
        ) as stream:
            assert "content-encoding" not in stream.response_headers
            await stream.read_chunk(2)
            snapshot = await stream.read_chunk(2)
            assert snapshot is not None
            assert len(snapshot) > 1024 * 100
            assert snapshot.startswith(b"event: snapshot")
            assert not stream.finished

    async def test_the_check_would_notice_a_compressing_middleware(self) -> None:
        async def events() -> AsyncIterable[ServerSentEvent]:
            for number in range(40):
                yield ServerSentEvent(raw_data=f"event number {number}" * 20)
                await asyncio.sleep(0.05)

        def make(**options: Any) -> FastAPI:
            app = FastAPI()
            app.get("/sse", response_class=EventSourceResponse)(events)
            app.add_middleware(GZipMiddleware, minimum_size=1, **options)
            return app

        async with AsgiStream(
            make(exclude_content_types=()),
            path="/sse",
            headers={"Accept-Encoding": "gzip"},
        ) as compressed:
            assert compressed.response_headers.get("content-encoding") == "gzip"
        async with AsgiStream(
            make(), path="/sse", headers={"Accept-Encoding": "gzip"}
        ) as plain:
            assert "content-encoding" not in plain.response_headers
            chunk = await plain.read_chunk(2)
            assert chunk is not None and chunk.startswith(b"data:")


class TestCors:
    async def test_a_browser_may_send_last_event_id(self, rig: Rig) -> None:
        async with AsgiStream(
            rig.app,
            method="OPTIONS",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "last-event-id",
            },
        ) as preflight:
            assert preflight.status == 200
            allowed = preflight.response_headers["access-control-allow-headers"]
        assert "Last-Event-ID" in allowed

    async def test_the_stream_answers_the_web_origin(self, rig: Rig) -> None:
        async with rig.stream(Origin="http://localhost:3000") as stream:
            await stream.read_events(3)
            assert (
                stream.response_headers["access-control-allow-origin"]
                == "http://localhost:3000"
            )


class TestTheNotifyLoopFeedsTheBroadcaster:
    async def test_a_notification_reaches_a_connected_client(self, rig: Rig) -> None:
        from thirdeye.layers import listen_for_layers

        class Notify:
            def __init__(self, payload: str) -> None:
                self.payload = payload

        class Connection:
            async def __aenter__(self) -> Self:
                return self

            async def __aexit__(self, *args: object) -> None:
                return None

            async def execute(self, query: str) -> None:
                return None

            async def notifies(self) -> AsyncIterator[Notify]:
                await asyncio.sleep(0.05)
                rig.world.put("aircraft", plane(1, lon=12.0), at=LATER)
                yield Notify("aircraft")
                await asyncio.sleep(10)

        async def connect() -> Any:
            return Connection()

        cache: LayerCache = rig.cache
        task = asyncio.create_task(
            listen_for_layers(connect, cache, on_update=rig.broadcaster.notify)
        )
        runner = asyncio.create_task(rig.broadcaster.run())
        try:
            async with rig.stream("entities=aircraft") as stream:
                await stream.read_events(2)
                events = await stream.read_events(2)
        finally:
            task.cancel()
            runner.cancel()
        assert [e["event"] for e in events] == ["layer", "delta"]
        assert events[1]["data"]["upserts"][0]["lon"] == 12.0
