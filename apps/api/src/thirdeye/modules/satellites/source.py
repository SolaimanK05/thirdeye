import httpx

from thirdeye.config import Settings

URL = "https://celestrak.org/NORAD/elements/gp.php"
REQUEST_TIMEOUT = httpx.Timeout(60.0, connect=10.0)
MAX_BYTES = 64 * 1024 * 1024


class CelesTrakError(Exception):
    pass


def request_url(settings: Settings) -> str:
    return settings.celestrak_url or URL


async def fetch(client: httpx.AsyncClient, settings: Settings) -> bytes:
    params = {"GROUP": settings.satellite_group, "FORMAT": "json"}
    chunks: list[bytes] = []
    size = 0
    async with client.stream(
        "GET",
        request_url(settings),
        params=params,
        timeout=REQUEST_TIMEOUT,
        follow_redirects=False,
    ) as response:
        if response.status_code != httpx.codes.OK:
            raise CelesTrakError(
                f"CelesTrak answered HTTP {response.status_code}; its policy says to "
                "stop and not retry until the next data update, so the worker waits"
            )
        async for chunk in response.aiter_bytes():
            size += len(chunk)
            if size > MAX_BYTES:
                raise CelesTrakError(
                    f"the CelesTrak download is larger than {MAX_BYTES // 2**20} MB"
                )
            chunks.append(chunk)
    return b"".join(chunks)
