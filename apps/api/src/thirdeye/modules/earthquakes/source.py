import httpx

URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson"


async def fetch(client: httpx.AsyncClient) -> bytes:
    response = await client.get(URL)
    response.raise_for_status()
    return response.content
