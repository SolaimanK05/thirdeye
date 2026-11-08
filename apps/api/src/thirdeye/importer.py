import argparse
import asyncio
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path

import structlog

from thirdeye.config import Settings, get_settings
from thirdeye.db import Pool, create_pool
from thirdeye.logs import configure_logging
from thirdeye.registry import REGISTRY, Module
from thirdeye.worker import store_entities

log = structlog.get_logger()

MAX_FILE_BYTES = 100 * 1024 * 1024


class ImportFailed(Exception):
    pass


def importable(registry: Mapping[str, Module]) -> dict[str, Module]:
    return {
        module_id: module
        for module_id, module in registry.items()
        if module.normalize_entities is not None
        and module.manifest.observation_retention_seconds is None
    }


def read_file(path: Path) -> bytes:
    try:
        size = path.stat().st_size
    except OSError as exc:
        raise ImportFailed(f"can't read {path}: {exc.strerror}") from None
    if not path.is_file():
        raise ImportFailed(f"{path} is not a file")
    if size > MAX_FILE_BYTES:
        raise ImportFailed(f"{path} is larger than {MAX_FILE_BYTES // 2**20} MB")
    try:
        return path.read_bytes()
    except OSError as exc:
        raise ImportFailed(f"can't read {path}: {exc.strerror}") from None


async def import_file(module: Module, pool: Pool, raw: bytes) -> int:
    normalize = module.normalize_entities
    if normalize is None:
        raise ImportFailed(f"module {module.id!r} does not make entities")
    imported_at = datetime.now(UTC)
    try:
        reports = normalize(raw, imported_at)
    except ValueError as exc:
        raise ImportFailed(str(exc)) from None
    if not reports:
        raise ImportFailed("the file has no usable records, so nothing was imported")
    return await store_entities(module, pool, reports, imported_at)


async def run(
    module_id: str,
    path: Path,
    settings: Settings,
    registry: Mapping[str, Module] = REGISTRY,
) -> int:
    modules = importable(registry)
    module = modules.get(module_id)
    if module is None:
        raise ImportFailed(
            f"{module_id!r} does not take imported files; "
            f"import works for {sorted(modules)}"
        )
    raw = read_file(path)
    pool = create_pool(settings)
    await pool.open()
    try:
        count = await import_file(module, pool, raw)
    finally:
        await pool.close()
    if module_id not in settings.modules_enabled:
        log.warning(
            "import.module_not_enabled",
            module=module_id,
            hint=f"add {module_id!r} to MODULES_ENABLED to serve it",
        )
    log.info("import.done", module=module_id, records=count, file=path.name)
    return count


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m thirdeye.importer",
        description="Load a module's records from a file you downloaded, for when the worker can't reach the publisher.",
    )
    parser.add_argument("module", help="module id, for example ports")
    parser.add_argument("path", type=Path, help="the file to import")
    args = parser.parse_args(argv)
    settings = get_settings()
    configure_logging(settings)
    try:
        count = asyncio.run(run(args.module, args.path, settings))
    except ImportFailed as exc:
        print(f"import failed: {exc}")
        return 2
    except Exception as exc:  # noqa: BLE001 - report any failure as one line
        print(f"import failed: {type(exc).__name__}: {exc}")
        return 1
    print(f"imported {count} records into {args.module}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
