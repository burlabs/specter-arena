import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
import starlette

REPO_ROOT = Path(__file__).resolve().parents[2]
PROBE_PACKAGE = "backend.specter_arena.probe"

INSPECT = """
import json, sys
import backend.app as m
paths = sorted({getattr(route, "path", "") for route in m.app.routes})
loaded = sorted(name for name in sys.modules if name.startswith("backend.specter_arena.probe"))
print(json.dumps({"paths": paths, "probe_modules": loaded}))
"""


@pytest.fixture
def app_copy(tmp_path: Path) -> Path:
    """The runtime files only, in a throwaway root, so a local .probe-enabled cannot leak in."""
    ignore = shutil.ignore_patterns("tests", "__pycache__", ".venv", "*.lock", ".pytest_cache")
    shutil.copytree(REPO_ROOT / "backend", tmp_path / "backend", ignore=ignore)
    return tmp_path


def inspect_app(root: Path, **extra_env: str) -> dict[str, list[str]]:
    deps_dir = str(Path(starlette.__file__).resolve().parents[1])
    env = {
        key: value for key, value in os.environ.items() if not key.startswith(("PYTHON", "SPECTER"))
    }
    env["PYTHONPATH"] = deps_dir
    env.update(extra_env)
    result = subprocess.run(
        [sys.executable, "-s", "-c", INSPECT],
        cwd=root,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)  # type: ignore[no-any-return]


def test_without_the_switch_the_probe_is_not_imported_and_its_routes_are_absent(
    app_copy: Path,
) -> None:
    graph = inspect_app(app_copy)
    assert graph["probe_modules"] == []
    assert not any(path.startswith("/api/probe") for path in graph["paths"])
    assert "/api/ping" in graph["paths"]


def test_a_non_one_env_value_does_not_turn_the_probe_on(app_copy: Path) -> None:
    graph = inspect_app(app_copy, SPECTER_PROBE="0")
    assert graph["probe_modules"] == []


def test_the_env_switch_mounts_the_probe_routes(app_copy: Path) -> None:
    graph = inspect_app(app_copy, SPECTER_PROBE="1")
    assert f"{PROBE_PACKAGE}.routes" in graph["probe_modules"]
    assert "/api/probe/snapshot" in graph["paths"]


def test_the_switch_file_mounts_the_probe_routes(app_copy: Path) -> None:
    (app_copy / ".probe-enabled").write_text("")
    graph = inspect_app(app_copy)
    assert "/api/probe/run" in graph["paths"]


def test_the_release_graph_never_loads_the_live_driver_or_websockets(app_copy: Path) -> None:
    graph = inspect_app(app_copy)
    assert f"{PROBE_PACKAGE}.live" not in graph["probe_modules"]


def test_the_test_catches_an_unconditional_import(app_copy: Path) -> None:
    app = app_copy / "backend" / "app.py"
    app.write_text(
        "from .specter_arena.probe.routes import probe_routes  # noqa\n" + app.read_text()
    )
    graph = inspect_app(app_copy)
    assert graph["probe_modules"] != []
