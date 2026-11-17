import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest
import starlette

REPO_ROOT = Path(__file__).resolve().parents[2]
PROBE_PACKAGE = "backend.specter_arena.probe"

INSPECT = """
import json, sys
import backend.app as m
paths = sorted({getattr(route, "path", "") for route in m.app.routes})
loaded = sorted(name for name in sys.modules if name.startswith("backend.specter_arena.probe"))
store = sorted(
    n for n in sys.modules
    if n == "backend.specter_arena.store" or n.startswith("backend.specter_arena.store.")
)
collector = sorted(n for n in sys.modules if n.startswith("backend.specter_arena.collector"))
print(json.dumps({
    "paths": paths, "probe_modules": loaded, "store_modules": store,
    "sqlite3": "sqlite3" in sys.modules,
    "collector_modules": collector, "websockets": "websockets" in sys.modules,
}))
"""


@pytest.fixture
def app_copy(tmp_path: Path) -> Path:
    """The runtime files only, in a throwaway root, so a local .probe-enabled cannot leak in."""
    ignore = shutil.ignore_patterns("tests", "__pycache__", ".venv", "*.lock", ".pytest_cache")
    shutil.copytree(REPO_ROOT / "backend", tmp_path / "backend", ignore=ignore)
    return tmp_path


def inspect_app(root: Path, **extra_env: str) -> dict[str, Any]:
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
    assert "/api/ready" in graph["paths"]


def test_importing_the_release_app_loads_neither_the_store_nor_sqlite3(app_copy: Path) -> None:
    for extra in ({}, {"SPECTER_PROBE": "1"}):
        graph = inspect_app(app_copy, **extra)
        assert (graph["store_modules"], graph["sqlite3"]) == ([], False), extra


def test_importing_the_release_app_loads_no_collector_module_and_no_websockets(
    app_copy: Path,
) -> None:
    for extra in ({}, {"SPECTER_PROBE": "1"}):
        graph = inspect_app(app_copy, **extra)
        assert (graph["collector_modules"], graph["websockets"]) == ([], False), extra


def test_the_roster_and_attempts_routes_are_mounted_with_the_release_routes(
    app_copy: Path,
) -> None:
    paths = inspect_app(app_copy)["paths"]
    assert "/api/roster" in paths
    assert "/api/roster/{binding_id}/attempts" in paths


LIFESPAN = """
import asyncio, json, sys
import backend.app as m

async def main():
    async with m.app.router.lifespan_context(m.app):
        collector = m.app.state.collector
        during = sorted(n for n in sys.modules if n.startswith("backend.specter_arena.collector"))
    print(json.dumps({"collector": collector is None, "modules": during,
                      "websockets": "websockets" in sys.modules,
                      "store": [n for n in sys.modules if n == "backend.specter_arena.store"]}))

asyncio.run(main())
"""


def run_lifespan(root: Path, **extra_env: str) -> dict[str, Any]:
    deps_dir = str(Path(starlette.__file__).resolve().parents[1])
    env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(("PYTHON", "SPECTER", "KIROCREW"))
    }
    env["PYTHONPATH"] = deps_dir
    env.update(extra_env)
    result = subprocess.run(
        [sys.executable, "-s", "-c", LIFESPAN],
        cwd=root,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)  # type: ignore[no-any-return]


def test_the_probe_switch_never_starts_the_collector_or_opens_the_store(
    app_copy: Path, tmp_path: Path
) -> None:
    home = tmp_path / "home"
    out = run_lifespan(
        app_copy,
        SPECTER_PROBE="1",
        KIROCREW_HOME=str(home),
        KIROCREW_APP_NAME="specter-arena",
        KIROCREW_GATEWAY_ORIGIN="http://127.0.0.1:1",
        KIROCREW_PROXY_SECRET="x",
    )
    assert out == {"collector": True, "modules": [], "websockets": False, "store": []}
    assert not home.exists()


def test_without_gateway_environment_the_store_opens_but_the_collector_does_not_start(
    app_copy: Path, tmp_path: Path
) -> None:
    out = run_lifespan(
        app_copy, KIROCREW_HOME=str(tmp_path / "home"), KIROCREW_APP_NAME="specter-arena"
    )
    assert out["collector"] is True and out["store"] != []
    assert out["websockets"] is False


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
