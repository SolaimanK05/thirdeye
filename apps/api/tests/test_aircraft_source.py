from typing import Any

import httpx
import pytest
import respx
from pydantic import SecretStr

from thirdeye.config import BBox, Settings
from thirdeye.governor import Fetched, RateLimited
from thirdeye.modules.aircraft import source
from thirdeye.modules.aircraft.source import OpenSkyError

CLIENT_ID = "client-id-123"
CLIENT_SECRET = "client-secret-456"
TOKEN = "token-abc"


def settings_for(**changes: Any) -> Settings:
    data: dict[str, Any] = {
        "database_url": "postgresql://t:t@127.0.0.1:1/t",
        "opensky_client_id": SecretStr(CLIENT_ID),
        "opensky_client_secret": SecretStr(CLIENT_SECRET),
        "region_bbox": BBox(-180, -90, 180, 90),
        "_env_file": None,
    }
    return Settings(**(data | changes))


@pytest.fixture(autouse=True)
def clean_tokens() -> None:
    source.TOKENS.clear()


def token_reply(token: str = TOKEN, expires_in: int = 1800) -> httpx.Response:
    return httpx.Response(200, json={"access_token": token, "expires_in": expires_in})


async def fetch(settings: Settings | None = None) -> Fetched:
    async with httpx.AsyncClient() as client:
        return await source.fetch(client, settings or settings_for())


class TestCost:
    @pytest.mark.parametrize(
        ("box", "cost"),
        [
            (BBox(-180, -90, 180, 90), 4),
            (BBox(0, 0, 5, 5), 1),
            (BBox(0, 0, 5, 5.2), 2),
            (BBox(0, 0, 10, 10), 2),
            (BBox(0, 0, 10, 10.5), 3),
            (BBox(0, 0, 20, 20), 3),
            (BBox(0, 0, 20, 20.5), 4),
            (BBox(78, 5, 100, 24), 4),
        ],
    )
    def test_the_cost_follows_the_published_area_tiers(
        self, box: BBox, cost: int
    ) -> None:
        assert source.credit_cost(settings_for(region_bbox=box)) == cost

    def test_the_aircraft_box_overrides_the_region(self) -> None:
        settings = settings_for(opensky_bbox=BBox(0, 0, 5, 5))
        assert source.credit_cost(settings) == 1

    def test_the_daily_budget_comes_from_settings(self) -> None:
        assert source.daily_budget(settings_for(budget_opensky_credits_day=900)) == 900


class TestParams:
    def test_the_whole_world_sends_no_box(self) -> None:
        assert source.states_params(settings_for()) == {"extended": "1"}

    def test_a_region_sends_the_four_edges(self) -> None:
        params = source.states_params(settings_for(opensky_bbox=BBox(78, 5, 100, 24)))
        assert params == {
            "extended": "1",
            "lamin": "5",
            "lomin": "78",
            "lamax": "24",
            "lomax": "100",
        }


class TestFetch:
    @respx.mock
    async def test_a_fetch_gets_a_token_then_the_states(self) -> None:
        token = respx.post(source.TOKEN_URL).mock(return_value=token_reply())
        states = respx.get(source.STATES_URL).mock(
            return_value=httpx.Response(
                200,
                content=b'{"states": []}',
                headers={"X-Rate-Limit-Remaining": "3000"},
            )
        )
        result = await fetch()
        assert result == Fetched(b'{"states": []}', 3000)
        form = token.calls.last.request.content.decode()
        assert "grant_type=client_credentials" in form
        assert f"client_id={CLIENT_ID}" in form
        request = states.calls.last.request
        assert request.headers["Authorization"] == f"Bearer {TOKEN}"
        assert request.url.params["extended"] == "1"

    @respx.mock
    async def test_the_token_is_reused_until_it_nears_expiry(self) -> None:
        token = respx.post(source.TOKEN_URL).mock(return_value=token_reply())
        respx.get(source.STATES_URL).mock(
            return_value=httpx.Response(200, content=b"{}")
        )
        await fetch()
        await fetch()
        assert token.call_count == 1

    @respx.mock
    async def test_a_token_about_to_expire_is_replaced(self) -> None:
        token = respx.post(source.TOKEN_URL).mock(
            return_value=token_reply(expires_in=30)
        )
        respx.get(source.STATES_URL).mock(
            return_value=httpx.Response(200, content=b"{}")
        )
        await fetch()
        await fetch()
        assert token.call_count == 2

    @respx.mock
    async def test_a_401_gets_one_new_token_and_one_retry(self) -> None:
        token = respx.post(source.TOKEN_URL).mock(
            side_effect=[token_reply("old"), token_reply("new")]
        )
        states = respx.get(source.STATES_URL).mock(
            side_effect=[httpx.Response(401), httpx.Response(200, content=b"{}")]
        )
        assert (await fetch()).body == b"{}"
        assert token.call_count == 2
        assert states.calls.last.request.headers["Authorization"] == "Bearer new"

    @respx.mock
    async def test_a_second_401_is_an_error(self) -> None:
        respx.post(source.TOKEN_URL).mock(return_value=token_reply())
        respx.get(source.STATES_URL).mock(return_value=httpx.Response(401))
        with pytest.raises(OpenSkyError, match="HTTP 401"):
            await fetch()

    @respx.mock
    async def test_a_429_is_a_rate_limit_with_the_wait_the_source_gave(self) -> None:
        respx.post(source.TOKEN_URL).mock(return_value=token_reply())
        respx.get(source.STATES_URL).mock(
            return_value=httpx.Response(
                429, headers={"X-Rate-Limit-Retry-After-Seconds": "754"}
            )
        )
        with pytest.raises(RateLimited) as caught:
            await fetch()
        assert caught.value.retry_after == 754

    @respx.mock
    async def test_a_429_without_a_wait_is_still_a_rate_limit(self) -> None:
        respx.post(source.TOKEN_URL).mock(return_value=token_reply())
        respx.get(source.STATES_URL).mock(return_value=httpx.Response(429))
        with pytest.raises(RateLimited) as caught:
            await fetch()
        assert caught.value.retry_after is None

    @respx.mock
    async def test_a_server_error_is_reported_by_status_only(self) -> None:
        respx.post(source.TOKEN_URL).mock(return_value=token_reply())
        respx.get(source.STATES_URL).mock(
            return_value=httpx.Response(503, content=TOKEN.encode())
        )
        with pytest.raises(OpenSkyError) as caught:
            await fetch()
        assert "HTTP 503" in str(caught.value)
        assert TOKEN not in str(caught.value)

    @respx.mock
    async def test_a_dropped_connection_is_reported_without_the_url(self) -> None:
        respx.post(source.TOKEN_URL).mock(return_value=token_reply())
        respx.get(source.STATES_URL).mock(side_effect=httpx.ConnectError("boom"))
        with pytest.raises(OpenSkyError) as caught:
            await fetch()
        assert str(caught.value) == "the OpenSky states request failed (ConnectError)"

    @respx.mock
    async def test_a_missing_remaining_header_is_none(self) -> None:
        respx.post(source.TOKEN_URL).mock(return_value=token_reply())
        respx.get(source.STATES_URL).mock(
            return_value=httpx.Response(200, content=b"{}")
        )
        assert (await fetch()).remaining is None

    @respx.mock
    async def test_a_huge_reply_is_cut_off(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(source, "MAX_BYTES", 10)
        respx.post(source.TOKEN_URL).mock(return_value=token_reply())
        respx.get(source.STATES_URL).mock(
            return_value=httpx.Response(200, content=b"x" * 100)
        )
        with pytest.raises(OpenSkyError, match="larger than"):
            await fetch()


class TestToken:
    @respx.mock
    @pytest.mark.parametrize("status", [400, 401])
    async def test_refused_credentials_say_so_without_the_secret(
        self, status: int
    ) -> None:
        respx.post(source.TOKEN_URL).mock(
            return_value=httpx.Response(status, text=CLIENT_SECRET)
        )
        with pytest.raises(OpenSkyError) as caught:
            await fetch()
        message = str(caught.value)
        assert "refused the client credentials" in message
        assert CLIENT_SECRET not in message
        assert CLIENT_ID not in message

    @respx.mock
    async def test_an_unexpected_token_status_is_an_error(self) -> None:
        respx.post(source.TOKEN_URL).mock(return_value=httpx.Response(500))
        with pytest.raises(OpenSkyError, match="HTTP 500"):
            await fetch()

    @respx.mock
    @pytest.mark.parametrize(
        "reply",
        [
            httpx.Response(200, text="not json"),
            httpx.Response(200, json={"nope": 1}),
            httpx.Response(200, json={"access_token": ""}),
            httpx.Response(200, json={"access_token": 5}),
        ],
    )
    async def test_a_token_reply_we_cannot_use_is_an_error(
        self, reply: httpx.Response
    ) -> None:
        respx.post(source.TOKEN_URL).mock(return_value=reply)
        with pytest.raises(OpenSkyError, match="not understood"):
            await fetch()

    @respx.mock
    async def test_a_token_request_that_cannot_connect_hides_the_url(self) -> None:
        respx.post(source.TOKEN_URL).mock(side_effect=httpx.ConnectError("boom"))
        with pytest.raises(OpenSkyError) as caught:
            await fetch()
        assert str(caught.value) == "the OpenSky token request failed (ConnectError)"

    async def test_missing_credentials_make_no_request(self) -> None:
        with respx.mock(assert_all_called=False) as mock:
            route = mock.route().mock(return_value=httpx.Response(200))
            with pytest.raises(OpenSkyError, match="are not set"):
                await fetch(settings_for(opensky_client_secret=None))
            assert route.call_count == 0


class TestSecrets:
    def test_both_credentials_are_redacted_from_logs(self) -> None:
        assert settings_for().secret_values() == [CLIENT_ID, CLIENT_SECRET]

    def test_the_url_constants_are_the_only_hosts_this_module_uses(self) -> None:
        assert source.TOKEN_URL.startswith("https://auth.opensky-network.org/")
        assert source.STATES_URL.startswith("https://opensky-network.org/")
