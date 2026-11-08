import json
import os
import zlib
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from thirdeye.frames import (
    ALT_LIMIT,
    ANGLE_SCALE,
    COORD_SCALE,
    HEADER,
    KIND_DELTA,
    KIND_SNAPSHOT,
    MAGIC,
    NULL_I16,
    NULL_U16,
    Col,
    FrameError,
    SlotTable,
    compress,
    decode,
    decompress,
    pack_alt,
    pack_angle,
    pack_speed,
    pick_encoding,
    profile_for,
    shuffle,
    unshuffle,
)
from thirdeye.layers import EntityRow

GOLDEN = Path(__file__).resolve().parents[3] / "contracts" / "frames"
T0 = datetime(2026, 10, 14, 6, 0, tzinfo=UTC)
FETCHED_MS = T0.timestamp() * 1000.0


def row(n: int, **changes: Any) -> EntityRow:
    base: dict[str, Any] = {
        "id": f"a0000000-0000-4000-8000-{n:012d}",
        "kind": "aircraft",
        "name": f"PLANE{n}",
        "lon": 90.0 + n / 10,
        "lat": 23.0 + n / 100,
        "t": T0 + timedelta(seconds=n),
        "sog": 230.5,
        "cog": 91.25,
        "heading": 90.0,
        "alt": 10_000.4,
        "confidence": "observed",
        "attrs": {},
    }
    return EntityRow.model_validate(base | changes)


def named(decoded: Any) -> dict[str, Any]:
    names = {col.value: col.name.lower() for col in Col}
    return {
        "kind": decoded.kind,
        "version": decoded.version,
        "baseVersion": decoded.base_version,
        "slotEpoch": decoded.slot_epoch,
        "fetchedMs": decoded.fetched_ms,
        "rows": decoded.rows,
        "columns": {names[col]: values for col, values in decoded.columns.items()},
        "removes": decoded.removes,
        "dictionary": [
            {"slot": slot, "id": id_, "name": name}
            for slot, id_, name in decoded.dictionary
        ],
    }


def golden_cases() -> dict[str, bytes]:
    table = SlotTable(profile_for("aircraft"))
    table.apply(
        [
            row(1),
            row(2, sog=None, cog=None, heading=None, alt=None, name="Ünïcode ✈"),
            row(3, attrs={"on_ground": True}, alt=-12.4, lon=-179.9999999, lat=-89.5),
        ],
        [],
    )
    snapshot = table.snapshot(1, FETCHED_MS)
    applied = table.apply(
        [
            row(1, lon=90.5, t=T0 + timedelta(seconds=60)),
            row(2, name="Renamed"),
            row(4),
        ],
        [row(3).id],
    )
    delta = table.delta(applied, 2, FETCHED_MS + 5000)
    quiet = table.apply([], [])
    empty = table.delta(quiet, 3, FETCHED_MS + 10_000)
    vessels = SlotTable(profile_for("vessels"))
    vessels.apply(
        [
            row(1, kind="vessel", attrs={"ship_type": "cargo"}),
            row(2, kind="vessel", attrs={"ship_type": "military"}),
            row(3, kind="vessel", attrs={"ship_type": "strange"}),
            row(4, kind="vessel", attrs={}),
        ],
        [],
    )
    return {
        "snapshot-aircraft": snapshot,
        "delta-aircraft": delta,
        "delta-empty": empty,
        "snapshot-vessels": vessels.snapshot(7, FETCHED_MS),
    }


def test_golden_vectors_match_the_encoder() -> None:
    cases = golden_cases()
    if os.environ.get("UPDATE_GOLDEN") == "1":
        GOLDEN.mkdir(parents=True, exist_ok=True)
        for name, frame in cases.items():
            (GOLDEN / f"{name}.bin").write_bytes(frame)
            (GOLDEN / f"{name}.json").write_text(
                json.dumps(named(decode(frame)), indent=2, ensure_ascii=False) + "\n"
            )
    for name, frame in cases.items():
        assert (GOLDEN / f"{name}.bin").read_bytes() == frame, name
        expected = json.loads((GOLDEN / f"{name}.json").read_text())
        assert named(decode(frame)) == expected, name


def test_a_snapshot_round_trips_within_quantisation() -> None:
    table = SlotTable(profile_for("aircraft"))
    rows = [row(n) for n in range(1, 6)]
    table.apply(rows, [])
    decoded = decode(table.snapshot(1, FETCHED_MS))
    assert decoded.kind == KIND_SNAPSHOT
    assert decoded.rows == 5
    assert decoded.version == 1
    assert decoded.base_version == 0
    assert decoded.fetched_ms == FETCHED_MS
    cols = decoded.columns
    for index, original in enumerate(rows):
        assert cols[Col.LON][index] / COORD_SCALE == pytest.approx(
            original.lon, abs=1e-7
        )
        assert cols[Col.LAT][index] / COORD_SCALE == pytest.approx(
            original.lat, abs=1e-7
        )
        assert cols[Col.T][index] == int(original.t.timestamp())
        assert cols[Col.SOG][index] == 2305
        assert cols[Col.COG][index] / ANGLE_SCALE == pytest.approx(91.25)
        assert cols[Col.ALT][index] == 10_000
    assert [entry[1:] for entry in decoded.dictionary] == [(r.id, r.name) for r in rows]


def test_nulls_use_their_sentinels() -> None:
    table = SlotTable(profile_for("aircraft"))
    table.apply([row(1, sog=None, cog=None, heading=None, alt=None)], [])
    cols = decode(table.snapshot(1, 0.0)).columns
    assert cols[Col.SOG] == [NULL_U16]
    assert cols[Col.COG] == [NULL_U16]
    assert cols[Col.HEADING] == [NULL_U16]
    assert cols[Col.ALT] == [NULL_I16]


def test_out_of_range_coordinates_and_times_are_clamped() -> None:
    table = SlotTable(profile_for("aircraft"))
    table.apply([row(1, lon=400.0, lat=-120.0, t=datetime(1960, 1, 1, tzinfo=UTC))], [])
    cols = decode(table.snapshot(1, 0.0)).columns
    assert cols[Col.LON] == [180 * COORD_SCALE]
    assert cols[Col.LAT] == [-90 * COORD_SCALE]
    assert cols[Col.T] == [0]


def test_quantisers_clamp_and_wrap() -> None:
    assert pack_speed(-5.0) == 0
    assert pack_speed(1e9) == NULL_U16 - 1
    assert pack_angle(360.0) == 0
    assert pack_angle(-90.0) == 270 * ANGLE_SCALE
    assert pack_alt(99_999.0) == ALT_LIMIT
    assert pack_alt(-99_999.0) == -ALT_LIMIT


def test_a_delta_carries_only_what_changed() -> None:
    table = SlotTable(profile_for("aircraft"))
    table.apply([row(1), row(2), row(3)], [])
    applied = table.apply([row(1), row(2, lon=10.0)], [row(3).id])
    decoded = decode(table.delta(applied, 2, FETCHED_MS))
    assert decoded.kind == KIND_DELTA
    assert decoded.base_version == 1
    assert decoded.columns[Col.SLOT] == [1]
    assert decoded.removes == [2]
    assert decoded.dictionary == []


def test_a_rename_travels_in_the_dictionary_without_a_row() -> None:
    table = SlotTable(profile_for("aircraft"))
    table.apply([row(1)], [])
    applied = table.apply([row(1, name="Renamed")], [])
    decoded = decode(table.delta(applied, 2, FETCHED_MS))
    assert decoded.rows == 0
    assert decoded.dictionary == [(0, row(1).id, "Renamed")]


def test_an_empty_delta_is_a_valid_frame() -> None:
    table = SlotTable(profile_for("aircraft"))
    table.apply([row(1)], [])
    decoded = decode(table.delta(table.apply([], []), 2, FETCHED_MS))
    assert decoded.rows == 0
    assert decoded.removes == []


def test_slots_are_stable_and_never_reused() -> None:
    table = SlotTable(profile_for("aircraft"))
    table.apply([row(1), row(2)], [])
    first, second = table.slot_of(row(1).id), table.slot_of(row(2).id)
    table.apply([], [row(1).id])
    table.apply([row(3)], [])
    assert table.slot_of(row(2).id) == second
    assert table.slot_of(row(3).id) == 2
    table.apply([row(1)], [])
    assert table.slot_of(row(1).id) == 3
    assert first == 0


def test_removing_an_unknown_id_is_ignored() -> None:
    table = SlotTable(profile_for("aircraft"))
    applied = table.apply([], ["nobody"])
    assert applied.removed == ()


def test_compaction_renumbers_slots_and_bumps_the_epoch() -> None:
    table = SlotTable(profile_for("aircraft"))
    count = 3000
    table.apply([row(n) for n in range(count)], [])
    applied = table.apply([], [row(n).id for n in range(2000)])
    assert applied.compacted
    epoch = table.slot_epoch
    table.compact()
    assert table.slot_epoch == epoch + 1
    assert len(table) == 1000
    assert table.slots == 1000
    assert table.slot_of(row(2500).id) == 500
    decoded = decode(table.snapshot(9, 0.0))
    assert decoded.rows == 1000
    assert decoded.slot_epoch == epoch + 1


def test_vessel_classes_follow_the_ship_type() -> None:
    table = SlotTable(profile_for("vessels"))
    table.apply(
        [
            row(1, attrs={"ship_type": "cargo"}),
            row(2, attrs={"ship_type": "other"}),
            row(3, attrs={"ship_type": "never-heard-of-it"}),
            row(4, attrs={}),
        ],
        [],
    )
    assert decode(table.snapshot(1, 0.0)).columns[Col.CLASS] == [1, 8, 8, 0]


def test_byte_shuffle_is_reversible() -> None:
    data = bytes(range(256)) * 3
    for width in (1, 2, 4):
        assert unshuffle(shuffle(data, width), width) == data


def test_a_corrupt_frame_is_refused() -> None:
    table = SlotTable(profile_for("aircraft"))
    table.apply([row(1)], [])
    frame = table.snapshot(1, 0.0)
    with pytest.raises(FrameError):
        decode(frame[:10])
    with pytest.raises(FrameError):
        decode(b"XXXX" + frame[4:])
    with pytest.raises(FrameError):
        decode(frame[: HEADER.size + 3])
    assert frame[:4] == MAGIC


def test_unknown_columns_are_skipped_by_the_reference_decoder() -> None:
    from thirdeye.frames import Column, Dtype, build_frame, int_column

    table = SlotTable(profile_for("aircraft"))
    table.apply([row(1)], [])
    base = decode(table.snapshot(1, 0.0))
    columns = [int_column(Col.SLOT, Dtype.U32, base.columns[Col.SLOT])]
    for col in (Col.LON, Col.LAT, Col.T):
        columns.append(int_column(col, Dtype.I32, base.columns[col]))
    columns += [
        int_column(Col.SOG, Dtype.U16, base.columns[Col.SOG]),
        int_column(Col.COG, Dtype.U16, base.columns[Col.COG]),
        int_column(Col.HEADING, Dtype.U16, base.columns[Col.HEADING]),
        int_column(Col.ALT, Dtype.I16, base.columns[Col.ALT]),
        Column(Col.FLAGS, Dtype.U8, bytes(base.columns[Col.FLAGS])),
        Column(Col.CLASS, Dtype.U8, bytes(base.columns[Col.CLASS])),
        Column(Col.CONFIDENCE, Dtype.U8, bytes(base.columns[Col.CONFIDENCE])),
        Column(200, Dtype.U32, b"\x01\x02\x03\x04"),
    ]
    frame = build_frame(
        kind=KIND_SNAPSHOT,
        version=1,
        base_version=0,
        slot_epoch=1,
        rows=1,
        removes=0,
        dictionary=0,
        fetched_ms=0.0,
        columns=columns,
    )
    assert decode(frame).columns[Col.LON] == base.columns[Col.LON]


@pytest.mark.parametrize("encoding", ["zstd", "gzip", "identity"])
def test_compression_round_trips(encoding: str) -> None:
    table = SlotTable(profile_for("aircraft"))
    table.apply([row(n) for n in range(200)], [])
    frame = table.snapshot(1, 0.0)
    packed = compress(frame, encoding)
    assert decompress(packed, encoding) == frame
    if encoding != "identity":
        assert len(packed) < len(frame)
    if encoding == "gzip":
        assert zlib.decompress(packed, 31) == frame


def test_encoding_is_deterministic() -> None:
    first = golden_cases()
    second = golden_cases()
    assert first == second
    assert compress(first["snapshot-aircraft"], "gzip") == compress(
        second["snapshot-aircraft"], "gzip"
    )


@pytest.mark.parametrize(
    ("header", "chosen"),
    [
        (None, "identity"),
        ("", "identity"),
        ("gzip, deflate, br, zstd", "zstd"),
        ("gzip, deflate", "gzip"),
        ("br", "identity"),
        ("zstd;q=0, gzip", "gzip"),
        ("*", "zstd"),
        ("gzip;q=0.5, zstd;q=0.4", "zstd"),
        ("identity", "identity"),
        ("zstd;q=nonsense, gzip", "gzip"),
    ],
)
def test_encoding_negotiation(header: str | None, chosen: str) -> None:
    assert pick_encoding(header) == chosen
