import ast
import json
import os
import shutil
import sqlite3
import stat
import subprocess
import sys
from pathlib import Path

import pytest
import starlette

BACKEND = Path(__file__).resolve().parents[1]
PROBE_DIR = BACKEND / "specter_arena" / "probe"
STORE_DIR = BACKEND / "specter_arena" / "store"
STORE_PACKAGE = "backend.specter_arena.store"
FORBIDDEN_IN_PROBE = {"sqlite3", "sqlite", "KIROCREW_HOME"}
# The one dynamic import the probe makes today: its lazily loaded live driver.
ALLOWED_PROBE_DYNAMIC_IMPORTS = {".live"}
DYNAMIC_IMPORTERS = {"__import__", "importlib.import_module", "import_module"}

needs_lifespan = pytest.mark.skip(reason="needs the W-1b store lifespan in backend/app.py (#47)")


def resolve_imports(path: Path, root: Path) -> set[str]:
    """Absolute dotted names a module imports, with relative imports resolved by their level."""
    package = list(path.relative_to(root.parent).with_suffix("").parts[:-1])
    found: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            found.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            base = package[: len(package) - (node.level - 1)] if node.level else []
            module = ".".join([*base, *([node.module] if node.module else [])])
            found.add(module)
            found.update(f"{module}.{alias.name}" for alias in node.names)
    return found


def dynamic_import_arguments(path: Path) -> list[str | None]:
    """The first argument of every dynamic import call; None when it is not a string literal."""
    found: list[str | None] = []
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Call) and ast.unparse(node.func) in DYNAMIC_IMPORTERS:
            arg = node.args[0] if node.args else None
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                found.append(arg.value)
            else:
                found.append(None)
    return found


def identifiers_and_strings(path: Path) -> set[str]:
    found: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Name):
            found.add(node.id)
        elif isinstance(node, ast.Attribute):
            found.add(node.attr)
        elif isinstance(node, ast.Constant) and isinstance(node.value, str):
            found.add(node.value)
    return found


def probe_violations(path: Path, root: Path) -> list[str]:
    imports = resolve_imports(path, root)
    problems = [name for name in imports if name.startswith(STORE_PACKAGE)]
    problems += [name for name in imports if name.split(".")[0] in FORBIDDEN_IN_PROBE]
    problems += sorted(identifiers_and_strings(path) & FORBIDDEN_IN_PROBE)
    problems += [
        f"dynamic import {arg!r}"
        for arg in dynamic_import_arguments(path)
        if arg not in ALLOWED_PROBE_DYNAMIC_IMPORTS
    ]
    return problems


def test_probe_modules_never_import_the_store_or_sqlite() -> None:
    modules = sorted(PROBE_DIR.glob("*.py"))
    assert modules
    for path in modules:
        assert probe_violations(path, BACKEND) == [], path.name


def test_store_modules_import_only_the_standard_library_and_themselves() -> None:
    allowed = set(sys.stdlib_module_names) | {"__future__"}
    for path in sorted(STORE_DIR.glob("*.py")):
        for name in resolve_imports(path, BACKEND):
            assert name.split(".")[0] in allowed or name.startswith(STORE_PACKAGE), (
                f"{path.name} imports {name}"
            )
        assert dynamic_import_arguments(path) == [], path.name


def test_the_ast_check_catches_a_probe_that_reaches_the_store(tmp_path: Path) -> None:
    root = tmp_path / "backend"
    probe = root / "specter_arena" / "probe"
    probe.mkdir(parents=True)
    cases = {
        "relative.py": "from ..store import open_store\n",
        "absolute.py": "import backend.specter_arena.store.store\n",
        "driver.py": "import sqlite3\n",
        "env.py": "import os\nhome = os.environ['KIROCREW_HOME']\n",
        "dynamic.py": "import importlib\nimportlib.import_module('..store', __package__)\n",
        "computed.py": "import importlib\nname = '.st' + 'ore'\nimportlib.import_module(name)\n",
    }
    for name, source in cases.items():
        (probe / name).write_text(source, encoding="utf-8")
        assert probe_violations(probe / name, root) != [], name
    (probe / "clean.py").write_text("from . import frames\n", encoding="utf-8")
    assert probe_violations(probe / "clean.py", root) == []
    assert "backend.specter_arena.probe.frames" in resolve_imports(probe / "clean.py", root)


def deps_only_env(**extra: str) -> dict[str, str]:
    """Crew's start: only the third-party deps on the path, none of this repo's settings."""
    env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(("PYTHON", "SPECTER", "KIROCREW"))
    }
    env["PYTHONPATH"] = str(Path(starlette.__file__).resolve().parents[1])
    env.update(extra)
    return env


def run_python(code: str, cwd: Path, **extra: str) -> dict[str, object]:
    result = subprocess.run(
        [sys.executable, "-s", "-c", code],
        cwd=cwd,
        env=deps_only_env(**extra),
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)  # type: ignore[no-any-return]


@pytest.fixture
def app_copy(tmp_path: Path) -> Path:
    """The runtime files only, in a throwaway root, so a local .probe-enabled cannot leak in."""
    ignore = shutil.ignore_patterns("tests", "__pycache__", ".venv", "*.lock", ".pytest_cache")
    shutil.copytree(BACKEND, tmp_path / "app" / "backend", ignore=ignore)
    return tmp_path / "app"


IMPORT_STORE = """
import json, sys
import backend.specter_arena.store
loaded = sorted(
    name for name in sys.modules
    if name.startswith("backend.specter_arena.probe") or name.split(".")[0] == "starlette"
)
print(json.dumps({"unexpected": loaded}))
"""


def test_importing_the_store_touches_no_disk_and_loads_no_probe_or_web_code(
    app_copy: Path, tmp_path: Path
) -> None:
    home = tmp_path / "crew-home"
    graph = run_python(
        IMPORT_STORE,
        app_copy,
        KIROCREW_HOME=str(home),
        KIROCREW_APP_NAME="specter-arena",
        HOME=str(tmp_path / "user-home"),
    )
    assert graph == {"unexpected": []}
    assert not home.exists()
    assert not (tmp_path / "user-home").exists()


LIFESPAN = """
import json, sys
from starlette.testclient import TestClient
import backend.app as m
with TestClient(m.app) as client:
    status = client.get("/health").status_code
print(json.dumps({
    "health": status,
    "store_modules": sorted(n for n in sys.modules if n.startswith("backend.specter_arena.store")),
    "sqlite3": "sqlite3" in sys.modules,
}))
"""


def crew_env(home: Path) -> dict[str, str]:
    return {"KIROCREW_HOME": str(home), "KIROCREW_APP_NAME": "specter-arena"}


def store_root(home: Path) -> Path:
    return home / "apps" / "specter-arena" / "data" / "store"


@needs_lifespan
def test_the_probe_env_switch_never_loads_or_creates_the_store(
    app_copy: Path, tmp_path: Path
) -> None:
    home = tmp_path / "crew-home"
    out = run_python(LIFESPAN, app_copy, SPECTER_PROBE="1", **crew_env(home))
    assert out == {"health": 200, "store_modules": [], "sqlite3": False}
    assert not store_root(home).exists()


@needs_lifespan
def test_the_probe_switch_file_never_creates_the_store(app_copy: Path, tmp_path: Path) -> None:
    (app_copy / ".probe-enabled").write_text("")
    home = tmp_path / "crew-home"
    out = run_python(LIFESPAN, app_copy, **crew_env(home))
    assert out["store_modules"] == []
    assert not (home / "apps").exists()


@needs_lifespan
def test_release_mode_creates_an_owner_only_migrated_store(app_copy: Path, tmp_path: Path) -> None:
    home = tmp_path / "crew-home"
    out = run_python(LIFESPAN, app_copy, **crew_env(home))
    assert out["health"] == 200
    db = store_root(home) / "specter-arena.db"
    assert db.is_file()
    if os.name == "posix":
        assert stat.S_IMODE(db.stat().st_mode) == 0o600
    conn = sqlite3.connect(db)
    try:
        assert conn.execute("PRAGMA user_version").fetchone() == (1,)
    finally:
        conn.close()


@needs_lifespan
def test_release_mode_without_crew_variables_creates_nothing(
    app_copy: Path, tmp_path: Path
) -> None:
    user_home = tmp_path / "user-home"
    user_home.mkdir()
    out = run_python(LIFESPAN, app_copy, HOME=str(user_home))
    assert out["health"] == 200
    assert list(user_home.rglob("*")) == []


@needs_lifespan
def test_the_runtime_check_catches_a_probe_that_opens_the_store(
    app_copy: Path, tmp_path: Path
) -> None:
    routes = app_copy / "backend" / "specter_arena" / "probe" / "routes.py"
    # Appended, not prepended: the module starts with `from __future__ import annotations`.
    routes.write_text(routes.read_text() + "\nfrom ..store import open_store  # noqa: F401,E402\n")
    out = run_python(LIFESPAN, app_copy, SPECTER_PROBE="1", **crew_env(tmp_path / "crew-home"))
    assert out["sqlite3"] is True
