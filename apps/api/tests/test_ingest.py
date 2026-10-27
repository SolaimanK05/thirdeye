import asyncio
import json
from datetime import datetime
from typing import Any

import pytest
import structlog.testing
from conftest import POOL, Recorder
from pydantic import SecretStr

from thirdeye import ingest, store
from thirdeye.config import Settings
from thirdeye.modules.vessels import records
from thirdeye.modules.vessels.manifest import MANIFEST
from thirdeye.ontology import EntityReport
from thirdeye.streams import (
    Connected,
    Disconnected,
    FrameReader,
    FrameSink,
    LinkReport,
    Stop,
    StreamRunner,
    StreamTuning,
)

KEY = "ais-key-for-ingest"
SETTINGS = Settings(
    database_url="postgresql://t:t@127.0.0.1:1/t",
    aisstream_api_key=SecretStr(KEY),
    _env_file=None,
)


def frame(mmsi: int, **changes: Any) -> bytes:
    body = {
        "UserID": mmsi,
        "Valid": True,
        "Latitude": 22.2,
        "Longitude": 91.8,
        "Sog": 9.0,
        "Cog": 10.0,
        "TrueHeading": 11,
    } | changes
    return json.dumps(
        {
            "MessageType": "PositionReport",
            "Message": {"PositionReport": body},
            "MetaData": {"ShipName": "SHIP"},
        }
    ).encode()


async def drive(run: StreamRunner, stop: Stop) -> None:
    await run(POOL, SETTINGS, stop)


def make(
    *, queue_max: int = 1000, normalize: ingest.Normalizer | None = None
) -> ingest.EntityIngest:
    return ingest.EntityIngest(
        MANIFEST,
        normalize or records.normalize_entities,
        StreamTuning(batch_seconds=0.05, queue_max=queue_max),
        POOL,
        SETTINGS,
    )


async def test_a_burst_of_messages_is_one_write(recorder: Recorder) -> None:
    flow = make()
    for mmsi in range(405000000, 405000200):
        flow.buffer.push(frame(mmsi))
    await flow.flush()
    assert len(recorder.entity_writes) == 1
    assert recorder.entity_writes[0]["count"] == 200
    assert recorder.entity_writes[0]["module_id"] == "vessels"
    assert recorder.entity_writes[0]["source_id"] == "aisstream"
    assert recorder.entity_writes[0]["latest_only"] is False
    assert recorder.entity_writes[0]["window"] == MANIFEST.snapshot_window_seconds


async def test_many_messages_for_one_vessel_make_one_report(recorder: Recorder) -> None:
    flow = make()
    for _ in range(50):
        flow.buffer.push(frame(405000123))
    await flow.flush()
    assert recorder.entity_writes[0]["count"] == 1


async def test_an_empty_buffer_writes_nothing(recorder: Recorder) -> None:
    flow = make()
    await flow.flush()
    assert recorder.entity_writes == []


async def test_a_full_buffer_drops_the_oldest_and_says_so(recorder: Recorder) -> None:
    flow = make(queue_max=100)
    for mmsi in range(405000000, 405000150):
        flow.buffer.push(frame(mmsi))
    with structlog.testing.capture_logs() as logs:
        await flow.flush()
    assert recorder.entity_writes[0]["count"] == 100
    overflow = next(entry for entry in logs if entry["event"] == "stream.overflow")
    assert overflow["dropped"] == 50
    assert overflow["total"] == 50
    assert overflow["log_level"] == "warning"


async def test_pruning_is_throttled(recorder: Recorder) -> None:
    flow = make()
    for _ in range(3):
        flow.buffer.push(frame(405000123))
        await flow.flush()
    assert len(recorder.entity_writes) == 3
    assert recorder.observation_prunes == [
        ("aisstream", MANIFEST.observation_retention_seconds)
    ]


async def test_normalising_runs_off_the_event_loop(recorder: Recorder) -> None:
    loop = asyncio.get_running_loop()
    seen: list[bool] = []

    def normalize(raw: bytes, at: datetime) -> list[EntityReport]:
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            seen.append(True)
        else:
            seen.append(False)
        return records.normalize_entities(raw, at)

    flow = make(normalize=normalize)
    flow.buffer.push(frame(405000123))
    await flow.flush()
    assert seen == [True]
    assert loop.is_running()


async def test_frames_with_newlines_cannot_run_together(recorder: Recorder) -> None:
    flow = make()
    flow.buffer.push(frame(405000123).replace(b",", b",\n"))
    flow.buffer.push(frame(405000124))
    await flow.flush()
    assert recorder.entity_writes[0]["count"] == 2


class TestLink:
    async def test_connecting_refreshes_health_once_even_without_vessels(
        self, recorder: Recorder
    ) -> None:
        flow = make()
        flow.on_link(Connected())
        await flow.flush()
        await flow.flush()
        assert [w["count"] for w in recorder.entity_writes] == [0]

    async def test_a_quiet_but_connected_stream_beats_with_its_heartbeat(
        self, recorder: Recorder
    ) -> None:
        flow = make()
        flow.heartbeat = 0.0
        flow.on_link(Connected())
        await flow.flush()
        await flow.flush()
        assert [w["count"] for w in recorder.entity_writes] == [0, 0]

    async def test_a_quiet_stream_that_is_down_writes_nothing(
        self, recorder: Recorder
    ) -> None:
        flow = make()
        flow.heartbeat = 0.0
        await flow.flush()
        assert recorder.entity_writes == []

    async def test_a_dropped_link_is_saved_once_as_a_failure(
        self, recorder: Recorder
    ) -> None:
        flow = make()
        flow.on_link(Connected())
        flow.on_link(Disconnected("closed with code 1011, going away", 1, 1.5))
        await flow.flush()
        await flow.flush()
        assert recorder.failures == [("vessels", "closed with code 1011, going away")]
        assert recorder.entity_writes == []

    async def test_the_key_is_removed_from_logged_and_saved_reasons(
        self, recorder: Recorder
    ) -> None:
        flow = make()
        with structlog.testing.capture_logs() as logs:
            flow.on_link(Disconnected(f"refused for {KEY}", 2, 3.0))
        await flow.flush()
        assert KEY not in json.dumps(logs)
        assert recorder.failures == [("vessels", "refused for [redacted]")]
        entry = next(e for e in logs if e["event"] == "stream.disconnected")
        assert entry["failures"] == 2
        assert entry["retry_in"] == 3.0

    async def test_a_failed_write_is_reported_and_the_stream_goes_on(
        self, recorder: Recorder, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = make()
        flow.buffer.push(frame(405000123))

        async def broken(*args: Any, **kwargs: Any) -> int:
            raise RuntimeError(f"database says no to {KEY}")

        monkeypatch.setattr(store, "write_entities", broken)
        stop = asyncio.Event()
        stop.set()
        await flow.drain(stop)
        assert recorder.failures == [
            ("vessels", "RuntimeError: database says no to [redacted]")
        ]


class TestRunner:
    def reader(
        self, frames: list[bytes], *, connect: bool = True
    ) -> tuple[FrameReader, list[Stop]]:
        stops: list[Stop] = []

        async def read(
            settings: Settings, stop: Stop, sink: FrameSink, report: LinkReport
        ) -> None:
            stops.append(stop)
            if connect:
                report(Connected())
            for item in frames:
                sink(item)
            await stop.wait()

        return read, stops

    async def test_the_runner_batches_and_flushes_what_is_left_on_stop(
        self, recorder: Recorder
    ) -> None:
        read, _ = self.reader([frame(405000000 + n) for n in range(300)])
        run = ingest.entity_stream(
            MANIFEST,
            read,
            records.normalize_entities,
            lambda settings: StreamTuning(batch_seconds=0.05, queue_max=1000),
        )
        stop = asyncio.Event()
        task = asyncio.create_task(drive(run, stop))
        await asyncio.sleep(0.3)
        stop.set()
        async with asyncio.timeout(5):
            await task
        counts = [w["count"] for w in recorder.entity_writes]
        assert sum(counts) == 300
        assert len(counts) <= 3

    async def test_what_is_buffered_when_the_worker_stops_is_still_written(
        self, recorder: Recorder
    ) -> None:
        async def read(
            settings: Settings, stop: Stop, sink: FrameSink, report: LinkReport
        ) -> None:
            sink(frame(405000123))
            await stop.wait()

        run = ingest.entity_stream(
            MANIFEST,
            read,
            records.normalize_entities,
            lambda settings: StreamTuning(batch_seconds=30, queue_max=1000),
        )
        stop = asyncio.Event()
        task = asyncio.create_task(drive(run, stop))
        await asyncio.sleep(0.05)
        stop.set()
        async with asyncio.timeout(5):
            await task
        assert [w["count"] for w in recorder.entity_writes] == [1]

    async def test_a_crashing_reader_surfaces_to_the_supervisor(
        self, recorder: Recorder
    ) -> None:
        async def read(
            settings: Settings, stop: Stop, sink: FrameSink, report: LinkReport
        ) -> None:
            raise RuntimeError("reader bug")

        run = ingest.entity_stream(
            MANIFEST,
            read,
            records.normalize_entities,
            lambda settings: StreamTuning(batch_seconds=30, queue_max=1000),
        )
        with pytest.raises(ExceptionGroup) as caught:
            async with asyncio.timeout(5):
                await run(POOL, SETTINGS, asyncio.Event())
        assert caught.group_contains(RuntimeError, match="reader bug")
