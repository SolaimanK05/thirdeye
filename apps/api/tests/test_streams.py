import asyncio

import pytest

from thirdeye import streams
from thirdeye.streams import FrameBuffer, reconnect_delay, wait_for_stop


class TestReconnectDelay:
    def test_the_ceiling_doubles_from_one_second(self) -> None:
        ceilings = [reconnect_delay(n, rng=lambda: 1.0) for n in range(1, 8)]
        assert ceilings == [1, 2, 4, 8, 16, 32, 60]

    def test_the_ceiling_is_capped_at_a_minute(self) -> None:
        assert reconnect_delay(500, rng=lambda: 1.0) == 60
        assert reconnect_delay(10**9, rng=lambda: 1.0) == 60

    def test_full_jitter_picks_anywhere_below_the_ceiling(self) -> None:
        assert reconnect_delay(6, rng=lambda: 0.5) == 16

    def test_it_never_waits_less_than_the_floor(self) -> None:
        assert reconnect_delay(6, rng=lambda: 0.0) == streams.RECONNECT_FLOOR_SECONDS

    def test_no_failures_counts_as_the_first(self) -> None:
        assert reconnect_delay(0, rng=lambda: 1.0) == 1

    def test_the_default_source_of_randomness_stays_in_range(self) -> None:
        delays = {reconnect_delay(4) for _ in range(200)}
        assert all(1 <= delay <= 8 for delay in delays)
        assert len(delays) > 50


class TestFrameBuffer:
    def test_it_hands_back_what_it_holds_in_order_and_empties(self) -> None:
        buffer = FrameBuffer(5)
        for n in range(3):
            buffer.push(bytes([n]))
        assert len(buffer) == 3
        assert buffer.take() == [b"\x00", b"\x01", b"\x02"]
        assert len(buffer) == 0
        assert buffer.take() == []

    def test_when_full_the_oldest_goes_and_is_counted(self) -> None:
        buffer = FrameBuffer(3)
        for n in range(5):
            buffer.push(bytes([n]))
        assert buffer.take() == [b"\x02", b"\x03", b"\x04"]
        assert buffer.take_dropped() == 2
        assert buffer.take_dropped() == 0

    def test_it_never_holds_more_than_its_capacity(self) -> None:
        buffer = FrameBuffer(10)
        for n in range(10_000):
            buffer.push(b"x")
            assert len(buffer) <= 10
        assert buffer.take_dropped() == 9_990

    def test_it_needs_room_for_one_frame(self) -> None:
        with pytest.raises(ValueError, match="capacity"):
            FrameBuffer(0)


class TestWaitForStop:
    async def test_it_times_out_when_nothing_stops_it(self) -> None:
        assert await wait_for_stop(asyncio.Event(), 0.01) is False

    async def test_it_returns_early_when_stopped(self) -> None:
        stop = asyncio.Event()
        asyncio.get_running_loop().call_later(0.01, stop.set)
        async with asyncio.timeout(2):
            assert await wait_for_stop(stop, 30) is True

    async def test_a_stop_already_set_returns_at_once(self) -> None:
        stop = asyncio.Event()
        stop.set()
        assert await wait_for_stop(stop, 30) is True
