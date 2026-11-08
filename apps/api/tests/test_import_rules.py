"""Architecture rules

Nothing here imports or runs the code. ``ast`` parses each file into a tree
and the tests look at the import statements and string literals in it.
"""

import ast
import re
from collections.abc import Iterator
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src"
PACKAGE = SRC / "thirdeye"
MODULES = PACKAGE / "modules"

# What a module may import from inside thirdeye (besides itself).
MODULE_ALLOWED = (
    "thirdeye.ontology",
    "thirdeye.governor",
    "thirdeye.config",
    "thirdeye.streams",
)

URL = re.compile(r"https?://")
LOCAL_URL = re.compile(r"https?://(localhost|127\.0\.0\.1)(?=[:/]|$)")


def python_files() -> list[Path]:
    return sorted(PACKAGE.rglob("*.py"))


def module_name(path: Path) -> str:
    """src/thirdeye/modules/quakes/source.py -> thirdeye.modules.quakes.source"""
    parts = list(path.relative_to(SRC).with_suffix("").parts)
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts)


def imported_names(path: Path) -> Iterator[tuple[int, str]]:
    """Yield (line, dotted name) for every import in the file.

    Relative imports are resolved, so ``from ...governor import x`` inside
    thirdeye/modules/quakes/source.py comes out as ``thirdeye.governor.x``.
    ``from a import b`` yields ``a.b`` because b may itself be a submodule.
    """
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    package = module_name(path)
    if path.name != "__init__.py":
        package = package.rpartition(".")[0]

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                yield node.lineno, alias.name
        elif isinstance(node, ast.ImportFrom):
            base = node.module or ""
            # Relative import: one dot is this package, each extra dot goes up a level.
            if node.level:
                anchor = package.split(".")
                anchor = anchor[: len(anchor) - (node.level - 1)]
                base = ".".join([*anchor, base]) if base else ".".join(anchor)
            for alias in node.names:
                yield node.lineno, f"{base}.{alias.name}"


def is_within(name: str, prefix: str) -> bool:
    return name == prefix or name.startswith(prefix + ".")


def test_modules_only_import_allowed_internals() -> None:
    problems = []
    for path in python_files():
        if not path.is_relative_to(MODULES) or path.parent == MODULES:
            continue
        own = "thirdeye.modules." + path.relative_to(MODULES).parts[0]
        for line, name in imported_names(path):
            if not is_within(name, "thirdeye"):
                continue  # stdlib and third-party are fine
            if any(is_within(name, ok) for ok in (own, *MODULE_ALLOWED)):
                continue
            problems.append(f"{path.relative_to(SRC)}:{line} imports {name}")
    assert not problems, "\n".join(
        [
            "Modules may only import their own code, ontology, governor, config and streams:",
            *problems,
        ]
    )


def test_only_registry_imports_modules() -> None:
    allowed = {PACKAGE / "registry.py"}
    problems = []
    for path in python_files():
        if path in allowed or path.is_relative_to(MODULES):
            continue
        for line, name in imported_names(path):
            if is_within(name, "thirdeye.modules") and name != "thirdeye.modules":
                problems.append(f"{path.relative_to(SRC)}:{line} imports {name}")
    assert not problems, "\n".join(["Only registry.py may import modules:", *problems])


def test_upstream_urls_only_in_source_files() -> None:
    problems = []
    for path in python_files():
        if path.is_relative_to(MODULES) and path.name == "source.py":
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Constant) and isinstance(node.value, str)):
                continue
            text = LOCAL_URL.sub("", node.value)
            if URL.search(text):
                problems.append(f"{path.relative_to(SRC)}:{node.lineno} {node.value!r}")
    assert not problems, "\n".join(
        ["Upstream URLs belong in modules/*/source.py:", *problems]
    )
