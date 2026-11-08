import asyncio
import hashlib
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True, slots=True)
class CachedElements:
    fetched_at: datetime | None
    body: bytes
    etag: str


def encode_elements(fetched_at: datetime | None, body: bytes) -> CachedElements:
    digest = hashlib.blake2b(body, digest_size=16).hexdigest()
    return CachedElements(fetched_at=fetched_at, body=body, etag=f'"{digest}"')


class ElementsCache:
    def __init__(self) -> None:
        self._entry: CachedElements | None = None
        self._lock = asyncio.Lock()

    async def get(
        self, fetched_at: datetime | None, build: Callable[[], Awaitable[bytes]]
    ) -> CachedElements:
        entry = self._entry
        if entry is not None and entry.fetched_at == fetched_at:
            return entry
        async with self._lock:
            entry = self._entry
            if entry is not None and entry.fetched_at == fetched_at:
                return entry
            entry = encode_elements(fetched_at, await build())
            self._entry = entry
            return entry
