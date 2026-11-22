"""FP-22: the task and XP routes, their contracts (task-item v1, tasks v1, xp-summary v2,
xp-summaries v3), the totals over both ledgers, the migration guards, and what a purge, an export
and the boot sweep do with tasks."""

import asyncio
import json
import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from starlette.applications import Starlette
from starlette.testclient import TestClient

from backend.specter_arena.store import Store, export_database
from backend.specter_arena.store import lifecycle as lc
from backend.specter_arena.store.tasks import task_id_for
from backend.specter_arena.store.xp import xp_summaries_v2_page
from backend.specter_arena.work.boot import boot_tasks
from backend.specter_arena.work.service import WorkService
from backend.specter_arena.work_routes import work_routes

from .contract_support import compile_schema, load_registry
from .specter_fakes import FakeClock
from .task_fakes import MIN, T0, beat, covered_store, run_worker, tasks, worker_row
from .work_api_fakes import SIGNING_VALUE, URN, Api
from .work_fakes import make_work, query, submit_and_accept, worker_attempt

REGISTRY = load_registry()
START = T0 + 10
NOW = T0 + 60 * MIN


SCHEMAS = {
    "task-item": "urn:specter-arena:contract:task-item:v1",
    "tasks": "urn:specter-arena:contract:tasks:v1",
    "xp-summary": "urn:specter-arena:contract:xp-summary:v2",
    "xp-summaries": "urn:specter-arena:contract:xp-summaries:v3",
}


def check(name: str, major: int, body: Any) -> None:
    schema_id = SCHEMAS.get(name, f"{URN}{name}:v{major}")
    assert schema_id.endswith(f":v{major}")
    compile_schema(schema_id, REGISTRY)(body)


@pytest.fixture(autouse=True)
def gateway_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KIROCREW_PROXY_SECRET", SIGNING_VALUE)


@pytest.fixture
def rig(tmp_path: Path) -> Iterator[tuple[Store, list[str], Api]]:
    store, bots = covered_store(tmp_path)
    app = Starlette(routes=work_routes())
    app.state.work = WorkService(store, clock=FakeClock(NOW))
    try:
        with TestClient(app) as client:
            yield store, bots, Api(client)
    finally:
        store.close()


# ---- routes and contracts -------------------------------------------------------------------


def test_the_task_list_and_item_match_their_contracts(rig: tuple[Store, list[str], Api]) -> None:
    store, bots, api = rig
    run_worker(store, 0, 1, START, START + 3 * MIN)
    run_worker(store, 1, 2, START + 10, START + 20, pendingApproval=True)
    beat(store, START + 30)
    worker_row(store, 0, 3, START + 30, running=True)
    response = api.get("/api/tasks")
    assert response.status_code == 200
    body = response.json()
    check("tasks", 1, body)
    assert body["asOfMs"] == NOW and body["nextCursor"] is None
    for item in body["items"]:
        check("task-item", 1, item)
        credited = item["state"] == "credited"
        assert credited == (item["closeReason"] == "clean-end") == (item["xpCredited"] is not None)
        assert item["policyVersion"] == "xp-policy-2"
        assert (item["state"] == "open") == (item["closeReason"] is None)
    by_state = {item["state"]: item for item in body["items"]}
    assert (
        by_state["credited"]["xpCredited"] == 11 and by_state["credited"]["sizeClass"] == "medium"
    )
    assert by_state["not-credited"]["closeReason"] == "waiting-at-end"
    assert by_state["open"]["runMs"] == NOW - (START + 30)
    assert (
        by_state["open"]["sizeClass"] == "large" and by_state["open"]["attemptState"] == "unknown"
    )
    one = api.get("/api/tasks/" + by_state["credited"]["taskId"])
    assert one.status_code == 200 and one.json() == by_state["credited"]
    check("task-item", 1, one.json())
    assert by_state["credited"]["bindingId"] == bots[0]


def test_the_list_filters_pages_and_budgets_its_size(rig: tuple[Store, list[str], Api]) -> None:
    store, bots, api = rig
    for number in range(1, 31):
        run_worker(store, number % 2, number, START + number * 100, START + number * 100 + 10)
    first = api.get("/api/tasks")
    assert len(first.json()["items"]) == 25 and first.json()["nextCursor"]
    assert len(first.content) < 16_000
    second = api.get("/api/tasks?cursor=" + first.json()["nextCursor"])
    assert len(second.json()["items"]) == 5
    mine = api.get(f"/api/tasks?bindingId={bots[1]}&state=credited&limit=7")
    assert len(mine.json()["items"]) == 7
    assert {i["bindingId"] for i in mine.json()["items"]} == {bots[1]}
    assert api.get("/api/tasks?limit=1000").json()["items"].__len__() == 25


@pytest.mark.parametrize(
    ("target", "status", "code"),
    [
        ("/api/tasks?state=accepted", 400, "invalid_state"),
        ("/api/tasks?bindingId=nope", 404, "unknown_binding"),
        ("/api/tasks?cursor=zzz", 400, "invalid_cursor"),
        ("/api/tasks?limit=x", 400, "invalid_limit"),
        ("/api/tasks/tsk_" + "0" * 24, 404, "unknown_task"),
        ("/api/tasks/nope", 404, "unknown_task"),
        ("/api/xp?view=other", 400, "invalid_view"),
    ],
)
def test_bad_requests_get_api_error_codes(
    rig: tuple[Store, list[str], Api], target: str, status: int, code: str
) -> None:
    _, _, api = rig
    response = api.get(target)
    assert (response.status_code, response.json()) == (
        status,
        {"contractVersion": 1, "error": code},
    )
    check("api-error", 1, response.json())


@pytest.mark.parametrize(
    "target", ["/api/tasks", "/api/tasks/tsk_" + "0" * 24, "/api/xp?view=tasks"]
)
def test_the_task_routes_need_a_signature(rig: tuple[Store, list[str], Api], target: str) -> None:
    _, _, api = rig
    assert api.call("GET", target, sign=False).status_code == 401


def test_the_task_routes_are_get_only(rig: tuple[Store, list[str], Api]) -> None:
    _, _, api = rig
    assert api.post("/api/tasks").status_code == 405
    assert api.call("DELETE", "/api/tasks/tsk_" + "0" * 24).status_code == 405


def test_the_service_is_absent_the_routes_answer_503(tmp_path: Path) -> None:
    app = Starlette(routes=work_routes())
    app.state.work = None
    with TestClient(app) as client:
        assert Api(client).get("/api/tasks").status_code == 503


# ---- XP over both ledgers -------------------------------------------------------------------


def test_totals_add_both_ledgers_and_the_old_views_stay_as_they_were(
    rig: tuple[Store, list[str], Api],
) -> None:
    store, bots, api = rig
    legacy_attempts = [worker_attempt(store, 0, n) for n in (11, 12)]
    record = make_work(store, legacy_attempts, 1, at=START + 1000)
    submit_and_accept(store, record, 1, at=START + 2000)
    old_all = api.get("/api/xp").content
    old_paged = api.get("/api/xp?view=paged").content
    history = api.get(f"/api/roster/{bots[0]}/xp").content
    # Two tasks came from the two legacy attempts; add a bot with task XP only.
    run_worker(store, 1, 40, START + 5000, START + 5000 + 3 * MIN)
    assert api.get("/api/xp").content == old_all
    assert api.get("/api/xp?view=paged").content == old_paged
    assert api.get(f"/api/roster/{bots[0]}/xp").content == history
    response = api.get("/api/xp?view=tasks")
    body = response.json()
    check("xp-summaries", 3, body)
    by_bot = {item["bindingId"]: item for item in body["items"]}
    assert [i["bindingId"] for i in body["items"]] == sorted(by_bot)
    legacy = by_bot[bots[0]]
    assert legacy["totalXp"] == 100 + 2 * 10 and legacy["creditedTaskCount"] == 2
    assert legacy["acceptedWorkCount"] == 1 and legacy["level"] == 2
    assert legacy["policyVersion"] == "xp-policy-2" and legacy["levelFloorXp"] == 100
    assert by_bot[bots[1]]["totalXp"] == 11 and by_bot[bots[1]]["acceptedWorkCount"] == 0
    assert by_bot[bots[1]]["level"] == 1 and by_bot[bots[1]]["nextLevelXp"] == 100
    for item in body["items"]:
        check("xp-summary", 2, item)


def test_the_task_view_pages_by_binding_and_leaves_out_bots_with_no_xp(
    rig: tuple[Store, list[str], Api],
) -> None:
    store, bots, api = rig
    assert api.get("/api/xp?view=tasks").json()["items"] == []
    run_worker(store, 0, 1, START, START + 10)
    run_worker(store, 1, 2, START + 20, START + 30, needsInput=True)
    body = api.get("/api/xp?view=tasks").json()
    assert [i["bindingId"] for i in body["items"]] == [bots[0]]
    first = xp_summaries_v2_page(store, cursor=None, limit=1)
    assert first.next_cursor is None and len(first.items) == 1


def test_a_task_award_never_changes_a_legacy_entry(rig: tuple[Store, list[str], Api]) -> None:
    store, _, _ = rig
    before = query(store, "SELECT count(*) FROM xp_entry")
    run_worker(store, 0, 1, START, START + 10)
    assert query(store, "SELECT count(*) FROM xp_entry") == before


# ---- the migration's own guards -------------------------------------------------------------


def refuses(store: Store, sql: str, *params: object) -> None:
    with pytest.raises(sqlite3.IntegrityError), store.write() as conn:
        conn.execute(sql, params)


def test_the_triggers_keep_the_ledger_append_only_and_credit_final(
    rig: tuple[Store, list[str], Api],
) -> None:
    store, bots, _ = rig
    run_worker(store, 0, 1, START, START + 3 * MIN)
    run_worker(store, 0, 2, START + 10, START + 20, pendingApproval=True)
    credited = str(query(store, "SELECT task_id FROM task WHERE state = 'credited'")[0][0])
    lost = str(query(store, "SELECT task_id FROM task WHERE state = 'not-credited'")[0][0])
    refuses(store, "DELETE FROM task")
    refuses(store, "DELETE FROM task_xp_entry")
    refuses(store, "UPDATE task_xp_entry SET amount = 30")
    refuses(
        store,
        "UPDATE task SET state = 'not-credited', close_reason = 'coverage-gap' WHERE task_id = ?",
        credited,
    )
    refuses(store, "UPDATE task SET closed_ms = closed_ms + 1 WHERE task_id = ?", credited)
    refuses(store, "UPDATE task SET binding_id = ? WHERE task_id = ?", bots[1], credited)
    refuses(store, "UPDATE task SET started_ms = 1 WHERE task_id = ?", credited)
    refuses(store, "UPDATE task SET updated_ms = 0 WHERE task_id = ?", credited)
    # a not-credited task cannot jump to credited without an award, or skip `open`
    refuses(
        store,
        "UPDATE task SET state = 'credited', close_reason = 'clean-end' WHERE task_id = ?",
        lost,
    )
    new = (
        "INSERT INTO task_xp_entry (entry_id, task_id, binding_id, amount, policy_version,"
        " created_ms) VALUES (?, ?, ?, ?, ?, 1)"
    )
    refuses(store, new, "txe_" + "1" * 24, credited, bots[0], 11, "xp-policy-2")  # second award
    refuses(store, new, "txe_" + "2" * 24, lost, bots[0], 10, "xp-policy-2")  # not open
    refuses(store, new, "txe_" + "3" * 24, credited, bots[0], 31, "xp-policy-2")  # above the cap
    refuses(store, new, "txe_" + "4" * 24, credited, bots[0], 11, "xp-policy-1")  # policy
    refuses(
        store,
        "INSERT INTO task (task_id, attempt_id, binding_id, kind, started_ms,"
        " running, state, close_reason, closed_ms, created_ms, updated_ms)"
        " VALUES (?, ?, ?, 'worker', 1, 1, 'credited', 'clean-end', 1, 1, 1)",
        "tsk_" + "5" * 24,
        "att_" + "5" * 24,
        bots[0],
    )


def test_an_award_needs_an_ended_open_task_of_the_same_bot_at_the_policy_amount(
    rig: tuple[Store, list[str], Api],
) -> None:
    store, bots, _ = rig
    beat(store, START)
    worker_row(store, 0, 1, START, running=True)
    running = str(query(store, "SELECT task_id FROM task")[0][0])
    new = (
        "INSERT INTO task_xp_entry (entry_id, task_id, binding_id, amount, policy_version,"
        " created_ms) VALUES (?, ?, ?, ?, 'xp-policy-2', 1)"
    )
    refuses(store, new, "txe_" + "6" * 24, running, bots[0], 10)  # still running
    with store.write() as conn:
        conn.execute(
            "UPDATE task SET running = 0, ended_ms = started_ms + 300000, "
            "end_signal = 'row-idle' WHERE task_id = ?",
            (running,),
        )
    refuses(store, new, "txe_" + "7" * 24, running, bots[1], 11)  # another bot
    refuses(store, new, "txe_" + "8" * 24, running, bots[0], 13)  # not the policy amount
    refuses(store, new, "txe_" + "9" * 24, "tsk_" + "f" * 24, bots[0], 10)  # no such task
    with store.write() as conn:
        conn.execute(new, ("txe_" + "a" * 24, running, bots[0], 12))
    assert query(store, "SELECT amount FROM task_xp_entry") == [(12,)]


# ---- purge, export, boot --------------------------------------------------------------------


def test_a_purge_of_observations_and_attempts_leaves_tasks_and_awards(
    rig: tuple[Store, list[str], Api],
) -> None:
    store, _, _ = rig
    run_worker(store, 0, 1, START, START + 3 * MIN)
    run_worker(store, 0, 2, START + 10, START + 20, pendingApproval=True)
    before = (query(store, "SELECT * FROM task"), query(store, "SELECT * FROM task_xp_entry"))
    record = lc.run_purge(store, NOW, lambda: NOW)
    assert record.state == "completed" and record.attempts == 2
    assert query(store, "SELECT count(*) FROM attempt") == [(0,)]
    assert (
        query(store, "SELECT * FROM task"),
        query(store, "SELECT * FROM task_xp_entry"),
    ) == before


def test_an_export_carries_the_task_tables(rig: tuple[Store, list[str], Api]) -> None:
    store, _, _ = rig
    run_worker(store, 0, 1, START, START + 3 * MIN)
    made = export_database(store)
    copy = sqlite3.connect(store.data_dir / "exports" / made.file_name)
    try:
        assert copy.execute("SELECT count(*) FROM task").fetchone() == (1,)
        assert copy.execute("SELECT amount FROM task_xp_entry").fetchone() == (11,)
    finally:
        copy.close()


def test_the_boot_sweep_closes_out_and_never_raises(
    rig: tuple[Store, list[str], Api], caplog: pytest.LogCaptureFixture
) -> None:
    store, _, _ = rig
    asyncio.run(boot_tasks(store))
    assert tasks(store) == []
    store.close()
    with caplog.at_level("WARNING", logger="specter_arena.work.boot"):
        asyncio.run(boot_tasks(store))
    assert "task sweep at boot failed" in caplog.text


def test_the_boot_sweep_backfills_attempts_swept_while_paused(
    rig: tuple[Store, list[str], Api], monkeypatch: pytest.MonkeyPatch
) -> None:
    store, _, _ = rig
    from backend.specter_arena.store import set_paused
    from backend.specter_arena.work import boot as boot_module

    monkeypatch.setattr(boot_module, "_now_ms", lambda: START + 3 * MIN + 100)

    set_paused(store, True, T0)
    run_worker(store, 0, 1, START, START + 3 * MIN)
    assert tasks(store) == []
    set_paused(store, False, T0 + 1)
    asyncio.run(boot_tasks(store))
    assert [row[2] for row in tasks(store)] == ["credited"]
    assert json.dumps(task_id_for(str(query(store, "SELECT attempt_id FROM attempt")[0][0])))
