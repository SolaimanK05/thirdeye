# TEF1 frames

TEF1 is the binary format the API uses to send moving entities (aircraft and vessels) to the web app. A frame is columnar: one array per field, so the browser can hand each column to a typed array without parsing rows.

The encoder is [`apps/api/src/thirdeye/frames.py`](../../apps/api/src/thirdeye/frames.py) and the decoder is [`apps/web/src/api/frames.ts`](../../apps/web/src/api/frames.ts). The `.bin` files here are real frames and the `.json` files next to them are what they must decode to. Both sides test against them.

## Layout

Everything is little-endian. A frame is a header, a column directory and the column data, each column starting on an 8-byte boundary.

```text
header (40 bytes)       directory (12 bytes per column)     data
+-------------------+   +------------------------------+   +-----------+
| magic  "TEF1"     |   | column id        u16         |   | column 1  |
| kind   u8         |   | dtype            u8          |   | (padding) |
| reserved u8       |   | encoding         u8          |   | column 2  |
| columns u16       |   | offset           u32         |   | (padding) |
| version u32       |   | byte length      u32         |   | ...       |
| base version u32  |   +------------------------------+   +-----------+
| slot epoch u32    |
| rows u32          |
| removes u32       |
| dictionary u32    |
| fetched ms f64    |
+-------------------+
```

| Field | Meaning |
|---|---|
| `kind` | `1` snapshot (the full state), `2` delta (changes since the previous version) |
| `version`, `base version` | A delta with version N applies on top of version N-1; a snapshot has base version 0 |
| `slot epoch` | Slots are small integers standing in for entity ids. The epoch goes up when the server renumbers them (for example when it compacts its table), and a client holding an older epoch must fetch a fresh snapshot |
| `rows` | Number of entities in the frame |
| `removes` | Number of slots removed (a delta only) |
| `dictionary` | Number of slot-to-id and slot-to-name entries sent alongside |
| `fetched ms` | When the server's source data was fetched, as milliseconds since the Unix epoch |

## Columns

| Column | Type | Unit |
|---|---|---|
| `slot` | u32 | |
| `lon`, `lat` | i32 | degrees x 10,000,000 |
| `t` | u32 | seconds since the Unix epoch |
| `sog` | u16 | speed over ground, knots x 10 |
| `cog` | u16 | course over ground, degrees x 100 |
| `heading` | u16 | degrees x 100 |
| `alt` | i16 | metres, rounded |
| `flags` | u8 | bit 0 is on-ground |
| `class` | u8 | module-defined class (for vessels: cargo, tanker, passenger, fishing, tug, pleasure, military, other) |
| `confidence` | u8 | how the value was obtained (observed, reported, derived) |

An unknown value is the largest unsigned value (`0xFFFF`) or `-32768` for the signed column.

The `slot`, `lon`, `lat` and `t` columns are byte-shuffled (encoding `1`): the first bytes of every value, then the second bytes, and so on. That groups the bytes that change least and makes the data compress much better.

## Compression

Frames are never compressed inside. The API applies HTTP content encoding (gzip or zstd, whichever the client accepts), and the browser undoes it.

## Endpoints

| Endpoint | Returns |
|---|---|
| `GET /v1/movers/{module}/snapshot` | The current snapshot frame |
| `GET /v1/movers/{module}/frames/{version}?epoch=N` | The delta frame that produced `version` |
| `GET /v1/stream` | Server-sent events that tell the client when a new version exists |

Frames carry an ETag. Deltas never change, so they are marked immutable; the snapshot is revalidated.
