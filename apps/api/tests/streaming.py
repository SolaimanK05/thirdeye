import asyncio
import json
from collections.abc import Mapping, MutableMapping
from types import TracebackType
from typing import Any, Self

from fastapi import FastAPI


class AsgiStream:
    def __init__(
        self,
        app: FastAPI,
        path: str = "/v1/stream",
        query: str = "",
        headers: Mapping[str, str] | None = None,
        method: str = "GET",
    ) -> None:
        self._app = app
        self._path = path
        self._query = query
        self._headers = dict(headers or {})
        self._method = method
        self._messages: asyncio.Queue[MutableMapping[str, Any]] = asyncio.Queue()
        self._disconnect = asyncio.Event()
        self._sent_request = False
        self._task: asyncio.Task[None] | None = None
        self._buffer = b""
        self.status = 0
        self.response_headers: dict[str, str] = {}
        self.chunks: list[bytes] = []

    async def __aenter__(self) -> Self:
        await self.start()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        await self.close()

    @property
    def finished(self) -> bool:
        return self._task is not None and self._task.done()

    async def _receive(self) -> MutableMapping[str, Any]:
        if not self._sent_request:
            self._sent_request = True
            return {"type": "http.request", "body": b"", "more_body": False}
        await self._disconnect.wait()
        return {"type": "http.disconnect"}

    async def _send(self, message: MutableMapping[str, Any]) -> None:
        await self._messages.put(message)

    async def start(self) -> None:
        headers = [(b"host", b"testserver")]
        headers += [
            (key.lower().encode(), value.encode())
            for key, value in self._headers.items()
        ]
        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": self._method,
            "scheme": "http",
            "path": self._path,
            "raw_path": self._path.encode(),
            "root_path": "",
            "query_string": self._query.encode(),
            "headers": headers,
            "client": ("127.0.0.1", 50000),
            "server": ("testserver", 80),
        }
        self._task = asyncio.create_task(self._app(scope, self._receive, self._send))
        message = await self._next_message()
        assert message["type"] == "http.response.start", message
        self.status = message["status"]
        self.response_headers = {
            key.decode().lower(): value.decode() for key, value in message["headers"]
        }

    async def _next_message(self, timeout: float = 5.0) -> MutableMapping[str, Any]:
        return await asyncio.wait_for(self._messages.get(), timeout)

    async def read_chunk(self, timeout: float = 5.0) -> bytes | None:
        message = await self._next_message(timeout)
        if message["type"] == "http.response.body":
            body: bytes = message.get("body", b"")
            self.chunks.append(body)
            if not message.get("more_body", False) and not body:
                return None
            return body
        raise AssertionError(message)

    async def read_body(self, timeout: float = 5.0) -> bytes:
        body = b""
        while True:
            message = await self._next_message(timeout)
            chunk: bytes = message.get("body", b"")
            body += chunk
            if not message.get("more_body", False):
                return body

    async def read_events(
        self, count: int, timeout: float = 5.0
    ) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        while len(events) < count:
            while b"\n\n" in self._buffer:
                raw, self._buffer = self._buffer.split(b"\n\n", 1)
                event = parse_event(raw.decode())
                if event is not None:
                    events.append(event)
                    if len(events) == count:
                        return events
            chunk = await self.read_chunk(timeout)
            if chunk is None:
                break
            self._buffer += chunk
        return events

    async def wait_finished(self, timeout: float = 5.0) -> None:
        if self._task is not None:
            await asyncio.wait_for(asyncio.shield(self._task), timeout)

    async def close(self) -> None:
        self._disconnect.set()
        if self._task is None:
            return
        try:
            await asyncio.wait_for(self._task, 5.0)
        except asyncio.CancelledError, TimeoutError:
            self._task.cancel()


def parse_event(raw: str) -> dict[str, Any] | None:
    fields: dict[str, str] = {}
    data: list[str] = []
    for line in raw.split("\n"):
        if not line or line.startswith(":"):
            continue
        name, _, value = line.partition(":")
        value = value.removeprefix(" ")
        if name == "data":
            data.append(value)
        else:
            fields[name] = value
    if not fields and not data:
        return None
    event: dict[str, Any] = dict(fields)
    if data:
        event["data"] = json.loads("\n".join(data))
    return event
