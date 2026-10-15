import json

import httpx

from thirdeye.config import Settings

URL = "https://msi.nga.mil/api/publications/world-port-index?output=json"
REQUEST_TIMEOUT = httpx.Timeout(120.0, connect=10.0)
MAX_BYTES = 64 * 1024 * 1024
MIN_PORTS = 500


class PortsDownloadError(Exception):
    pass


def check_download(body: bytes) -> None:
    try:
        document = json.loads(body)
    except ValueError:
        raise PortsDownloadError(
            "the World Port Index download is not JSON; the publisher may have moved it"
        ) from None
    ports = document.get("ports") if isinstance(document, dict) else None
    if not isinstance(ports, list):
        raise PortsDownloadError('the World Port Index download has no "ports" list')
    if len(ports) < MIN_PORTS:
        raise PortsDownloadError(
            f"the World Port Index download lists only {len(ports)} ports, "
            f"expected at least {MIN_PORTS}, so it was not used"
        )


async def fetch(client: httpx.AsyncClient, settings: Settings) -> bytes:
    chunks: list[bytes] = []
    size = 0
    async with client.stream("GET", URL, timeout=REQUEST_TIMEOUT) as response:
        response.raise_for_status()
        async for chunk in response.aiter_bytes():
            size += len(chunk)
            if size > MAX_BYTES:
                raise PortsDownloadError(
                    f"the World Port Index download is larger than {MAX_BYTES // 2**20} MB"
                )
            chunks.append(chunk)
    body = b"".join(chunks)
    check_download(body)
    return body
