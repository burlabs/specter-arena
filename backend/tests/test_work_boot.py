"""The work service boots after the store, never under the probe switch, and a failure leaves
every work route answering 503 while the rest of the app runs (FP0809-CI-03)."""

import logging
from collections.abc import Iterator
from pathlib import Path

import pytest
from starlette.testclient import TestClient

import backend.app as app_module
import backend.specter_arena.collector.boot as collector_boot
import backend.specter_arena.specters.boot as specters_boot
import backend.specter_arena.work.boot as work_boot
import backend.specter_arena.work.service as service_module
from backend.specter_arena.store import Store, open_store
from backend.specter_arena.store_runtime import StoreRuntime
from backend.specter_arena.work.service import WorkService

from .work_api_fakes import SIGNING_VALUE, Api


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    opened = open_store(tmp_path / "data")
    try:
        yield opened
    finally:
        opened.close()


@pytest.fixture(autouse=True)
def isolated_app(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    async def no_collector(opened: object) -> None:
        return None

    async def no_specters(opened: object) -> None:
        return None

    monkeypatch.setenv("KIROCREW_PROXY_SECRET", SIGNING_VALUE)
    monkeypatch.setattr(collector_boot, "boot_collector", no_collector)
    monkeypatch.setattr(specters_boot, "boot_specters", no_specters)
    original = app_module.app.state.store_runtime
    yield
    app_module.app.state.store_runtime = original
    app_module.app.state.collector = None
    app_module.app.state.specters = None
    app_module.app.state.work = None


def test_boot_work_returns_a_service_over_a_real_store(store: Store) -> None:
    assert isinstance(work_boot.boot_work(store), WorkService)


def test_a_failure_while_building_is_swallowed_and_logged_by_type_only(
    store: Store, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    def broken(*args: object, **kwargs: object) -> None:
        raise RuntimeError("secret-path /Users/someone/data")

    monkeypatch.setattr(service_module, "WorkService", broken)
    with caplog.at_level(logging.WARNING, logger="specter_arena.work.boot"):
        assert work_boot.boot_work(store) is None
    assert "RuntimeError" in caplog.text
    assert "/Users/" not in caplog.text and "secret-path" not in caplog.text


def test_the_lifespan_builds_the_service_after_the_store_opens(tmp_path: Path) -> None:
    app_module.app.state.store_runtime = StoreRuntime(
        probe_on=False,
        environ={"KIROCREW_HOME": str(tmp_path / "home"), "KIROCREW_APP_NAME": "specter-arena"},
    )
    with TestClient(app_module.app) as client:
        assert isinstance(app_module.app.state.work, WorkService)
        response = Api(client).get("/api/xp")
        assert response.status_code == 200
        assert response.json()["items"] == []
        assert Api(client).get("/api/work").json()["items"] == []
    assert app_module.app.state.store_runtime.store is None


def test_a_failed_store_open_leaves_the_service_unset_and_the_routes_503(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def must_not_run(opened: object) -> None:
        raise AssertionError("boot_work ran without a store")

    monkeypatch.setattr(work_boot, "boot_work", must_not_run)
    app_module.app.state.store_runtime = StoreRuntime(probe_on=False, environ={})
    with TestClient(app_module.app) as client:
        assert app_module.app.state.work is None
        api = Api(client)
        for target in ("/api/xp", "/api/work"):
            response = api.get(target)
            assert response.status_code == 503, target
            assert response.json() == {"contractVersion": 1, "error": "store_not_ready"}
        assert client.get("/health").status_code == 200


def test_the_probe_switch_never_boots_the_service(monkeypatch: pytest.MonkeyPatch) -> None:
    def must_not_run(opened: object) -> None:
        raise AssertionError("boot_work ran under the probe switch")

    monkeypatch.setattr(work_boot, "boot_work", must_not_run)
    app_module.app.state.store_runtime = StoreRuntime(probe_on=True, environ={})
    with TestClient(app_module.app) as client:
        assert app_module.app.state.work is None
        assert Api(client).get("/api/xp").status_code == 503


def test_a_service_that_failed_to_build_leaves_the_other_routes_running(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(work_boot, "boot_work", lambda opened: None)
    app_module.app.state.store_runtime = StoreRuntime(
        probe_on=False,
        environ={"KIROCREW_HOME": str(tmp_path / "home"), "KIROCREW_APP_NAME": "specter-arena"},
    )
    with TestClient(app_module.app) as client:
        api = Api(client)
        assert app_module.app.state.work is None
        assert api.get("/api/xp").status_code == 503
        assert api.get("/api/roster").status_code == 200
