from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Path, Query, Response, status

from thirdeye.deps import BroadcasterDep
from thirdeye.frames import has_frames, pick_encoding
from thirdeye.movers import FrameBody

router = APIRouter(prefix="/movers", tags=["movers"])

FRAME_TYPE = "application/vnd.thirdeye.frame"
IMMUTABLE = "public, max-age=31536000, immutable"
REVALIDATE = "no-cache"

ModuleId = Annotated[str, Path(pattern=r"^[a-z][a-z0-9_-]{1,39}$")]
FRAME_RESPONSES: dict[int | str, dict[str, object]] = {
    200: {
        "description": "A TEF1 binary frame, compressed by Accept-Encoding.",
        "content": {FRAME_TYPE: {"schema": {"type": "string", "format": "binary"}}},
    },
    304: {"description": "The client already has this version."},
    404: {"description": "No such module, or the frame left the retained window."},
}


def frame_response(
    found: FrameBody | None,
    *,
    missing: str,
    if_none_match: str | None = None,
) -> Response:
    if found is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, missing)
    suffix = "" if found.encoding == "identity" else f"-{found.encoding}"
    tag = f'"{found.slot_epoch}-{found.version}{suffix}"'
    headers = {
        "ETag": tag,
        "Cache-Control": IMMUTABLE if found.immutable else REVALIDATE,
        "Vary": "Accept-Encoding",
        "X-Frame-Version": str(found.version),
        "X-Slot-Epoch": str(found.slot_epoch),
    }
    if if_none_match is not None and tag in {
        part.strip().removeprefix("W/") for part in if_none_match.split(",")
    }:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    if found.encoding != "identity":
        headers["Content-Encoding"] = found.encoding
    return Response(found.body, media_type=FRAME_TYPE, headers=headers)


@router.get(
    "/{module_id}/snapshot",
    summary="Full current state of a moving-entity module as one binary frame",
    response_class=Response,
    responses=FRAME_RESPONSES,
)
async def snapshot(
    module_id: ModuleId,
    broadcaster: BroadcasterDep,
    accept_encoding: Annotated[str | None, Header(max_length=200)] = None,
    if_none_match: Annotated[str | None, Header(max_length=200)] = None,
) -> Response:
    if not has_frames(module_id) or module_id not in broadcaster.mover_modules:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such moving-entity module")
    found = await broadcaster.frame_snapshot(module_id, pick_encoding(accept_encoding))
    return frame_response(
        found, missing="No such moving-entity module", if_none_match=if_none_match
    )


@router.get(
    "/{module_id}/frames/{version}",
    summary="The delta frame that produced a version from the one before it",
    response_class=Response,
    responses=FRAME_RESPONSES,
)
async def frame(
    module_id: ModuleId,
    version: Annotated[int, Path(ge=2, le=4_294_967_295)],
    epoch: Annotated[int, Query(ge=1, le=4_294_967_295)],
    broadcaster: BroadcasterDep,
    accept_encoding: Annotated[str | None, Header(max_length=200)] = None,
) -> Response:
    found = await broadcaster.frame_delta(
        module_id, version, epoch, pick_encoding(accept_encoding)
    )
    return frame_response(found, missing="That frame is no longer retained")
