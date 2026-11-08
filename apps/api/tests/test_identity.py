from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from thirdeye.identity import Candidate, Resolution, resolve
from thirdeye.ontology import Entity, EntityKind, EntityReport, Identifiers

NOW = datetime(2026, 10, 15, 12, 0, tzinfo=UTC)


def report(
    kind: EntityKind = EntityKind.VESSEL, **identifiers: str | int
) -> EntityReport:
    return EntityReport(
        entity=Entity(
            kind=kind,
            identifiers=Identifiers.model_validate(identifiers),
            first_seen=NOW,
            last_seen=NOW,
            source_id="aisstream",
            retrieved_at=NOW,
        )
    )


def candidate(
    kind: EntityKind = EntityKind.VESSEL,
    seen: timedelta = timedelta(hours=1),
    entity_id: UUID | None = None,
    **identifiers: str | int,
) -> Candidate:
    return Candidate(
        id=entity_id or uuid4(),
        kind=kind,
        identifiers=identifiers,
        last_seen=NOW - seen,
    )


def test_no_reports_resolve_to_nothing() -> None:
    assert resolve([], [candidate(imo="1")], NOW) == []


def test_a_strong_key_matches_the_stored_entity() -> None:
    stored = candidate(imo="9123450", seen=timedelta(days=400))
    result = resolve([report(imo="9123450")], [stored], NOW)
    assert result == [Resolution(entity_id=stored.id, members=(0,))]


def test_a_strong_key_matches_whatever_the_weak_keys_say() -> None:
    stored = candidate(imo="9123450", mmsi="405000123")
    result = resolve([report(imo="9123450", mmsi="999999999")], [stored], NOW)
    assert result == [Resolution(entity_id=stored.id, members=(0,))]


def test_a_numeric_strong_key_matches_its_text_form() -> None:
    stored = candidate(EntityKind.SATELLITE, norad_id=25544)
    result = resolve([report(EntityKind.SATELLITE, norad_id=25544)], [stored], NOW)
    assert result == [Resolution(entity_id=stored.id, members=(0,))]


def test_a_weak_key_matches_inside_the_window() -> None:
    stored = candidate(mmsi="405000123", seen=timedelta(hours=23))
    result = resolve([report(mmsi="405000123")], [stored], NOW)
    assert result == [Resolution(entity_id=stored.id, members=(0,))]


def test_a_weak_key_does_not_match_outside_the_window() -> None:
    stored = candidate(mmsi="405000123", seen=timedelta(hours=25))
    result = resolve([report(mmsi="405000123")], [stored], NOW)
    assert result == [Resolution(entity_id=None, members=(0,))]


def test_a_weak_key_does_not_match_across_a_conflicting_strong_key() -> None:
    stored = candidate(mmsi="405000123", imo="9000001")
    result = resolve([report(mmsi="405000123", imo="9000002")], [stored], NOW)
    assert result == [Resolution(entity_id=None, members=(0,))]


def test_a_weak_key_matches_a_stored_entity_with_no_strong_key() -> None:
    stored = candidate(mmsi="405000123")
    result = resolve([report(mmsi="405000123", imo="9000002")], [stored], NOW)
    assert result == [Resolution(entity_id=stored.id, members=(0,))]


def test_a_report_without_a_strong_key_joins_a_stored_vessel_that_has_one() -> None:
    stored = candidate(mmsi="405000123", imo="9000001")
    result = resolve([report(mmsi="405000123")], [stored], NOW)
    assert result == [Resolution(entity_id=stored.id, members=(0,))]


def test_a_callsign_never_joins_anything() -> None:
    stored = candidate(EntityKind.AIRCRAFT, callsign="BBC123")
    result = resolve([report(EntityKind.AIRCRAFT, callsign="BBC123")], [stored], NOW)
    assert result == [Resolution(entity_id=None, members=(0,))]


def test_kinds_never_cross() -> None:
    stored = candidate(EntityKind.AIRCRAFT, icao24="abc123")
    reports = [
        report(EntityKind.VESSEL, icao24="abc123"),
        report(EntityKind.FACILITY, wpi="1"),
    ]
    assert resolve(reports, [stored], NOW) == [
        Resolution(entity_id=None, members=(0,)),
        Resolution(entity_id=None, members=(1,)),
    ]


def test_a_report_without_any_key_is_always_new() -> None:
    stored = candidate(mmsi="405000123")
    result = resolve([report(), report()], [stored], NOW)
    assert result == [
        Resolution(entity_id=None, members=(0,)),
        Resolution(entity_id=None, members=(1,)),
    ]


def test_two_reports_with_the_same_new_strong_key_become_one_entity() -> None:
    result = resolve([report(wpi="46340"), report(wpi="46340")], [], NOW)
    assert result == [Resolution(entity_id=None, members=(0, 1))]


def test_two_reports_with_the_same_weak_key_become_one_entity() -> None:
    result = resolve([report(mmsi="405000123"), report(mmsi="405000123")], [], NOW)
    assert result == [Resolution(entity_id=None, members=(0, 1))]


def test_one_mmsi_with_two_imos_stays_two_entities() -> None:
    reports = [
        report(mmsi="405000123", imo="9000001"),
        report(mmsi="405000123", imo="9000002"),
    ]
    assert resolve(reports, [], NOW) == [
        Resolution(entity_id=None, members=(0,)),
        Resolution(entity_id=None, members=(1,)),
    ]


def test_a_later_report_learns_the_strong_key_learned_earlier_in_the_batch() -> None:
    reports = [
        report(mmsi="405000123"),
        report(mmsi="405000123", imo="9000001"),
        report(imo="9000001"),
    ]
    assert resolve(reports, [], NOW) == [Resolution(entity_id=None, members=(0, 1, 2))]


def test_the_most_recently_seen_stored_entity_wins_a_weak_match() -> None:
    older = candidate(mmsi="405000123", seen=timedelta(hours=10))
    newer = candidate(mmsi="405000123", seen=timedelta(hours=2))
    result = resolve([report(mmsi="405000123")], [older, newer], NOW)
    assert result == [Resolution(entity_id=newer.id, members=(0,))]


def test_a_strong_match_beats_a_weak_match() -> None:
    weak = candidate(mmsi="405000123", seen=timedelta(minutes=1))
    strong = candidate(imo="9000001", mmsi="111111111", seen=timedelta(hours=20))
    result = resolve([report(mmsi="405000123", imo="9000001")], [weak, strong], NOW)
    assert result == [Resolution(entity_id=strong.id, members=(0,))]


def test_a_strong_match_with_a_conflicting_second_strong_key_is_refused() -> None:
    stored = candidate(EntityKind.FACILITY, wpi="1", osm_id="a")
    result = resolve([report(EntityKind.FACILITY, wpi="1", osm_id="b")], [stored], NOW)
    assert result == [Resolution(entity_id=None, members=(0,))]


def test_one_stored_entity_can_absorb_many_reports() -> None:
    stored = candidate(mmsi="405000123")
    reports = [report(mmsi="405000123"), report(mmsi="405000123")]
    assert resolve(reports, [stored], NOW) == [
        Resolution(entity_id=stored.id, members=(0, 1))
    ]


def test_results_follow_the_order_of_the_first_report() -> None:
    a = candidate(imo="1")
    b = candidate(imo="2")
    result = resolve([report(imo="2"), report(imo="1")], [a, b], NOW)
    assert [r.entity_id for r in result] == [b.id, a.id]
