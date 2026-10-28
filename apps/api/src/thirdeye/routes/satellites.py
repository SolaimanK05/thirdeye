from datetime import UTC
from email.utils import format_datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Response, status
from pydantic import AwareDatetime, JsonValue

from thirdeye.deps import ElementsCacheDep, EnabledDep, ReaderDep
from thirdeye.elements import CachedElements
from thirdeye.reads import ElementRecord
from thirdeye.routes.layers import CACHE_CONTROL, etag_matches
from thirdeye.routes.models import Out

router = APIRouter(tags=["satellites"])

MODULE_ID = "satellites"


class SatelliteElement(Out):
    id: UUID
    norad_id: int
    name: str | None
    omm: dict[str, JsonValue]


class SatelliteElements(Out):
    fetched_at: AwareDatetime | None
    satellites: list[SatelliteElement]


def element_out(record: ElementRecord) -> SatelliteElement:
    return SatelliteElement(
        id=record.id, norad_id=record.norad_id, name=record.name, omm=record.omm
    )


def headers_for(entry: CachedElements) -> dict[str, str]:
    headers = {"ETag": entry.etag, "Cache-Control": CACHE_CONTROL}
    if entry.fetched_at is not None:
        headers["Last-Modified"] = format_datetime(
            entry.fetched_at.astimezone(UTC), usegmt=True
        )
    return headers


@router.get(
    "/satellites/elements",
    response_model=SatelliteElements,
    responses={status.HTTP_304_NOT_MODIFIED: {"description": "Not modified"}},
)
async def get_satellite_elements(
    reader: ReaderDep,
    cache: ElementsCacheDep,
    enabled: EnabledDep,
    if_none_match: Annotated[str | None, Header()] = None,
) -> Response:
    if MODULE_ID not in enabled:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, f"Module {MODULE_ID!r} is not enabled"
        )
    fetched_at = await reader.fetched_at(MODULE_ID)

    async def build() -> bytes:
        records = (
            [] if fetched_at is None else await reader.satellite_elements(MODULE_ID)
        )
        return (
            SatelliteElements(
                fetched_at=fetched_at, satellites=[element_out(r) for r in records]
            )
            .model_dump_json()
            .encode()
        )

    entry = await cache.get(fetched_at, build)
    headers = headers_for(entry)
    if if_none_match is not None and etag_matches(if_none_match, entry.etag):
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    return Response(content=entry.body, media_type="application/json", headers=headers)
