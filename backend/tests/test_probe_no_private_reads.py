import ast
import importlib
from pathlib import Path

import pytest

PROBE_DIR = Path(__file__).resolve().parents[1] / "specter_arena" / "probe"
MARKER = "SPECTER-DIAGNOSTIC-ONLY"
MODULES = [
    "__init__",
    "questions",
    "sanitise",
    "frames",
    "events",
    "matrix",
    "snapshot",
    "steps",
    "routes",
    "live",
]
FORBIDDEN = [".app_secret", "~/.kiro", "expanduser", "Path.home", "owner_token", "os.environ"]


@pytest.mark.parametrize("name", MODULES)
def test_each_probe_module_carries_the_marker_as_comment_and_runtime_constant(name: str) -> None:
    text = (PROBE_DIR / f"{name}.py").read_text()
    assert f"# {MARKER}" in text.splitlines()[0]
    assert f'MARKER = "{MARKER}"' in text
    module = importlib.import_module(f"backend.specter_arena.probe.{name}".replace(".__init__", ""))
    assert module.MARKER == MARKER


@pytest.mark.parametrize("path", sorted(PROBE_DIR.glob("*.py")), ids=lambda p: p.name)
def test_probe_code_reads_no_private_stores_or_owner_credentials(path: Path) -> None:
    text = path.read_text()
    for needle in FORBIDDEN:
        assert needle not in text, f"{path.name} mentions {needle}"


def _imported_modules(tree: ast.AST) -> set[str]:
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            base = "." * node.level + (node.module or "")
            names.add(base)
            names.update(f"{base}.{alias.name}" for alias in node.names)
        elif (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "import_module"
            and node.args
            and isinstance(node.args[0], ast.Constant)
        ):
            names.add(str(node.args[0].value))
    return names


@pytest.mark.parametrize("path", sorted(PROBE_DIR.glob("*.py")), ids=lambda p: p.name)
def test_probe_code_never_imports_the_product_store(path: Path) -> None:
    for name in _imported_modules(ast.parse(path.read_text())):
        parts = set(name.lstrip(".").split("."))
        assert not parts & {"sqlite3", "store", "store_runtime"}, f"{path.name} imports {name}"


def test_the_store_import_scan_sees_static_and_dynamic_imports() -> None:
    source = "import sqlite3\nfrom ..store import open_store\nimportlib.import_module('.store')\n"
    assert {"sqlite3", "..store", "..store.open_store", ".store"} <= _imported_modules(
        ast.parse(source)
    )
