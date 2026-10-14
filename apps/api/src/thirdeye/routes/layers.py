from datetime import UTC
from email.utils import format_datetime, parsedate_to_datetime
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Response, status

from thirdeye.deps import EnabledDep, LayerCacheDep
from thirdeye.layers import CachedLayer, Layer

router = APIRouter(tags=["layers"])

CACHE_CONTROL = "no-cache"


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
    if_none_match: Annotated[str | None, Header()] = None,
    if_modified_since: Annotated[str | None, Header()] = None,
) -> Response:
    if module_id not in enabled:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, f"Module {module_id!r} is not enabled"
        )
    layer = await cache.get(module_id)
    headers = cache_headers(layer)
    if not_modified(layer, if_none_match, if_modified_since):
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    return Response(content=layer.body, media_type="application/json", headers=headers)
