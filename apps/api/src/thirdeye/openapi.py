import argparse
import json
from pathlib import Path
from typing import Any

from thirdeye.app import create_app
from thirdeye.config import Settings


def schema() -> dict[str, Any]:
    settings = Settings(
        database_url="postgresql://openapi@localhost/openapi",
        _env_file=None,
    )
    return create_app(settings).openapi()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Write the API's OpenAPI schema")
    parser.add_argument("output", type=Path)
    args = parser.parse_args(argv)
    args.output.write_text(json.dumps(schema(), indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
