import asyncio
import logging
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from starlette.testclient import TestClient

import backend.app as app_module
from backend.specter_arena.collector import boot as boot_module
from backend.specter_arena.collector.boot import boot_collector
from backend.specter_arena.collector.supervisor import Collector, State
from backend.specter_arena.store import Store, open_store
from backend.specter_arena.store_runtime import StoreRuntime

GATEWAY_ENV = {
    "KIROCREW_GATEWAY_ORIGIN": "http://127.0.0.1:1",
    "KIROCREW_PROXY_SECRET": "test-app-secret",
    "KIROCREW_APP_NAME": "specter-arena",
}


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    opened = open_store(tmp_path / "data")
    try:
        yield opened
    finally:
        opened.close()


def run(coro: Any) -> Any:
    return asyncio.run(coro)


@pytest.mark.parametrize(
    "missing", ["KIROCREW_GATEWAY_ORIGIN", "KIROCREW_PROXY_SECRET"], ids=["no-origin", "no-secret"]
)
def test_a_missing_gateway_value_returns_none_and_logs_without_starting(
    store: Store, missing: str, caplog: pytest.LogCaptureFixture
) -> None:
    environ = {k: v for k, v in GATEWAY_ENV.items() if k != missing}
    with caplog.at_level(logging.INFO, logger="specter_arena.collector.boot"):
        assert run(boot_collector(store, environment=environ)) is None
    assert "collector not started" in caplog.text
    assert GATEWAY_ENV["KIROCREW_PROXY_SECRET"] not in caplog.text


def test_an_empty_environment_returns_none() -> None:
    assert run(boot_collector(None, environment={})) is None  # type: ignore[arg-type]


def test_with_the_gateway_environment_the_collector_starts_and_stops_cleanly(store: Store) -> None:
    async def scenario() -> Collector:
        collector = await boot_collector(store, environment=GATEWAY_ENV)
        assert collector is not None
        await collector.stop()
        return collector

    collector = run(scenario())
    assert collector.status().state is State.STOPPED
    with store.read() as conn:
        rows = [tuple(r) for r in conn.execute("SELECT end_reason FROM collector_run")]
    assert rows == [("restart",)]


def test_a_failure_while_starting_is_swallowed_and_logged_by_type_only(
    store: Store, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    async def boom(self: Collector) -> None:
        raise RuntimeError("path /Users/someone/secret")

    monkeypatch.setattr(Collector, "start", boom)
    with caplog.at_level(logging.WARNING, logger="specter_arena.collector.boot"):
        assert run(boot_collector(store, environment=GATEWAY_ENV)) is None
    assert "RuntimeError" in caplog.text and "/Users/" not in caplog.text


def test_the_run_id_is_a_fresh_128_bit_hex_value_never_derived_from_crew_values(
    store: Store,
) -> None:
    async def scenario() -> list[str]:
        ids = []
        for _ in range(2):
            collector = await boot_collector(store, environment=GATEWAY_ENV)
            assert collector is not None
            await collector.stop()
        with store.read() as conn:
            ids = [str(r[0]) for r in conn.execute("SELECT run_id FROM collector_run")]
        return ids

    ids = run(scenario())
    assert len(set(ids)) == 2
    for run_id in ids:
        assert len(run_id) == 32 and int(run_id, 16) >= 0
        assert GATEWAY_ENV["KIROCREW_PROXY_SECRET"] not in run_id


class OrderRecorder:
    """Stands in for the collector and the store runtime to record the lifespan order."""

    def __init__(self, events: list[str]) -> None:
        self.events = events
        self.probe_on = False
        self.store: object | None = object()

    async def open(self) -> None:
        self.events.append("store-open")

    async def close(self) -> None:
        self.events.append("store-close")


class RecordingCollector:
    def __init__(self, events: list[str]) -> None:
        self.events = events

    async def stop(self) -> None:
        self.events.append("collector-stop")

    def status(self) -> object:
        raise AssertionError("not used")


def test_the_lifespan_starts_the_collector_after_the_store_and_stops_it_before_the_close(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []

    async def fake_boot(opened: object) -> RecordingCollector:
        events.append("collector-start")
        return RecordingCollector(events)

    monkeypatch.setattr(boot_module, "boot_collector", fake_boot)
    original = app_module.app.state.store_runtime
    app_module.app.state.store_runtime = OrderRecorder(events)
    try:
        with TestClient(app_module.app):
            events.append("serving")
    finally:
        app_module.app.state.store_runtime = original
        app_module.app.state.collector = None
    assert events == ["store-open", "collector-start", "serving", "collector-stop", "store-close"]


def test_a_failed_store_open_never_boots_the_collector(monkeypatch: pytest.MonkeyPatch) -> None:
    called: list[str] = []

    async def fake_boot(opened: object) -> None:
        called.append("boot")

    monkeypatch.setattr(boot_module, "boot_collector", fake_boot)
    runtime = StoreRuntime(probe_on=False, environ={})
    original = app_module.app.state.store_runtime
    app_module.app.state.store_runtime = runtime
    try:
        with TestClient(app_module.app):
            assert app_module.app.state.collector is None
    finally:
        app_module.app.state.store_runtime = original
    assert called == []


def test_the_probe_switch_never_boots_the_collector(monkeypatch: pytest.MonkeyPatch) -> None:
    called: list[str] = []

    async def fake_boot(opened: object) -> None:
        called.append("boot")

    monkeypatch.setattr(boot_module, "boot_collector", fake_boot)
    runtime = StoreRuntime(probe_on=True, environ={})
    original = app_module.app.state.store_runtime
    app_module.app.state.store_runtime = runtime
    try:
        with TestClient(app_module.app):
            assert app_module.app.state.collector is None
    finally:
        app_module.app.state.store_runtime = original
    assert called == []


def test_a_boot_that_returns_none_leaves_the_app_serving(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_boot(opened: object) -> None:
        return None

    monkeypatch.setattr(boot_module, "boot_collector", fake_boot)
    original = app_module.app.state.store_runtime
    app_module.app.state.store_runtime = OrderRecorder([])
    try:
        with TestClient(app_module.app) as client:
            assert client.get("/health").status_code == 200
    finally:
        app_module.app.state.store_runtime = original


def test_the_full_lifespan_collects_from_a_fake_gateway_and_serves_the_roster(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from backend.specter_arena.collector import gateway as gateway_module
    from backend.tests.collector_scenarios import DM_A, HoldingGateway, bot_row, slots
    from backend.tests.test_routes_ping import SECRET, sign_headers

    gateway = HoldingGateway(feeds=[[slots(bot_row(), bot_row("member-bot-c"))]])
    monkeypatch.setattr(gateway_module, "GatewayClient", lambda env: gateway)
    for name, value in {
        "KIROCREW_HOME": str(tmp_path / "home"),
        "KIROCREW_APP_NAME": "specter-arena",
        "KIROCREW_GATEWAY_ORIGIN": "http://127.0.0.1:1",
        "KIROCREW_PROXY_SECRET": SECRET,
    }.items():
        monkeypatch.setenv(name, value)
    original = app_module.app.state.store_runtime
    app_module.app.state.store_runtime = StoreRuntime(probe_on=False)
    try:
        with TestClient(app_module.app) as client:
            collector = app_module.app.state.collector
            assert collector is not None
            deadline = 5.0
            while collector.status().state is not State.RUNNING and deadline > 0:
                time.sleep(0.01)
                deadline -= 0.01
            assert collector.status().state is State.RUNNING
            body = client.get("/api/roster", headers=sign_headers("/api/roster")).json()
            while not body["items"] and deadline > 0:
                time.sleep(0.05)
                deadline -= 0.05
                body = client.get("/api/roster", headers=sign_headers("/api/roster")).json()
            assert [item["presence"] for item in body["items"]] == ["unknown"]
            assert body["collector"]["state"] == "running"
            assert body["notes"][1] == {"code": "unsupported-store-less-bot", "count": 1}
            assert DM_A not in str(body)
            ready = client.get("/api/ready", headers=sign_headers("/api/ready"))
            assert ready.status_code == 200
        assert collector.status().state is State.STOPPED
    finally:
        app_module.app.state.store_runtime = original
        app_module.app.state.collector = None
