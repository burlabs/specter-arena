import asyncio
import json
import os
import subprocess
import sys
import threading
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
import starlette

from backend.specter_arena import store as real_store
from backend.specter_arena.store import StoreStatus
from backend.specter_arena.store_runtime import StoreRuntime

REPO_ROOT = Path(__file__).resolve().parents[2]
LATEST = real_store.latest_version()


class FakeStore:
    def __init__(self, status: StoreStatus | BaseException) -> None:
        self._status = status
        self.closed = False

    def status(self) -> StoreStatus:
        if isinstance(self._status, BaseException):
            raise self._status
        return self._status

    def close(self) -> None:
        self.closed = True


def stub_module(
    *,
    data_dir: Path | None = Path("/data"),
    opened: FakeStore | BaseException | None = None,
    gate: threading.Event | None = None,
) -> SimpleNamespace:
    def open_store(_data_dir: Path) -> FakeStore:
        if gate is not None:
            gate.wait(5)
        if isinstance(opened, BaseException):
            raise opened
        assert opened is not None
        return opened

    return SimpleNamespace(
        resolve_data_dir=lambda _env: data_dir,
        open_store=open_store,
        unconfigured_status=real_store.unconfigured_status,
        migrating_status=real_store.migrating_status,
        status_for_error=real_store.status_for_error,
    )


def runtime_with(module: SimpleNamespace, monkeypatch: pytest.MonkeyPatch) -> StoreRuntime:
    runtime = StoreRuntime(probe_on=False, environ={})
    monkeypatch.setattr(runtime, "_store_module", lambda: module)
    return runtime


READY = StoreStatus("ready", LATEST, LATEST)


def test_a_successful_open_is_ready_and_shutdown_closes_the_store(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = FakeStore(READY)
    runtime = runtime_with(stub_module(opened=fake), monkeypatch)
    asyncio.run(runtime.open())
    assert asyncio.run(runtime.refresh()) == READY
    asyncio.run(runtime.close())
    assert fake.closed
    asyncio.run(runtime.close())


def test_no_data_dir_is_unconfigured_and_opens_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    runtime = runtime_with(stub_module(data_dir=None), monkeypatch)
    asyncio.run(runtime.open())
    assert asyncio.run(runtime.refresh()).state == "unconfigured"


@pytest.mark.parametrize(
    ("error", "state"),
    [
        (real_store.SchemaNewer(), "schema-newer"),
        (real_store.SqliteTooOld(), "sqlite-too-old"),
        (real_store.StoreUnconfigured(), "unconfigured"),
        (real_store.StoreUnavailable(), "unavailable"),
        (RuntimeError("/private/path/specter-arena.db is locked"), "unavailable"),
    ],
)
def test_an_open_failure_maps_by_type_and_never_raises(
    monkeypatch: pytest.MonkeyPatch, error: BaseException, state: str
) -> None:
    runtime = runtime_with(stub_module(opened=error), monkeypatch)
    asyncio.run(runtime.open())
    status = asyncio.run(runtime.refresh())
    assert status.state == state
    assert "/private" not in repr(status)


def test_the_status_reads_migrating_while_the_store_opens(monkeypatch: pytest.MonkeyPatch) -> None:
    gate = threading.Event()
    runtime = runtime_with(stub_module(opened=FakeStore(READY), gate=gate), monkeypatch)

    async def scenario() -> tuple[Any, Any]:
        task = asyncio.create_task(runtime.open())
        await asyncio.sleep(0.05)
        during = runtime._status
        gate.set()
        await task
        return during, await runtime.refresh()

    during, after = asyncio.run(scenario())
    assert during.state == "migrating"
    assert after == READY


def test_a_status_read_that_fails_becomes_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeStore(READY)
    runtime = runtime_with(stub_module(opened=fake), monkeypatch)
    asyncio.run(runtime.open())
    fake._status = OSError("disk gone")
    assert asyncio.run(runtime.refresh()).state == "unavailable"


def test_refresh_before_open_is_unconfigured(monkeypatch: pytest.MonkeyPatch) -> None:
    runtime = runtime_with(stub_module(), monkeypatch)
    assert asyncio.run(runtime.refresh()).state == "unconfigured"


def test_under_the_probe_switch_open_imports_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    runtime = StoreRuntime(probe_on=True, environ={})

    def refuse() -> None:
        raise AssertionError("the store module was requested under the probe switch")

    monkeypatch.setattr(runtime, "_store_module", refuse)
    asyncio.run(runtime.open())
    asyncio.run(runtime.close())


def test_the_real_store_opens_ready_under_a_crew_home(tmp_path: Path) -> None:
    env = {"KIROCREW_HOME": str(tmp_path), "KIROCREW_APP_NAME": "specter-arena"}
    runtime = StoreRuntime(probe_on=False, environ=env)
    asyncio.run(runtime.open())
    try:
        assert asyncio.run(runtime.refresh()) == READY
    finally:
        asyncio.run(runtime.close())
    assert (tmp_path / "apps" / "specter-arena" / "data" / "store" / "specter-arena.db").is_file()


def test_the_runtime_module_has_no_top_level_store_import() -> None:
    source = (REPO_ROOT / "backend" / "specter_arena" / "store_runtime.py").read_text()
    top = [line for line in source.splitlines() if line.startswith(("import ", "from "))]
    assert not any("store" in line or "sqlite3" in line for line in top), top


IMPORT_ONLY = """
import json, sys, os
import backend.app
print(json.dumps({
    "sqlite3": "sqlite3" in sys.modules,
    "store": any(n == "backend.specter_arena.store" or n.startswith("backend.specter_arena.store.")
                 for n in sys.modules),
}))
"""


def test_importing_the_app_loads_no_store_and_writes_no_file(tmp_path: Path) -> None:
    root = tmp_path / "root"
    (root / "backend").mkdir(parents=True)
    for part in ("app.py", "__init__.py", "specter_arena"):
        source = REPO_ROOT / "backend" / part
        target = root / "backend" / part
        if source.is_dir():
            import shutil

            shutil.copytree(source, target, ignore=shutil.ignore_patterns("__pycache__"))
        else:
            target.write_bytes(source.read_bytes())
    before = sorted(str(p) for p in tmp_path.rglob("*"))
    deps = str(Path(starlette.__file__).resolve().parents[1])
    env = {
        k: v for k, v in os.environ.items() if not k.startswith(("PYTHON", "SPECTER", "KIROCREW"))
    }
    env.update(PYTHONPATH=deps, PYTHONDONTWRITEBYTECODE="1", HOME=str(tmp_path / "home"))
    result = subprocess.run(
        [sys.executable, "-s", "-c", IMPORT_ONLY], cwd=root, env=env, capture_output=True, text=True
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {"sqlite3": False, "store": False}
    assert sorted(str(p) for p in tmp_path.rglob("*")) == before
