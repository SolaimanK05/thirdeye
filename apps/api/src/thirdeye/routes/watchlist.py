from uuid import UUID

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import AwareDatetime, JsonValue

from thirdeye.deps import ReaderDep, SettingsDep, WriterDep
from thirdeye.ontology import EntityKind
from thirdeye.reads import WatchRecord
from thirdeye.routes.models import Out, Position

router = APIRouter(tags=["watchlist"])

READ_ONLY = "Starring is turned off on a public instance"


class WatchItem(Out):
    entity_id: UUID
    name: str
    kind: EntityKind
    module_id: str
    added_at: AwareDatetime
    last_seen: AwareDatetime
    position: Position | None


class Watchlist(Out):
    writable: bool
    items: list[WatchItem]


def display_name(
    names: list[str], identifiers: dict[str, JsonValue], entity_id: UUID
) -> str:
    for name in names:
        if name.strip():
            return name.strip()
    for value in identifiers.values():
        if isinstance(value, str) and value.strip():
            return value.strip()
    return str(entity_id)[:8]


def watch_item(record: WatchRecord) -> WatchItem:
    return WatchItem(
        entity_id=record.entity_id,
        name=display_name(record.names, record.identifiers, record.entity_id),
        kind=record.kind,
        module_id=record.module_id,
        added_at=record.added_at,
        last_seen=record.last_seen,
        position=(
            None
            if record.lon is None or record.lat is None
            else Position(lon=record.lon, lat=record.lat)
        ),
    )


@router.get("/watchlist")
async def get_watchlist(reader: ReaderDep, settings: SettingsDep) -> Watchlist:
    records = await reader.watchlist()
    return Watchlist(
        writable=not settings.public_instance,
        items=[watch_item(record) for record in records],
    )


@router.put("/watchlist/{entity_id}", status_code=status.HTTP_204_NO_CONTENT)
async def star(entity_id: UUID, writer: WriterDep, settings: SettingsDep) -> Response:
    if settings.public_instance:
        raise HTTPException(status.HTTP_403_FORBIDDEN, READ_ONLY)
    if not await writer.star(entity_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No entity {entity_id}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/watchlist/{entity_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unstar(entity_id: UUID, writer: WriterDep, settings: SettingsDep) -> Response:
    if settings.public_instance:
        raise HTTPException(status.HTTP_403_FORBIDDEN, READ_ONLY)
    await writer.unstar(entity_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
