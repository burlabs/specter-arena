"""Collector to wire on a real store (FP4-D9).

The real collector, fed frames whose shapes `test_collector_fixtures.py` pins to the recorded
0.12.2 capture, writes a real SQLite store under `tmp_path`. Both routes are then read through the
signed client and validated against their schemas. The capture itself cannot be replayed into
attempts: it keeps no slot rows, only allow-listed event frames, and attempts come from slot rows.
"""

import asyncio
import json
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from starlette.testclient import TestClient

from backend.app import app
from backend.specter_arena import store as store_api
from backend.specter_arena.collector.supervisor import SqliteStorePort
from backend.specter_arena.store import Store, open_store
from backend.tests.collector_fakes import FakeClock
from backend.tests.collector_scenarios import (
    DM_A,
    SENTINEL,
    WORKER_1,
    bot_row,
    build,
    chat_done,
    slots,
    worker_row,
)
from backend.tests.contract_support import compile_schema, load_registry
from backend.tests.test_routes_ping import SECRET, sign_headers

REGISTRY = load_registry()
VALIDATE_ATTEMPTS = compile_schema("urn:specter-arena:contract:attempts:v1", REGISTRY)
VALIDATE_ROSTER = compile_schema("urn:specter-arena:contract:roster:v1", REGISTRY)

CAPTURE = (
    Path(__file__).resolve().parents[2] / "tests/recorded/crew-0.12.2/s1-v1-event-capture.json"
)
# The fake clock advances by the collector backoff, so it starts behind the route's wall clock.
CLOCK_HEAD_START_MS = 60_000
EVENT_TYPES = {
    "tool_call",
    "tool_result",
    "chat_status",
    "chat_done",
    "context_usage",
    "subagent_done",
}


class Runtime:
    probe_on = False

    def __init__(self, opened: Store) -> None:
        self.store = opened


@pytest.fixture(autouse=True)
def proxy_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KIROCREW_PROXY_SECRET", SECRET)


@pytest.fixture
def opened(tmp_path: Path) -> Iterator[Store]:
    instance = open_store(tmp_path / "data")
    try:
        yield instance
    finally:
        instance.close()


@pytest.fixture
def use_app() -> Iterator[None]:
    runtime, collector = app.state.store_runtime, app.state.collector
    yield
    app.state.store_runtime, app.state.collector = runtime, collector


def get(target: str) -> Any:
    response = TestClient(app).get(target, headers=sign_headers(target))
    assert response.status_code == 200, response.text
    return response.json()


def collect_while_holding(opened: Store, run_id: str) -> tuple[Any, Any]:
    """Runs the real collector against `opened` and reads both routes while it holds the feed."""
    frames = [slots(bot_row(), worker_row(running=True)), chat_done(1)]
    harness = build(
        store=SqliteStorePort(opened),
        run_id=run_id,
        feeds=[frames],
        holding=True,
        clock=FakeClock(start_ms=int(time.time() * 1000) - CLOCK_HEAD_START_MS),
    )
    app.state.store_runtime = Runtime(opened)
    app.state.collector = None

    def read_routes() -> tuple[Any, Any]:
        store_api.heartbeat(opened, run_id=run_id, now_ms=int(time.time() * 1000))
        roster = get("/api/roster")
        (item,) = roster["items"]
        return roster, get(f"/api/roster/{item['bindingId']}/attempts")

    async def scenario() -> tuple[Any, Any]:
        await harness.collector.start()
        deadline = asyncio.get_running_loop().time() + 5
        while True:
            with opened.read() as conn:
                persisted = conn.execute("SELECT count(*) FROM observation").fetchone()[0]
            if persisted >= 3:
                break
            assert asyncio.get_running_loop().time() < deadline, "collector wrote nothing"
            await asyncio.sleep(0.005)
        try:
            return await asyncio.to_thread(read_routes)
        finally:
            await harness.collector.stop()

    return asyncio.run(scenario())


def test_the_recorded_capture_holds_no_slot_rows_so_it_cannot_be_replayed_into_attempts() -> None:
    rows = json.loads(CAPTURE.read_text(encoding="utf-8"))["rows"]
    assert len(rows) == 154
    assert {row["eventType"] for row in rows} <= EVENT_TYPES
    assert not any({"running", "created_by", "createdBy"} & set(row["data"]) for row in rows)


def test_the_real_collector_feeds_both_routes_a_schema_valid_two_attempt_body(
    use_app: None, opened: Store
) -> None:
    roster, attempts = collect_while_holding(opened, "run-00000001")
    VALIDATE_ROSTER(roster)
    VALIDATE_ATTEMPTS(attempts)
    assert sorted(item["kind"] for item in attempts["items"]) == ["bot-turn", "worker"]
    by_kind = {item["kind"]: item["condition"] for item in attempts["items"]}
    assert by_kind["bot-turn"] == {"state": "ended", "reasonCode": "ended-chat-done"}
    assert by_kind["worker"] == {"state": "working", "reasonCode": "running"}
    workers = roster["items"][0]["workers"]
    assert (workers["running"], workers["unknown"], workers["seen"]) == (1, 0, 1)
    for key in ("last24h", "last7d"):
        window = attempts["activity"][key]
        assert (window["botTurnsStarted"], window["workersStarted"], window["sampleSize"]) == (
            1,
            1,
            2,
        )
        assert window["ended"] + window["stillOpen"] + window["unknown"] == 2
    text = json.dumps([roster, attempts])
    for needle in (SENTINEL, DM_A, WORKER_1, "member-", ".memory-"):
        assert needle not in text


def test_a_second_collector_run_over_the_same_frames_adds_no_attempt(
    use_app: None, opened: Store
) -> None:
    _, first = collect_while_holding(opened, "run-00000001")
    _, second = collect_while_holding(opened, "run-00000002")
    assert [item["attemptId"] for item in second["items"]] == [
        item["attemptId"] for item in first["items"]
    ]
    for key in ("last24h", "last7d"):
        for field in ("botTurnsStarted", "workersStarted", "sampleSize"):
            assert second["activity"][key][field] == first["activity"][key][field]
