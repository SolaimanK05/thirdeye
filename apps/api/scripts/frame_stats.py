"""Print how big and how fast the binary frames are on a running API.

    python scripts/frame_stats.py http://localhost:8000 aircraft vessels

Uses only the standard library, so it runs anywhere the API runs.
"""

import gzip
import sys
import time
import urllib.error
import urllib.request
from compression import zstd

sys.path.insert(0, "src")

from thirdeye.frames import decode

ENCODINGS = ("identity", "gzip", "zstd")


def fetch(url: str, encoding: str) -> tuple[bytes, float, dict[str, str]]:
    request = urllib.request.Request(url, headers={"Accept-Encoding": encoding})
    started = time.perf_counter()
    with urllib.request.urlopen(request, timeout=30) as response:
        body = response.read()
        headers = {k.lower(): v for k, v in response.headers.items()}
    return body, time.perf_counter() - started, headers


def inflate(body: bytes, headers: dict[str, str]) -> bytes:
    match headers.get("content-encoding"):
        case "zstd":
            return zstd.decompress(body)
        case "gzip":
            return gzip.decompress(body)
        case _:
            return body


def report(base: str, module: str) -> None:
    print(f"\n{module}")
    version = epoch = 0
    for encoding in ENCODINGS:
        try:
            body, seconds, headers = fetch(
                f"{base}/v1/movers/{module}/snapshot", encoding
            )
        except urllib.error.HTTPError as error:
            print(f"  snapshot: {error.code} (is {module} enabled?)")
            return
        frame = decode(inflate(body, headers))
        version, epoch = frame.version, frame.slot_epoch
        print(
            f"  snapshot {encoding:8} {len(body):>10,} bytes"
            f"  {len(body) / max(1, frame.rows):6.1f} B/row"
            f"  {seconds * 1000:7.1f} ms  rows={frame.rows:,} version={version}"
        )
    if version < 2:
        return
    try:
        body, _, headers = fetch(
            f"{base}/v1/movers/{module}/frames/{version}?epoch={epoch}", "zstd"
        )
    except urllib.error.HTTPError as error:
        print(f"  delta v{version}: {error.code}")
        return
    frame = decode(inflate(body, headers))
    print(
        f"  delta v{version} zstd     {len(body):>10,} bytes"
        f"  {len(body) / max(1, frame.rows):6.1f} B/row"
        f"  rows={frame.rows:,} removes={len(frame.removes):,}"
    )


if __name__ == "__main__":
    api = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://localhost:8000"
    for name in sys.argv[2:] or ["aircraft", "vessels"]:
        report(api, name)
