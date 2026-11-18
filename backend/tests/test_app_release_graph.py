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
generation = sorted(
    n for n in sys.modules
    if n.startswith(("backend.specter_arena.specters", "backend.specter_arena.summoner"))
)
work = sorted(
    n for n in sys.modules
    if n == "backend.specter_arena.work" or n.startswith("backend.specter_arena.work.")
)
print(json.dumps({
    "paths": paths, "generation_modules": generation, "work_modules": work,
    "probe_modules": loaded, "store_modules": store,
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


def test_importing_the_release_app_loads_no_specter_or_summoner_module(app_copy: Path) -> None:
    for extra in ({}, {"SPECTER_PROBE": "1"}):
        assert inspect_app(app_copy, **extra)["generation_modules"] == [], extra


def test_importing_the_release_app_loads_no_work_module(app_copy: Path) -> None:
    for extra in ({}, {"SPECTER_PROBE": "1"}):
        assert inspect_app(app_copy, **extra)["work_modules"] == [], extra


SPECTER_PATHS = frozenset(
    {
        "/api/specters",
        "/api/specters/{binding_id}",
        "/api/specters/{binding_id}/summonings",
        "/api/specters/{binding_id}/manual",
        "/api/specters/{binding_id}/name",
        "/api/specters/{binding_id}/portrait",
        "/api/specters/{binding_id}/archive",
        "/api/summonings/{request_id}",
        "/api/summonings/{request_id}/cancel",
        "/api/summonings/{request_id}/accept",
        "/api/portraits",
        "/api/assets",
        "/api/assets/{asset_id}",
        "/api/scene-assets/{key}",
    }
)


def test_the_fourteen_specter_routes_are_mounted(app_copy: Path) -> None:
    assert set(inspect_app(app_copy)["paths"]) >= SPECTER_PATHS


WORK_PATHS = frozenset(
    {
        "/api/work",
        "/api/work/{work_id}",
        "/api/work/{work_id}/attempts",
        "/api/work/{work_id}/milestones",
        "/api/work/{work_id}/decisions",
        "/api/xp",
        "/api/roster/{binding_id}/xp",
    }
)


def test_the_work_routes_are_mounted(app_copy: Path) -> None:
    assert set(inspect_app(app_copy)["paths"]) >= WORK_PATHS


ROUTER_ONLY = """
import json, sys
import backend.specter_arena.work_routes
bad = sorted(
    n for n in sys.modules
    if n == "backend.specter_arena.work" or n.startswith("backend.specter_arena.work.")
    or n == "backend.specter_arena.store" or n.startswith("backend.specter_arena.store.")
)
print(json.dumps({"bad": bad, "sqlite3": "sqlite3" in sys.modules}))
"""


def test_the_work_router_alone_loads_no_work_service_store_or_sqlite3(app_copy: Path) -> None:
    deps_dir = str(Path(starlette.__file__).resolve().parents[1])
    env = {k: v for k, v in os.environ.items() if not k.startswith(("PYTHON", "SPECTER"))}
    env["PYTHONPATH"] = deps_dir
    result = subprocess.run(
        [sys.executable, "-s", "-c", ROUTER_ONLY],
        cwd=app_copy,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {"bad": [], "sqlite3": False}


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
        specters = m.app.state.specters
        work = m.app.state.work
        during = sorted(n for n in sys.modules if n.startswith("backend.specter_arena.collector"))
    print(json.dumps({"collector": collector is None, "modules": during,
                      "websockets": "websockets" in sys.modules,
                      "specters": specters is not None,
                      "work": work is not None,
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
    assert out == {
        "collector": True,
        "modules": [],
        "websockets": False,
        "specters": False,
        "work": False,
        "store": [],
    }
    assert not home.exists()


def test_without_gateway_environment_the_store_opens_but_the_collector_does_not_start(
    app_copy: Path, tmp_path: Path
) -> None:
    out = run_lifespan(
        app_copy, KIROCREW_HOME=str(tmp_path / "home"), KIROCREW_APP_NAME="specter-arena"
    )
    assert out["collector"] is True and out["store"] != []
    assert out["websockets"] is False
    assert out["specters"] is True
    assert out["work"] is True


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
