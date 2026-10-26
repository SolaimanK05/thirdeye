from collections.abc import AsyncIterable
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from fastapi.sse import EventSourceResponse, ServerSentEvent

from thirdeye.deps import BroadcasterDep

router = APIRouter(tags=["stream"])

ENTITIES_DESCRIPTION = (
    "Comma separated entity module ids that get snapshot and delta events. "
    "Leave it out for every enabled entity module, or send it empty for none."
)


async def entity_selection(
    broadcaster: BroadcasterDep,
    entities: Annotated[
        str | None, Query(description=ENTITIES_DESCRIPTION, max_length=500)
    ] = None,
) -> frozenset[str]:
    available = broadcaster.entity_modules
    if entities is None:
        wanted = available
    else:
        wanted = frozenset(part.strip() for part in entities.split(",") if part.strip())
        unknown = sorted(wanted - available)
        if unknown:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f"Not enabled entity modules: {', '.join(unknown)}",
            )
    await broadcaster.ready(wanted)
    return wanted


@router.get(
    "/stream",
    response_class=EventSourceResponse,
    summary="Live updates as server-sent events",
    description=(
        "Events: hello (server_time, instance, resumed), layer (module_id, "
        "fetched_at, version), snapshot (a module's full entity rows) and delta "
        "(upserts and removes since the previous version). Event ids are "
        "opaque; send the last one back in Last-Event-ID to resume from the "
        "server's recent buffer, or get fresh snapshots when it is too old."
    ),
)
async def stream(
    broadcaster: BroadcasterDep,
    wanted: Annotated[frozenset[str], Depends(entity_selection)],
    last_event_id: Annotated[str | None, Header(max_length=100)] = None,
) -> AsyncIterable[ServerSentEvent]:
    subscriber = broadcaster.subscribe(wanted, last_event_id)
    try:
        while (event := await subscriber.next()) is not None:
            yield ServerSentEvent(
                event=event.kind,
                raw_data=event.data,
                id=event.id,
                retry=event.retry,
            )
    finally:
        broadcaster.unsubscribe(subscriber)
