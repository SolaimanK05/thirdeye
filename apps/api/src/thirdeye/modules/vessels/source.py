import asyncio
import json
from collections.abc import Callable
from dataclasses import dataclass

from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed, WebSocketException

from thirdeye.config import Settings
from thirdeye.streams import (
    Connected,
    Disconnected,
    FrameSink,
    LinkReport,
    Stop,
    StreamTuning,
    reconnect_delay,
    wait_for_stop,
)

AIS_URL = "wss://stream.aisstream.io/v0/stream"
MESSAGE_TYPES = (
    "PositionReport",
    "StandardClassBPositionReport",
    "ExtendedClassBPositionReport",
    "ShipStaticData",
    "StaticDataReport",
)
OPEN_TIMEOUT_SECONDS = 10.0
MAX_FRAME_BYTES = 1024 * 1024
ERROR_PREFIX = b'{"error"'


class AisStreamError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class SessionEnd:
    reason: str
    received: bool


def tuning(settings: Settings) -> StreamTuning:
    return StreamTuning(
        batch_seconds=settings.ais_batch_seconds, queue_max=settings.ais_queue_max
    )


def bounding_boxes(settings: Settings) -> list[list[list[float]]]:
    box = settings.vessel_bbox
    return [[[box.south, box.west], [box.north, box.east]]]


def subscription(settings: Settings) -> str:
    key = settings.aisstream_api_key
    if key is None:
        raise AisStreamError("AISSTREAM_API_KEY is not set")
    return json.dumps(
        {
            "APIKey": key.get_secret_value().strip(),
            "BoundingBoxes": bounding_boxes(settings),
            "FilterMessageTypes": list(MESSAGE_TYPES),
        }
    )


def closing_reason(exc: ConnectionClosed) -> str:
    frame = exc.rcvd
    if frame is None:
        return "connection lost without a close frame"
    return f"closed with code {frame.code}, {frame.reason or 'no reason given'}"


def refusal(frame: bytes) -> AisStreamError:
    try:
        document = json.loads(frame)
        detail = document.get("error") if isinstance(document, dict) else None
    except ValueError:
        detail = None
    text = detail if isinstance(detail, str) and detail else "no detail"
    return AisStreamError(f"AISStream refused the subscription: {text}")


async def session(
    url: str, message: str, sink: FrameSink, report: LinkReport
) -> SessionEnd:
    received = False
    try:
        async with connect(
            url, open_timeout=OPEN_TIMEOUT_SECONDS, max_size=MAX_FRAME_BYTES
        ) as socket:
            await socket.send(message)
            async for frame in socket:
                data = frame if isinstance(frame, bytes) else frame.encode()
                if data.lstrip().startswith(ERROR_PREFIX):
                    raise refusal(data)
                if not received:
                    received = True
                    report(Connected())
                sink(data)
    except ConnectionClosed as exc:
        return SessionEnd(closing_reason(exc), received)
    except (OSError, TimeoutError, WebSocketException, AisStreamError) as exc:
        return SessionEnd(f"{type(exc).__name__}: {exc}", received)
    return SessionEnd("closed by the server", received)


async def run_session(
    url: str, message: str, sink: FrameSink, report: LinkReport, stop: Stop
) -> SessionEnd | None:
    opened = asyncio.create_task(session(url, message, sink, report))
    stopped = asyncio.create_task(stop.wait())
    try:
        done, _ = await asyncio.wait(
            {opened, stopped}, return_when=asyncio.FIRST_COMPLETED
        )
        if opened in done:
            return opened.result()
        return None
    finally:
        for task in (opened, stopped):
            task.cancel()
        await asyncio.gather(opened, stopped, return_exceptions=True)


async def read(
    settings: Settings,
    stop: Stop,
    sink: FrameSink,
    report: LinkReport,
    *,
    url: str | None = None,
    delay_for: Callable[[int], float] = reconnect_delay,
) -> None:
    target = url or settings.aisstream_url or AIS_URL
    message = subscription(settings)
    failures = 0
    while not stop.is_set():
        end = await run_session(target, message, sink, report, stop)
        if end is None:
            return
        failures = 1 if end.received else failures + 1
        delay = delay_for(failures)
        report(Disconnected(end.reason, failures, delay))
        if await wait_for_stop(stop, delay):
            return
