import json
from datetime import UTC, datetime

import httpx
import pytest
import respx

from thirdeye.config import Settings
from thirdeye.modules.ports import source
from thirdeye.modules.ports.records import normalize_entities
from thirdeye.registry import REGISTRY

SETTINGS = Settings(database_url="postgresql://t:t@127.0.0.1:1/t", _env_file=None)
NOW = datetime(2026, 10, 15, tzinfo=UTC)


def port(number: int) -> dict[str, object]:
    return {
        "portNumber": number,
        "portName": f"Port {number}",
        "countryCode": "PK",
        "latitude": "24°47'00\"N",
        "longitude": "66°59'00\"E",
        "ycoord": 24.783333,
        "xcoord": 66.983333,
        "unloCode": "PK KHI",
    }


def body(count: int) -> bytes:
    return json.dumps({"ports": [port(n) for n in range(1, count + 1)]}).encode()


async def download(response: httpx.Response) -> bytes:
    with respx.mock() as mock:
        mock.get(source.URL).mock(return_value=response)
        async with httpx.AsyncClient() as client:
            return await source.fetch(client, SETTINGS)


async def test_a_full_download_is_returned_and_readable_by_the_normaliser() -> None:
    raw = await download(httpx.Response(200, content=body(source.MIN_PORTS)))
    assert len(normalize_entities(raw, NOW)) == source.MIN_PORTS


async def test_an_error_status_is_raised() -> None:
    with pytest.raises(httpx.HTTPStatusError):
        await download(httpx.Response(503))


async def test_a_web_page_instead_of_data_is_refused() -> None:
    with pytest.raises(source.PortsDownloadError, match="not JSON"):
        await download(httpx.Response(200, content=b"<html>You need JavaScript</html>"))


async def test_json_without_a_port_list_is_refused() -> None:
    with pytest.raises(source.PortsDownloadError, match='no "ports" list'):
        await download(httpx.Response(200, content=b'{"message": "moved"}'))


async def test_a_short_list_is_refused_so_it_cannot_shrink_the_layer() -> None:
    with pytest.raises(source.PortsDownloadError, match="only 3 ports"):
        await download(httpx.Response(200, content=body(3)))


async def test_a_huge_download_is_cut_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(source, "MAX_BYTES", 100)
    with pytest.raises(source.PortsDownloadError, match="larger than"):
        await download(httpx.Response(200, content=body(source.MIN_PORTS)))


def test_the_registry_polls_ports_through_this_source() -> None:
    assert REGISTRY["ports"].fetch is source.fetch
