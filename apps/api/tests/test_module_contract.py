from datetime import UTC, datetime
from pathlib import Path

import pytest

from thirdeye.ontology import EntityReport, Event
from thirdeye.registry import REGISTRY, Module

MODULES_DIR = Path(__file__).parents[1] / "src/thirdeye/modules"
NOW = datetime.now(UTC)

MODULES = sorted(REGISTRY.values(), key=lambda module: module.id)


def fixture_of(module: Module) -> Path:
    found = sorted((MODULES_DIR / module.id).glob("fixture.*"))
    assert len(found) == 1, f"{module.id} needs exactly one fixture.* file"
    return found[0]


@pytest.mark.parametrize("module", MODULES, ids=lambda module: module.id)
class TestEveryModule:
    def test_lives_in_the_folder_that_matches_its_id(self, module: Module) -> None:
        assert (MODULES_DIR / module.id / "manifest.py").is_file()
        assert (MODULES_DIR / module.id / "records.py").is_file()

    def test_says_what_it_cannot_do(self, module: Module) -> None:
        limitations = module.manifest.provenance.limitations
        assert len(limitations) >= 2
        assert all(text.strip() for text in limitations)
        assert len(set(limitations)) == len(limitations)

    def test_names_its_source_and_licence(self, module: Module) -> None:
        provenance = module.manifest.provenance
        assert provenance.attribution.strip()
        assert provenance.licence.strip()
        assert provenance.source.strip()

    def test_has_a_non_empty_fixture(self, module: Module) -> None:
        assert fixture_of(module).stat().st_size > 0

    def test_normalises_its_own_fixture(self, module: Module) -> None:
        raw = fixture_of(module).read_bytes()
        if module.normalize is not None:
            records: list[Event] | list[EntityReport] = module.normalize(raw, NOW)
        else:
            assert module.normalize_entities is not None
            records = module.normalize_entities(raw, NOW)
        assert records, f"{module.id} fixture produced nothing"

    def test_has_exactly_one_way_to_normalise(self, module: Module) -> None:
        kinds = [module.normalize, module.normalize_entities]
        assert sum(kind is not None for kind in kinds) == 1

    def test_has_tests_of_its_own(self, module: Module) -> None:
        tests = Path(__file__).parent
        own = [
            path
            for path in tests.glob("test_*.py")
            if f"thirdeye.modules.{module.id}" in path.read_text(encoding="utf-8")
        ]
        assert own, f"no test imports thirdeye.modules.{module.id}"


def test_every_module_folder_is_registered() -> None:
    folders = {
        path.name
        for path in MODULES_DIR.iterdir()
        if path.is_dir() and not path.name.startswith("__")
    }
    assert folders == set(REGISTRY)
