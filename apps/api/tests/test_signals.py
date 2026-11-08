import asyncio
import signal
import threading
from types import FrameType

from thirdeye.signals import on_signals


class TestOnSignals:
    async def test_the_callback_runs_and_the_original_handler_still_fires(
        self,
    ) -> None:
        seen: list[int] = []
        called = asyncio.Event()

        def original(signum: int, frame: FrameType | None) -> None:
            seen.append(signum)

        before = signal.signal(signal.SIGUSR1, original)
        try:
            with on_signals([signal.SIGUSR1], called.set):
                signal.raise_signal(signal.SIGUSR1)
                await asyncio.wait_for(called.wait(), 2)
            assert seen == [signal.SIGUSR1]
        finally:
            signal.signal(signal.SIGUSR1, before)

    async def test_the_original_handler_is_restored(self) -> None:
        def original(signum: int, frame: FrameType | None) -> None:
            return None

        before = signal.signal(signal.SIGUSR1, original)
        try:
            with on_signals([signal.SIGUSR1], lambda: None):
                assert signal.getsignal(signal.SIGUSR1) is not original
            assert signal.getsignal(signal.SIGUSR1) is original
        finally:
            signal.signal(signal.SIGUSR1, before)

    async def test_default_dispositions_are_left_alone(self) -> None:
        before = signal.signal(signal.SIGUSR1, signal.SIG_DFL)
        try:
            with on_signals([signal.SIGUSR1], lambda: None):
                assert signal.getsignal(signal.SIGUSR1) == signal.SIG_DFL
        finally:
            signal.signal(signal.SIGUSR1, before)

    async def test_it_does_nothing_off_the_main_thread(self) -> None:
        outcome: list[bool] = []

        def work() -> None:
            async def inner() -> None:
                before = signal.getsignal(signal.SIGUSR1)
                with on_signals([signal.SIGUSR1], lambda: None):
                    outcome.append(signal.getsignal(signal.SIGUSR1) is before)

            asyncio.run(inner())

        thread = threading.Thread(target=work)
        thread.start()
        thread.join(5)
        assert outcome == [True]
