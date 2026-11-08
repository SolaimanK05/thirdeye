"""Binary columnar frames for moving entities (wire format TEF1).

The format is documented in the Phase 16 spec. One frame is a header, a column
directory and 8-byte-aligned column payloads, all little-endian. Frames are
compressed by HTTP content encoding, never inside the frame.
"""

import gzip
import struct
import sys
import zlib
from array import array
from collections.abc import Callable, Iterable, Sequence
from compression import zstd
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Final

from thirdeye.layers import EntityRow
from thirdeye.ontology import Confidence

MAGIC: Final = b"TEF1"
HEADER = struct.Struct("<4sBBHIIIIIId")
ENTRY = struct.Struct("<HBBII")
ALIGN: Final = 8

KIND_SNAPSHOT: Final = 1
KIND_DELTA: Final = 2

ENC_PLAIN: Final = 0
ENC_SHUFFLE: Final = 1

COORD_SCALE: Final = 10_000_000
SPEED_SCALE: Final = 10
ANGLE_SCALE: Final = 100
NULL_U16: Final = 0xFFFF
NULL_I16: Final = -32768
ALT_LIMIT: Final = 32767

FLAG_ON_GROUND: Final = 1

MAX_SLOTS: Final = 4_000_000
COMPACT_RATIO: Final = 0.5
COMPACT_MINIMUM: Final = 1024

LITTLE: Final = sys.byteorder == "little"


class Dtype(IntEnum):
    U8 = 1
    U16 = 2
    I16 = 3
    U32 = 4
    I32 = 5


TYPECODE: Final = {
    Dtype.U8: "B",
    Dtype.U16: "H",
    Dtype.I16: "h",
    Dtype.U32: "I",
    Dtype.I32: "i",
}
WIDTH: Final = {Dtype.U8: 1, Dtype.U16: 2, Dtype.I16: 2, Dtype.U32: 4, Dtype.I32: 4}


class Col(IntEnum):
    SLOT = 1
    LON = 2
    LAT = 3
    T = 4
    SOG = 5
    COG = 6
    HEADING = 7
    ALT = 8
    FLAGS = 9
    CLASS = 10
    CONFIDENCE = 11
    REMOVES = 16
    DICT_SLOT = 20
    DICT_ID_OFF = 21
    DICT_ID = 22
    DICT_NAME_OFF = 23
    DICT_NAME = 24


ROW_COLUMNS: Final = (
    (Col.SLOT, Dtype.U32),
    (Col.LON, Dtype.I32),
    (Col.LAT, Dtype.I32),
    (Col.T, Dtype.U32),
    (Col.SOG, Dtype.U16),
    (Col.COG, Dtype.U16),
    (Col.HEADING, Dtype.U16),
    (Col.ALT, Dtype.I16),
    (Col.FLAGS, Dtype.U8),
    (Col.CLASS, Dtype.U8),
    (Col.CONFIDENCE, Dtype.U8),
)
SHUFFLED: Final = frozenset({Col.SLOT, Col.LON, Col.LAT, Col.T})
CONFIDENCES: Final = tuple(Confidence)

if (array("I").itemsize, array("i").itemsize) != (4, 4) or (
    array("H").itemsize,
    array("h").itemsize,
) != (2, 2):
    raise ImportError("this platform's C integer sizes do not fit the TEF1 layout")


class FrameError(ValueError):
    pass


type ClassOf = Callable[[EntityRow], int]

VESSEL_CLASSES: Final = (
    "cargo",
    "tanker",
    "passenger",
    "fishing",
    "tug",
    "pleasure",
    "military",
    "other",
)


@dataclass(frozen=True, slots=True)
class Profile:
    class_of: ClassOf
    classes: tuple[str, ...] = ()


def no_class(row: EntityRow) -> int:
    return 0


def vessel_class(row: EntityRow) -> int:
    value = row.attrs.get("ship_type")
    if not isinstance(value, str):
        return 0
    if value in VESSEL_CLASSES:
        return VESSEL_CLASSES.index(value) + 1
    return len(VESSEL_CLASSES)


PROFILES: Final[dict[str, Profile]] = {
    "aircraft": Profile(no_class),
    "vessels": Profile(vessel_class, VESSEL_CLASSES),
    "synthetic": Profile(no_class),
}


def has_frames(module_id: str) -> bool:
    return module_id in PROFILES


def profile_for(module_id: str) -> Profile:
    return PROFILES.get(module_id, Profile(no_class))


def clamp(value: int, low: int, high: int) -> int:
    return low if value < low else min(value, high)


def pack_coord(degrees: float, limit: float = 180.0) -> int:
    return clamp(
        round(degrees * COORD_SCALE),
        -round(limit * COORD_SCALE),
        round(limit * COORD_SCALE),
    )


def pack_speed(value: float | None) -> int:
    if value is None:
        return NULL_U16
    return clamp(round(value * SPEED_SCALE), 0, NULL_U16 - 1)


def pack_angle(value: float | None) -> int:
    if value is None:
        return NULL_U16
    return round((value % 360.0) * ANGLE_SCALE)


def pack_alt(value: float | None) -> int:
    if value is None:
        return NULL_I16
    return clamp(round(value), -ALT_LIMIT, ALT_LIMIT)


def pack_time(row: EntityRow) -> int:
    return clamp(int(row.t.timestamp()), 0, 0xFFFFFFFF)


type Fix = tuple[int, int, int, int, int, int, int, int, int, int]


def pack_row(row: EntityRow, profile: Profile) -> Fix:
    flags = FLAG_ON_GROUND if row.attrs.get("on_ground") is True else 0
    return (
        pack_coord(row.lon),
        pack_coord(row.lat, 90.0),
        pack_time(row),
        pack_speed(row.sog),
        pack_angle(row.cog),
        pack_angle(row.heading),
        pack_alt(row.alt),
        flags,
        profile.class_of(row),
        CONFIDENCES.index(row.confidence),
    )


def to_bytes(values: array[int]) -> bytes:
    if not LITTLE and values.itemsize > 1:
        values = array(values.typecode, values)
        values.byteswap()
    return values.tobytes()


def shuffle(data: bytes, width: int) -> bytes:
    if width == 1 or not data:
        return data
    return b"".join(data[offset::width] for offset in range(width))


def unshuffle(data: bytes, width: int) -> bytes:
    if width == 1 or not data:
        return data
    count = len(data) // width
    out = bytearray(len(data))
    for offset in range(width):
        out[offset::width] = data[offset * count : (offset + 1) * count]
    return bytes(out)


@dataclass(frozen=True, slots=True)
class Column:
    id: int
    dtype: Dtype
    data: bytes
    shuffled: bool = False


def int_column(col: Col, dtype: Dtype, values: Iterable[int]) -> Column:
    packed = to_bytes(array(TYPECODE[dtype], values))
    if col in SHUFFLED:
        return Column(col, dtype, shuffle(packed, WIDTH[dtype]), shuffled=True)
    return Column(col, dtype, packed)


def align(offset: int) -> int:
    return (offset + ALIGN - 1) & ~(ALIGN - 1)


def build_frame(
    *,
    kind: int,
    version: int,
    base_version: int,
    slot_epoch: int,
    rows: int,
    removes: int,
    dictionary: int,
    fetched_ms: float,
    columns: Sequence[Column],
) -> bytes:
    start = align(HEADER.size + ENTRY.size * len(columns))
    offsets: list[int] = []
    cursor = start
    for column in columns:
        offsets.append(cursor)
        cursor = align(cursor + len(column.data))
    out = bytearray(cursor)
    HEADER.pack_into(
        out,
        0,
        MAGIC,
        kind,
        0,
        len(columns),
        version,
        base_version,
        slot_epoch,
        rows,
        removes,
        dictionary,
        fetched_ms,
    )
    for index, (column, offset) in enumerate(zip(columns, offsets, strict=True)):
        ENTRY.pack_into(
            out,
            HEADER.size + ENTRY.size * index,
            column.id,
            column.dtype,
            ENC_SHUFFLE if column.shuffled else ENC_PLAIN,
            offset,
            len(column.data),
        )
        out[offset : offset + len(column.data)] = column.data
    return bytes(out)


@dataclass(slots=True)
class Decoded:
    kind: int
    version: int
    base_version: int
    slot_epoch: int
    fetched_ms: float
    rows: int
    columns: dict[int, list[int]] = field(default_factory=dict)
    removes: list[int] = field(default_factory=list)
    dictionary: list[tuple[int, str, str]] = field(default_factory=list)


def decode(frame: bytes) -> Decoded:
    if len(frame) < HEADER.size:
        raise FrameError("frame is shorter than its header")
    (
        magic,
        kind,
        _reserved,
        count,
        version,
        base_version,
        slot_epoch,
        rows,
        removes,
        dictionary,
        fetched_ms,
    ) = HEADER.unpack_from(frame, 0)
    if magic != MAGIC:
        raise FrameError("not a TEF1 frame")
    if kind not in (KIND_SNAPSHOT, KIND_DELTA):
        raise FrameError(f"unknown frame kind {kind}")
    if len(frame) < HEADER.size + ENTRY.size * count:
        raise FrameError("frame ends inside its column directory")
    raw: dict[int, list[int] | bytes] = {}
    for index in range(count):
        col, dtype, encoding, offset, length = ENTRY.unpack_from(
            frame, HEADER.size + ENTRY.size * index
        )
        if offset + length > len(frame) or offset % ALIGN:
            raise FrameError(f"column {col} lies outside the frame")
        try:
            kind_of = Dtype(dtype)
        except ValueError:
            continue
        width = WIDTH[kind_of]
        if length % width:
            raise FrameError(f"column {col} has a ragged length")
        body = bytes(frame[offset : offset + length])
        if encoding == ENC_SHUFFLE:
            body = unshuffle(body, width)
        elif encoding != ENC_PLAIN:
            continue
        if kind_of is Dtype.U8 and col in (Col.DICT_ID, Col.DICT_NAME):
            raw[col] = body
            continue
        values = array(TYPECODE[kind_of])
        values.frombytes(body)
        if not LITTLE:
            values.byteswap()
        raw[col] = values.tolist()
    result = Decoded(kind, version, base_version, slot_epoch, fetched_ms, rows)
    for col, _dtype in ROW_COLUMNS:
        found = raw.get(col)
        if not isinstance(found, list) or len(found) != rows:
            raise FrameError(f"column {col.name} is missing or the wrong length")
        result.columns[col] = found
    removed = raw.get(Col.REMOVES, [])
    if not isinstance(removed, list) or len(removed) != removes:
        raise FrameError("removes column is missing or the wrong length")
    result.removes = removed
    result.dictionary = decode_dictionary(raw, dictionary)
    return result


def decode_dictionary(
    raw: dict[int, list[int] | bytes], count: int
) -> list[tuple[int, str, str]]:
    if count == 0:
        return []
    slots = raw.get(Col.DICT_SLOT)
    id_off = raw.get(Col.DICT_ID_OFF)
    name_off = raw.get(Col.DICT_NAME_OFF)
    id_bytes = raw.get(Col.DICT_ID)
    name_bytes = raw.get(Col.DICT_NAME)
    if (
        not isinstance(slots, list)
        or not isinstance(id_off, list)
        or not isinstance(name_off, list)
        or not isinstance(id_bytes, bytes)
        or not isinstance(name_bytes, bytes)
        or len(slots) != count
        or len(id_off) != count + 1
        or len(name_off) != count + 1
    ):
        raise FrameError("dictionary columns are missing or the wrong length")
    return [
        (
            slots[i],
            id_bytes[id_off[i] : id_off[i + 1]].decode(),
            name_bytes[name_off[i] : name_off[i + 1]].decode(),
        )
        for i in range(count)
    ]


def text_columns(entries: Sequence[tuple[int, str, str]]) -> list[Column]:
    if not entries:
        return []
    ids = [entry[1].encode() for entry in entries]
    names = [entry[2].encode() for entry in entries]

    def offsets(parts: list[bytes]) -> list[int]:
        out = [0]
        for part in parts:
            out.append(out[-1] + len(part))
        return out

    return [
        int_column(Col.DICT_SLOT, Dtype.U32, (entry[0] for entry in entries)),
        int_column(Col.DICT_ID_OFF, Dtype.U32, offsets(ids)),
        Column(Col.DICT_ID, Dtype.U8, b"".join(ids)),
        int_column(Col.DICT_NAME_OFF, Dtype.U32, offsets(names)),
        Column(Col.DICT_NAME, Dtype.U8, b"".join(names)),
    ]


@dataclass(frozen=True, slots=True)
class Applied:
    changed: tuple[int, ...]
    removed: tuple[int, ...]
    texts: tuple[int, ...]
    compacted: bool


class SlotTable:
    """Columnar state of one module, indexed by stable slot."""

    def __init__(self, profile: Profile, slot_epoch: int = 1) -> None:
        self.profile = profile
        self.slot_epoch = slot_epoch
        self._index: dict[str, int] = {}
        self._ids: list[str] = []
        self._names: list[str] = []
        self._alive = bytearray()
        self._cols: dict[Col, array[int]] = {
            col: array(TYPECODE[dtype]) for col, dtype in ROW_COLUMNS[1:]
        }
        self._removed = 0

    def __len__(self) -> int:
        return len(self._index)

    @property
    def slots(self) -> int:
        return len(self._ids)

    def slot_of(self, entity_id: str) -> int | None:
        return self._index.get(entity_id)

    def _append_slot(self, entity_id: str, name: str) -> int:
        slot = len(self._ids)
        if slot >= MAX_SLOTS:
            raise FrameError("slot table is full")
        self._ids.append(entity_id)
        self._names.append(name)
        self._alive.append(1)
        for col, dtype in ROW_COLUMNS[1:]:
            self._cols[col].append(NULL_I16 if dtype is Dtype.I16 else 0)
        self._index[entity_id] = slot
        return slot

    def _fix_at(self, slot: int) -> Fix:
        c = self._cols
        return (
            c[Col.LON][slot],
            c[Col.LAT][slot],
            c[Col.T][slot],
            c[Col.SOG][slot],
            c[Col.COG][slot],
            c[Col.HEADING][slot],
            c[Col.ALT][slot],
            c[Col.FLAGS][slot],
            c[Col.CLASS][slot],
            c[Col.CONFIDENCE][slot],
        )

    def _store(self, slot: int, fix: Fix) -> None:
        c = self._cols
        (
            c[Col.LON][slot],
            c[Col.LAT][slot],
            c[Col.T][slot],
            c[Col.SOG][slot],
            c[Col.COG][slot],
            c[Col.HEADING][slot],
            c[Col.ALT][slot],
            c[Col.FLAGS][slot],
            c[Col.CLASS][slot],
            c[Col.CONFIDENCE][slot],
        ) = fix

    def apply(self, upserts: Iterable[EntityRow], removes: Iterable[str]) -> Applied:
        changed: list[int] = []
        removed: list[int] = []
        texts: list[int] = []
        for entity_id in removes:
            slot = self._index.pop(entity_id, None)
            if slot is None:
                continue
            self._alive[slot] = 0
            self._removed += 1
            removed.append(slot)
        for row in upserts:
            fix = pack_row(row, self.profile)
            slot = self._index.get(row.id)
            if slot is None:
                slot = self._append_slot(row.id, row.name)
                texts.append(slot)
            else:
                if self._names[slot] != row.name:
                    self._names[slot] = row.name
                    texts.append(slot)
                if self._fix_at(slot) == fix:
                    continue
            self._store(slot, fix)
            changed.append(slot)
        return Applied(
            tuple(dict.fromkeys(changed)),
            tuple(removed),
            tuple(texts),
            self.needs_compaction(),
        )

    def needs_compaction(self) -> bool:
        return self._removed >= COMPACT_MINIMUM and self._removed > COMPACT_RATIO * len(
            self._ids
        )

    def compact(self) -> None:
        keep = [slot for slot, alive in enumerate(self._alive) if alive]
        for col in self._cols:
            source = self._cols[col]
            self._cols[col] = array(source.typecode, (source[slot] for slot in keep))
        self._ids = [self._ids[slot] for slot in keep]
        self._names = [self._names[slot] for slot in keep]
        self._alive = bytearray(b"\x01" * len(keep))
        self._index = {entity_id: slot for slot, entity_id in enumerate(self._ids)}
        self._removed = 0
        self.slot_epoch += 1

    def _rows(self, slots: Sequence[int]) -> list[Column]:
        columns = [int_column(Col.SLOT, Dtype.U32, slots)]
        for col, dtype in ROW_COLUMNS[1:]:
            source = self._cols[col]
            columns.append(int_column(col, dtype, (source[slot] for slot in slots)))
        return columns

    def _dictionary(self, slots: Sequence[int]) -> list[Column]:
        return text_columns([(s, self._ids[s], self._names[s]) for s in slots])

    def snapshot(self, version: int, fetched_ms: float) -> bytes:
        alive = [slot for slot, flag in enumerate(self._alive) if flag]
        return build_frame(
            kind=KIND_SNAPSHOT,
            version=version,
            base_version=0,
            slot_epoch=self.slot_epoch,
            rows=len(alive),
            removes=0,
            dictionary=len(alive),
            fetched_ms=fetched_ms,
            columns=[*self._rows(alive), *self._dictionary(alive)],
        )

    def delta(self, applied: Applied, version: int, fetched_ms: float) -> bytes:
        removes = (
            [int_column(Col.REMOVES, Dtype.U32, applied.removed)]
            if applied.removed
            else []
        )
        return build_frame(
            kind=KIND_DELTA,
            version=version,
            base_version=version - 1,
            slot_epoch=self.slot_epoch,
            rows=len(applied.changed),
            removes=len(applied.removed),
            dictionary=len(applied.texts),
            fetched_ms=fetched_ms,
            columns=[
                *self._rows(applied.changed),
                *removes,
                *self._dictionary(applied.texts),
            ],
        )


type Encoding = str

ENCODINGS: Final = ("zstd", "gzip", "identity")
ZSTD_LEVEL: Final = 3
GZIP_LEVEL: Final = 6


def pick_encoding(accept: str | None) -> Encoding:
    """Choose the best content coding the client accepts, defaulting to identity."""
    if not accept:
        return "identity"
    allowed: dict[str, float] = {}
    for part in accept.split(","):
        name, _, params = part.strip().partition(";")
        weight = 1.0
        params = params.strip()
        if params.startswith("q="):
            try:
                weight = float(params[2:])
            except ValueError:
                weight = 0.0
        allowed[name.strip().lower()] = weight
    for candidate in ("zstd", "gzip"):
        weight = allowed.get(candidate, allowed.get("*", 0.0))
        if weight > 0:
            return candidate
    return "identity"


def compress(frame: bytes, encoding: Encoding) -> bytes:
    if encoding == "zstd":
        return zstd.compress(frame, level=ZSTD_LEVEL)
    if encoding == "gzip":
        return gzip.compress(frame, compresslevel=GZIP_LEVEL, mtime=0)
    return frame


def decompress(body: bytes, encoding: Encoding) -> bytes:
    if encoding == "zstd":
        return zstd.decompress(body)
    if encoding == "gzip":
        return zlib.decompress(body, wbits=31)
    return body
