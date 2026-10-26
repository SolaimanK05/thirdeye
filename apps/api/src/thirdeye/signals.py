import asyncio
import signal
import threading
from collections.abc import Callable, Iterable, Iterator
from contextlib import contextmanager
from types import FrameType

type Handler = Callable[[int, FrameType | None], object]

TERMINATION = (signal.SIGINT, signal.SIGTERM)


@contextmanager
def on_signals(
    signals: Iterable[signal.Signals], callback: Callable[[], None]
) -> Iterator[None]:
    if threading.current_thread() is not threading.main_thread():
        yield
        return
    loop = asyncio.get_running_loop()
    previous: dict[signal.Signals, Handler] = {}

    def make(original: Handler) -> Handler:
        def handle(signum: int, frame: FrameType | None) -> None:
            loop.call_soon_threadsafe(callback)
            original(signum, frame)

        return handle

    for sig in signals:
        current = signal.getsignal(sig)
        if callable(current):
            previous[sig] = current
            signal.signal(sig, make(current))
    try:
        yield
    finally:
        for sig, original in previous.items():
            signal.signal(sig, original)
