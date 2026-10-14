import httpx

from thirdeye.config import Settings

BASE_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
PRODUCT = "VIIRS_SNPP_NRT"
DAY_RANGE = 2
WORLD = (-180.0, -90.0, 180.0, 90.0)
REQUEST_TIMEOUT = httpx.Timeout(120.0, connect=10.0)
REDACTED = "[redacted]"
CSV_HEADER_START = "latitude,"


class FirmsError(Exception):
    pass


def area(settings: Settings) -> str:
    west, south, east, north = settings.region_bbox
    if (west, south, east, north) == WORLD:
        return "world"
    return f"{west:g},{south:g},{east:g},{north:g}"


def request_url(key: str, settings: Settings) -> str:
    return f"{BASE_URL}/{key}/{PRODUCT}/{area(settings)}/{DAY_RANGE}"


def scrub(text: str, key: str) -> str:
    return text.replace(key, REDACTED)


async def fetch(client: httpx.AsyncClient, settings: Settings) -> bytes:
    secret = settings.firms_map_key
    key = secret.get_secret_value().strip() if secret is not None else ""
    if not key:
        raise FirmsError("FIRMS_MAP_KEY is not set")
    try:
        response = await client.get(request_url(key, settings), timeout=REQUEST_TIMEOUT)
    except httpx.HTTPError as exc:
        raise FirmsError(f"request failed: {type(exc).__name__}") from None
    if response.status_code >= 400:
        hint = (
            ", check FIRMS_MAP_KEY" if response.status_code in (400, 401, 403) else ""
        )
        raise FirmsError(f"FIRMS answered HTTP {response.status_code}{hint}")
    body = response.content
    if not body.lstrip().lower().startswith(CSV_HEADER_START.encode()):
        preview = scrub(body[:80].decode("utf-8", "replace"), key)
        raise FirmsError(f"FIRMS did not return CSV: {preview!r}")
    return body
