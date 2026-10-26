import time
from dataclasses import dataclass

import httpx

from thirdeye.config import BBox, Settings
from thirdeye.governor import Fetched, RateLimited

TOKEN_URL = (
    "https://auth.opensky-network.org/auth/realms/opensky-network"
    "/protocol/openid-connect/token"
)
STATES_URL = "https://opensky-network.org/api/states/all"
REQUEST_TIMEOUT = httpx.Timeout(60.0, connect=10.0)
MAX_BYTES = 64 * 1024 * 1024
TOKEN_REFRESH_MARGIN_SECONDS = 60.0
DEFAULT_TOKEN_LIFETIME_SECONDS = 1800.0
WORLD = BBox(west=-180.0, south=-90.0, east=180.0, north=90.0)
REMAINING_HEADER = "X-Rate-Limit-Remaining"
RETRY_AFTER_HEADER = "X-Rate-Limit-Retry-After-Seconds"
COST_TIERS = ((25.0, 1), (100.0, 2), (400.0, 3))
GLOBAL_COST = 4


class OpenSkyError(Exception):
    pass


def credit_cost(settings: Settings) -> int:
    box = settings.aircraft_bbox
    if box == WORLD:
        return GLOBAL_COST
    area = (box.north - box.south) * (box.east - box.west)
    for limit, cost in COST_TIERS:
        if area <= limit:
            return cost
    return GLOBAL_COST


def daily_budget(settings: Settings) -> int:
    return settings.budget_opensky_credits_day


def states_params(settings: Settings) -> dict[str, str]:
    params = {"extended": "1"}
    box = settings.aircraft_bbox
    if box != WORLD:
        params |= {
            "lamin": f"{box.south:g}",
            "lomin": f"{box.west:g}",
            "lamax": f"{box.north:g}",
            "lomax": f"{box.east:g}",
        }
    return params


@dataclass(slots=True)
class TokenCache:
    token: str | None = None
    expires_at: float = 0.0

    def usable(self, now: float) -> str | None:
        if (
            self.token is not None
            and now < self.expires_at - TOKEN_REFRESH_MARGIN_SECONDS
        ):
            return self.token
        return None

    def clear(self) -> None:
        self.token = None
        self.expires_at = 0.0


TOKENS = TokenCache()


def credentials(settings: Settings) -> tuple[str, str]:
    client_id, secret = settings.opensky_client_id, settings.opensky_client_secret
    if client_id is None or secret is None:
        raise OpenSkyError("OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET are not set")
    return client_id.get_secret_value().strip(), secret.get_secret_value().strip()


async def request_token(client: httpx.AsyncClient, settings: Settings) -> str:
    client_id, secret = credentials(settings)
    try:
        response = await client.post(
            TOKEN_URL,
            data={
                "grant_type": "client_credentials",
                "client_id": client_id,
                "client_secret": secret,
            },
            timeout=REQUEST_TIMEOUT,
        )
    except httpx.HTTPError as exc:
        raise OpenSkyError(
            f"the OpenSky token request failed ({type(exc).__name__})"
        ) from None
    if response.status_code in (400, 401):
        raise OpenSkyError(
            f"OpenSky refused the client credentials (HTTP {response.status_code})"
        )
    if response.status_code != 200:
        raise OpenSkyError(
            f"the OpenSky token request failed (HTTP {response.status_code})"
        )
    try:
        document = response.json()
        token = document["access_token"]
        lifetime = float(document.get("expires_in", DEFAULT_TOKEN_LIFETIME_SECONDS))
    except ValueError, KeyError, TypeError:
        raise OpenSkyError("the OpenSky token reply was not understood") from None
    if not isinstance(token, str) or not token:
        raise OpenSkyError("the OpenSky token reply was not understood")
    TOKENS.token = token
    TOKENS.expires_at = time.monotonic() + lifetime
    return token


async def bearer(client: httpx.AsyncClient, settings: Settings) -> str:
    return TOKENS.usable(time.monotonic()) or await request_token(client, settings)


def parse_seconds(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        seconds = float(value)
    except ValueError:
        return None
    return seconds if seconds >= 0 else None


def parse_count(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        return int(float(value))
    except ValueError:
        return None


async def get_states(
    client: httpx.AsyncClient, settings: Settings, token: str
) -> tuple[int, httpx.Headers, bytes]:
    try:
        async with client.stream(
            "GET",
            STATES_URL,
            params=states_params(settings),
            headers={"Authorization": f"Bearer {token}"},
            timeout=REQUEST_TIMEOUT,
        ) as response:
            if response.status_code != 200:
                return response.status_code, response.headers, b""
            chunks: list[bytes] = []
            size = 0
            async for chunk in response.aiter_bytes():
                size += len(chunk)
                if size > MAX_BYTES:
                    raise OpenSkyError(
                        f"the OpenSky reply is larger than {MAX_BYTES // 2**20} MB"
                    )
                chunks.append(chunk)
            return response.status_code, response.headers, b"".join(chunks)
    except httpx.HTTPError as exc:
        raise OpenSkyError(
            f"the OpenSky states request failed ({type(exc).__name__})"
        ) from None


async def fetch(client: httpx.AsyncClient, settings: Settings) -> Fetched:
    token = await bearer(client, settings)
    status, headers, body = await get_states(client, settings, token)
    if status == 401:
        TOKENS.clear()
        token = await bearer(client, settings)
        status, headers, body = await get_states(client, settings, token)
    if status == 429:
        raise RateLimited(parse_seconds(headers.get(RETRY_AFTER_HEADER)))
    if status != 200:
        raise OpenSkyError(f"the OpenSky states request failed (HTTP {status})")
    return Fetched(body, parse_count(headers.get(REMAINING_HEADER)))
