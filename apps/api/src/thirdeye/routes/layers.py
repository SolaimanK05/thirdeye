import math
from datetime import UTC
from email.utils import format_datetime, parsedate_to_datetime
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Query, Response, status

from thirdeye.deps import EnabledDep, LayerCacheDep
from thirdeye.layers import CachedLayer, Layer
from thirdeye.reads import DEFAULT_LIMIT, MAX_LIMIT, WORLD, Viewport

router = APIRouter(tags=["layers"])

CACHE_CONTROL = "no-cache"
MAX_CELL_DEGREES = 45.0
MAX_MIN_SEVERITY = 100_000.0


def parse_viewport(
    bbox: str | None,
    limit: int | None,
    cell: float | None,
    min_severity: float | None,
) -> Viewport:
    cap = DEFAULT_LIMIT if limit is None else limit
    floor = 0.0 if min_severity is None else min_severity
    if bbox is None:
        return Viewport(
            WORLD.west, WORLD.south, WORLD.east, WORLD.north, cap, cell, floor
        )
    try:
        west, south, east, north = (float(part) for part in bbox.split(","))
    except ValueError:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "bbox must be four numbers: west,south,east,north",
        ) from None
    if not all(map(math.isfinite, (west, south, east, north))):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "bbox values must be finite"
        )
    if not -180 <= west <= 180 or not -180 <= east <= 180:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "bbox west and east must be between -180 and 180",
        )
    if not -90 <= south < north <= 90:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "bbox south and north must be between -90 and 90, with south below north",
        )
    if west == east:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "bbox west and east must differ"
        )
    return Viewport(west, south, east, north, cap, cell, floor)


def etag_matches(header: str, etag: str) -> bool:
    if header.strip() == "*":
        return True
    candidates = (tag.strip().removeprefix("W/") for tag in header.split(","))
    return etag.removeprefix("W/") in candidates


def not_modified(
    layer: CachedLayer, if_none_match: str | None, if_modified_since: str | None
) -> bool:
    if if_none_match is not None:
        return etag_matches(if_none_match, layer.etag)
    if if_modified_since is None or layer.last_modified is None:
        return False
    try:
        since = parsedate_to_datetime(if_modified_since)
    except TypeError, ValueError:
        return False
    if since.tzinfo is None:
        return False
    return layer.last_modified.replace(microsecond=0) <= since


def cache_headers(layer: CachedLayer) -> dict[str, str]:
    headers = {"ETag": layer.etag, "Cache-Control": CACHE_CONTROL}
    if layer.last_modified is not None:
        headers["Last-Modified"] = format_datetime(
            layer.last_modified.astimezone(UTC), usegmt=True
        )
    return headers


@router.get(
    "/layers/{module_id}",
    response_model=Layer,
    responses={status.HTTP_304_NOT_MODIFIED: {"description": "Not modified"}},
)
async def get_layer(
    module_id: str,
    cache: LayerCacheDep,
    enabled: EnabledDep,
    bbox: Annotated[
        str | None,
        Query(description="west,south,east,north; west above east crosses 180"),
    ] = None,
    limit: Annotated[
        int | None,
        Query(ge=1, le=MAX_LIMIT, description="Strongest rows first"),
    ] = None,
    cell: Annotated[
        float | None,
        Query(
            gt=0,
            le=MAX_CELL_DEGREES,
            allow_inf_nan=False,
            description="Merge rows inside grid cells this many degrees wide",
        ),
    ] = None,
    min_severity: Annotated[
        float | None,
        Query(
            ge=0,
            le=MAX_MIN_SEVERITY,
            allow_inf_nan=False,
            description="Drop rows, or merged cells, with less total severity",
        ),
    ] = None,
    if_none_match: Annotated[str | None, Header()] = None,
    if_modified_since: Annotated[str | None, Header()] = None,
) -> Response:
    module = enabled.get(module_id)
    if module is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, f"Module {module_id!r} is not enabled"
        )
    if module.manifest.kind == "entities":
        if cell is not None or min_severity is not None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Module {module_id!r} does not take cell or min_severity",
            )
        view = (
            None
            if bbox is None and limit is None
            else parse_viewport(bbox, limit or MAX_LIMIT, None, None)
        )
        layer = await cache.get_entities(module_id, view)
    elif module.manifest.viewport_lookback_seconds is None:
        if any(value is not None for value in (bbox, limit, cell, min_severity)):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Module {module_id!r} does not take bbox, limit, cell or min_severity",
            )
        layer = await cache.get(module_id)
    else:
        layer = await cache.get_view(
            module_id, parse_viewport(bbox, limit, cell, min_severity)
        )
    headers = cache_headers(layer)
    if not_modified(layer, if_none_match, if_modified_since):
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    return Response(content=layer.body, media_type="application/json", headers=headers)
