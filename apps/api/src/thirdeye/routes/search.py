from typing import Annotated, Literal

from fastapi import APIRouter, Query
from pydantic import AwareDatetime, JsonValue, StringConstraints

from thirdeye.deps import EnabledDep, ReaderDep
from thirdeye.identity import key_text
from thirdeye.reads import SearchRecord
from thirdeye.routes.models import Out, Position

router = APIRouter(tags=["search"])

DEFAULT_LIMIT = 8
MAX_LIMIT = 25
MIN_QUERY = 2
MAX_QUERY = 80

Text = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=MIN_QUERY, max_length=MAX_QUERY
    ),
]


class SearchHit(Out):
    kind: Literal["event", "entity"]
    id: str
    module_id: str
    category: str
    label: str
    detail: str | None
    severity: float | None
    t: AwareDatetime | None
    position: Position | None
    starred: bool


class SearchResults(Out):
    query: str
    results: list[SearchHit]


IDENTIFIER_LINE = (
    ("imo", "IMO"),
    ("mmsi", "MMSI"),
    ("icao24", "ICAO24"),
    ("callsign", "CALLSIGN"),
    ("reg", "REG"),
    ("norad_id", "NORAD"),
    ("wpi", "WPI"),
    ("unlocode", "UN/LOCODE"),
    ("lei", "LEI"),
    ("osm_id", "OSM"),
)


def identifier_line(identifiers: dict[str, JsonValue] | None) -> str | None:
    if not identifiers:
        return None
    parts = [
        f"{label} {text}"
        for key, label in IDENTIFIER_LINE
        if (text := key_text(identifiers.get(key))) is not None
    ]
    return ", ".join(parts) or None


def humanize(category: str) -> str:
    text = category.replace("-", " ").replace("_", " ").strip()
    return text[:1].upper() + text[1:]


def search_hit(record: SearchRecord) -> SearchHit:
    return SearchHit(
        kind=record.kind,
        id=record.id,
        module_id=record.module_id,
        category=record.category,
        label=(record.label or "").strip() or humanize(record.category),
        detail=identifier_line(record.identifiers),
        severity=record.severity,
        t=record.t,
        position=(
            None
            if record.lon is None or record.lat is None
            else Position(lon=record.lon, lat=record.lat)
        ),
        starred=record.starred,
    )


@router.get("/search")
async def search(
    q: Annotated[Text, Query(description="Text to look for")],
    reader: ReaderDep,
    enabled: EnabledDep,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
) -> SearchResults:
    needle = q.lower()
    named = [
        module.id
        for module in enabled.values()
        if needle in module.manifest.name.lower()
    ]
    records = await reader.search(q, list(enabled), named, limit)
    return SearchResults(query=q, results=[search_hit(r) for r in records])
