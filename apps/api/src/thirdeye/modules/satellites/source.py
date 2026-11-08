import httpx
import structlog

from thirdeye.config import Settings

log = structlog.get_logger()

URL = "https://celestrak.org/NORAD/elements/gp.php"
SATCAT_URL = "https://celestrak.org/satcat/records.php"
REQUEST_TIMEOUT = httpx.Timeout(60.0, connect=10.0)
MAX_BYTES = 64 * 1024 * 1024
SATCAT_MAX_BYTES = 32 * 1024 * 1024


class CelesTrakError(Exception):
    pass


def request_url(settings: Settings) -> str:
    return settings.celestrak_url or URL


def satcat_url(settings: Settings) -> str:
    return settings.satcat_url or SATCAT_URL


async def download(
    client: httpx.AsyncClient, url: str, group: str, limit: int
) -> bytes:
    params = {"GROUP": group, "FORMAT": "json"}
    chunks: list[bytes] = []
    size = 0
    async with client.stream(
        "GET",
        url,
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
            if size > limit:
                raise CelesTrakError(
                    f"the CelesTrak download is larger than {limit // 2**20} MB"
                )
            chunks.append(chunk)
    return b"".join(chunks)


async def fetch(client: httpx.AsyncClient, settings: Settings) -> bytes:
    """
    The element sets, with the satellite catalogue (owner, status) beside them.
    The catalogue only adds filters, so a failed catalogue download is logged and
    the element sets are still used.
    """
    group = settings.satellite_group
    elements = await download(client, request_url(settings), group, MAX_BYTES)
    try:
        catalogue = await download(
            client, satcat_url(settings), group, SATCAT_MAX_BYTES
        )
    except (CelesTrakError, httpx.HTTPError) as exc:
        log.warning("satellites.catalogue_unavailable", reason=str(exc))
        catalogue = b"[]"
    return b'{"gp":' + elements + b',"satcat":' + catalogue + b"}"
