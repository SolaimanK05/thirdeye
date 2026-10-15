from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from uuid import UUID

from pydantic import JsonValue

from thirdeye.ontology import EntityKind, EntityReport

STRONG_KEYS = ("imo", "norad_id", "lei", "osm_id", "wpi")
WEAK_KEYS = ("mmsi", "icao24", "reg")
WEAK_WINDOW = timedelta(hours=24)

type KeyValue = tuple[str, str]


@dataclass(frozen=True, slots=True)
class Candidate:
    id: UUID
    kind: EntityKind
    identifiers: Mapping[str, object]
    last_seen: datetime


@dataclass(frozen=True, slots=True)
class Resolution:
    entity_id: UUID | None
    members: tuple[int, ...]


@dataclass(slots=True)
class _Group:
    kind: EntityKind
    strong: dict[str, str]
    weak: dict[str, set[str]]
    entity_id: UUID | None
    recent: bool
    members: list[int] = field(default_factory=list)


def key_text(value: object) -> str | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return str(value)
    if isinstance(value, str):
        text = value.strip()
        return text or None
    return None


def keys_of(identifiers: Mapping[str, object], names: Sequence[str]) -> dict[str, str]:
    found: dict[str, str] = {}
    for key in names:
        text = key_text(identifiers.get(key))
        if text is not None:
            found[key] = text
    return found


def _group_for_candidate(candidate: Candidate, now: datetime) -> _Group:
    weak_values = keys_of(candidate.identifiers, WEAK_KEYS)
    return _Group(
        kind=candidate.kind,
        strong=keys_of(candidate.identifiers, STRONG_KEYS),
        weak={key: {value} for key, value in weak_values.items()},
        entity_id=candidate.id,
        recent=now - candidate.last_seen <= WEAK_WINDOW,
    )


def _conflicts(group: _Group, strong: Mapping[str, str]) -> bool:
    return any(
        key in group.strong and group.strong[key] != value
        for key, value in strong.items()
    )


class _Index:
    def __init__(self) -> None:
        self.strong: dict[tuple[EntityKind, str, str], _Group] = {}
        self.weak: dict[tuple[EntityKind, str, str], list[_Group]] = {}

    def add(self, group: _Group) -> None:
        for key, value in group.strong.items():
            self.strong.setdefault((group.kind, key, value), group)
        for key, values in group.weak.items():
            for value in values:
                bucket = self.weak.setdefault((group.kind, key, value), [])
                if group not in bucket:
                    bucket.append(group)

    def match(
        self,
        kind: EntityKind,
        strong: Mapping[str, str],
        weak: Mapping[str, str],
    ) -> _Group | None:
        for key in STRONG_KEYS:
            if key in strong:
                found = self.strong.get((kind, key, strong[key]))
                if found is not None and not _conflicts(found, strong):
                    return found
        for key in WEAK_KEYS:
            if key not in weak:
                continue
            for group in self.weak.get((kind, key, weak[key]), []):
                if group.recent and not _conflicts(group, strong):
                    return group
        return None


def resolve(
    reports: Sequence[EntityReport],
    candidates: Sequence[Candidate],
    now: datetime,
) -> list[Resolution]:
    index = _Index()
    ordered = sorted(candidates, key=lambda c: (c.last_seen, str(c.id)), reverse=True)
    for candidate in ordered:
        index.add(_group_for_candidate(candidate, now))

    groups: list[_Group] = []
    for position, report in enumerate(reports):
        identifiers = report.entity.identifiers.model_dump()
        strong = keys_of(identifiers, STRONG_KEYS)
        weak = keys_of(identifiers, WEAK_KEYS)
        group = index.match(report.entity.kind, strong, weak)
        if group is None:
            group = _Group(
                kind=report.entity.kind,
                strong={},
                weak={},
                entity_id=None,
                recent=True,
            )
        if not group.members:
            groups.append(group)
        group.members.append(position)
        group.recent = True
        for key, value in strong.items():
            group.strong.setdefault(key, value)
        for key, value in weak.items():
            group.weak.setdefault(key, set()).add(value)
        index.add(group)

    return [
        Resolution(entity_id=group.entity_id, members=tuple(group.members))
        for group in groups
    ]


def display_name(
    names: Sequence[str],
    identifiers: Mapping[str, JsonValue],
    entity_id: UUID | str,
) -> str:
    for name in names:
        if name.strip():
            return name.strip()
    for value in identifiers.values():
        text = key_text(value)
        if text is not None:
            return text
    return str(entity_id)[:8]
