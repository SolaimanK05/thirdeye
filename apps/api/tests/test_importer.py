import os
from collections.abc import AsyncIterator
from datetime import datetime
from pathlib import Path

import psycopg
import pytest

from thirdeye import importer
from thirdeye.config import Settings
from thirdeye.importer import ImportFailed, importable, read_file
from thirdeye.ontology import EntityReport
from thirdeye.registry import REGISTRY, Module

FIXTURE = Path(__file__).parent.parent / "src/thirdeye/modules/ports/fixture.csv"
TEST_DB = os.environ.get("THIRDEYE_TEST_DATABASE_URL")
needs_db = pytest.mark.skipif(
    not TEST_DB, reason="set THIRDEYE_TEST_DATABASE_URL to run database tests"
)

MODULE = "importtest"
SOURCE = "importtest-feed"
WPI_PREFIX = "importtest-"


def test_only_entity_modules_can_be_imported() -> None:
    assert set(importable(REGISTRY)) == {"ports"}


def test_a_missing_file_is_reported_plainly(tmp_path: Path) -> None:
    with pytest.raises(ImportFailed, match="can't read"):
        read_file(tmp_path / "nope.csv")


def test_a_directory_is_not_a_file(tmp_path: Path) -> None:
    with pytest.raises(ImportFailed, match="not a file"):
        read_file(tmp_path)


def test_a_huge_file_is_refused_before_it_is_read(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "big.csv"
    path.write_bytes(b"x" * 20)
    monkeypatch.setattr(importer, "MAX_FILE_BYTES", 10)
    with pytest.raises(ImportFailed, match="larger than"):
        read_file(path)


def test_a_small_file_is_read(tmp_path: Path) -> None:
    path = tmp_path / "a.csv"
    path.write_bytes(b"abc")
    assert read_file(path) == b"abc"


async def test_an_unknown_module_is_refused(tmp_path: Path) -> None:
    settings = Settings(database_url="postgresql://x:y@127.0.0.1:1/z", _env_file=None)
    with pytest.raises(ImportFailed, match="does not take imported files"):
        await importer.run("earthquakes", tmp_path / "a.csv", settings)


def test_the_command_prints_a_one_line_failure(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code = importer.main(["ports", str(tmp_path / "missing.csv")])
    assert code == 2
    out = capsys.readouterr().out
    assert out.startswith("import failed: can't read")
    assert out.count("\n") == 1


def test_a_file_that_is_not_a_port_list_is_refused(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "wrong.csv"
    path.write_text("a,b\n1,2\n")
    assert importer.main(["ports", str(path)]) == 2
    assert capsys.readouterr().out.startswith("import failed:")


def test_an_empty_file_imports_nothing(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "empty.csv"
    path.write_bytes(b"")
    assert importer.main(["ports", str(path)]) == 2
    assert "import failed" in capsys.readouterr().out


@pytest.fixture
async def import_module() -> AsyncIterator[Module]:
    assert TEST_DB
    base = REGISTRY["ports"]
    provenance = base.manifest.provenance.model_copy(update={"source_id": SOURCE})
    manifest = base.manifest.model_copy(update={"id": MODULE, "provenance": provenance})
    inner = base.normalize_entities
    assert inner is not None

    def isolate(report: EntityReport) -> EntityReport:
        identifiers = report.entity.identifiers
        entity = report.entity.model_copy(
            update={
                "source_id": SOURCE,
                "identifiers": identifiers.model_copy(
                    update={"wpi": f"{WPI_PREFIX}{identifiers.wpi}"}
                ),
            }
        )
        return report.model_copy(update={"entity": entity})

    def normalize(raw: bytes, at: datetime) -> list[EntityReport]:
        return [isolate(report) for report in inner(raw, at)]

    module = Module(manifest, None, normalize_entities=normalize)
    async with await psycopg.AsyncConnection.connect(TEST_DB, autocommit=True) as c:
        await wipe(c)
        await c.execute(
            "insert into source (id, module_id, url, licence, reliability) "
            "values (%s, %s, 'http://localhost/test', 'test', 'primary')",
            (SOURCE, MODULE),
        )
        yield module
        await wipe(c)


async def wipe(c: psycopg.AsyncConnection[tuple[object, ...]]) -> None:
    await c.execute("delete from observation where source_id = %s", (SOURCE,))
    await c.execute("delete from entity where source_id = %s", (SOURCE,))
    await c.execute("delete from source where id = %s", (SOURCE,))
    await c.execute("delete from layer_snapshot where module_id = %s", (MODULE,))
    await c.execute("delete from module_health where module_id = %s", (MODULE,))


async def counts(
    c: psycopg.AsyncConnection[tuple[object, ...]],
) -> tuple[int, int, int]:
    cur = await c.execute(
        """
        select (select count(*) from entity where source_id = %s),
               (select count(*) from observation o join entity e on e.id = o.entity_id
                 where e.source_id = %s),
               (select jsonb_array_length(payload) from layer_snapshot where module_id = %s)
        """,
        (SOURCE, SOURCE, MODULE),
    )
    row = await cur.fetchone()
    assert row is not None
    return int(str(row[0])), int(str(row[1])), int(str(row[2]))


@needs_db
async def test_importing_the_same_file_twice_leaves_the_same_rows(
    import_module: Module,
) -> None:
    assert TEST_DB
    settings = Settings(database_url=TEST_DB, _env_file=None)
    registry = {MODULE: import_module}
    first = await importer.run(MODULE, FIXTURE, settings, registry)
    async with await psycopg.AsyncConnection.connect(TEST_DB, autocommit=True) as c:
        after_first = await counts(c)
        second = await importer.run(MODULE, FIXTURE, settings, registry)
        after_second = await counts(c)
    assert first == second == 23
    assert after_first == (23, 23, 23)
    assert after_second == after_first
