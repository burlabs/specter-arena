"""FP-30 PR 1: `GET /api/recap` and `recap.v1` (FP30-REQ-03, -04, -09). The route is signed and
read-only, rejects a bad period with `api-error` `bad_period`, clamps `toMs` to the store clock,
and its body matches the contract. A 1,000-task body stays under 512 KiB."""

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from urllib.parse import quote

import pytest
from starlette.applications import Starlette
from starlette.testclient import TestClient

from backend.specter_arena.store import CoverageMark, Store
from backend.specter_arena.store.recap import RECAP_TASK_CAP, recap_tasks
from backend.specter_arena.work.recap_wire import recap_wire
from backend.specter_arena.work.service import PERIOD_MAX_MS, WorkService
from backend.specter_arena.work.task_wire import task_item_wire
from backend.specter_arena.work_routes import work_routes

from .contract_support import compile_schema, load_registry
from .specter_fakes import FakeClock
from .task_fakes import MIN, T0, beat, covered_store, run_worker
from .test_store_recap import insert_tasks
from .work_api_fakes import SIGNING_VALUE, URN, Api
from .work_fakes import send

REGISTRY = load_registry()
NOW = T0 + 60 * MIN
SIZE_LIMIT_BYTES = 512 * 1024


def check(body: Any) -> None:
    compile_schema("urn:specter-arena:contract:recap:v1", REGISTRY)(body)


def tiles(body: dict[str, Any]) -> None:
    spans = body["coverage"]["spans"]
    assert spans[0]["fromMs"] == body["fromMs"] and spans[-1]["toMs"] == body["toMs"]
    assert all(a["toMs"] == b["fromMs"] for a, b in zip(spans, spans[1:], strict=False))


@pytest.fixture(autouse=True)
def gateway_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KIROCREW_PROXY_SECRET", SIGNING_VALUE)


@pytest.fixture
def rig(tmp_path: Path) -> Iterator[tuple[Store, list[str], Api, FakeClock]]:
    store, bots = covered_store(tmp_path)
    clock = FakeClock(NOW)
    app = Starlette(routes=work_routes())
    app.state.work = WorkService(store, clock=clock)
    try:
        with TestClient(app) as client:
            yield store, bots, Api(client), clock
    finally:
        store.close()


def url(from_ms: object, to_ms: object) -> str:
    return f"/api/recap?fromMs={from_ms}&toMs={to_ms}"


def test_the_recap_body_matches_the_contract(
    rig: tuple[Store, list[str], Api, FakeClock],
) -> None:
    store, _, api, _ = rig
    run_worker(store, 0, 1, T0 + MIN, T0 + 4 * MIN)
    run_worker(store, 1, 2, T0 + 5 * MIN, T0 + 6 * MIN, pendingApproval=True)
    beat(store, T0 + 20 * MIN)
    send(store, CoverageMark("close", T0 + 20 * MIN, "paused"))
    beat(store, T0 + 30 * MIN)
    response = api.get(url(T0, T0 + 40 * MIN))
    assert response.status_code == 200
    body = response.json()
    check(body)
    tiles(body)
    assert body["asOfMs"] == NOW and body["fromMs"] == T0 and body["toMs"] == T0 + 40 * MIN
    assert body["taskCap"] == 1000 and body["truncated"] is False and body["omittedCount"] == 0
    assert [t["state"] for t in body["tasks"]] == ["credited", "not-credited"]
    assert body["tasks"][0]["xpCredited"] == 11
    assert body["coverage"]["firstRunMs"] == T0 - 1
    reasons = [(s["state"], s["reason"]) for s in body["coverage"]["spans"]]
    assert ("not-collected", "paused") in reasons and ("covered", "collecting") in reasons
    assert response.headers["x-content-type-options"] == "nosniff"


def test_an_unsigned_request_is_rejected(rig: tuple[Store, list[str], Api, FakeClock]) -> None:
    _, _, api, _ = rig
    assert api.call("GET", url(T0, T0 + MIN), sign=False).status_code == 401


def test_the_route_is_get_only(rig: tuple[Store, list[str], Api, FakeClock]) -> None:
    _, _, api, _ = rig
    assert api.call("POST", url(T0, T0 + MIN), {}).status_code == 405


@pytest.mark.parametrize(
    ("from_ms", "to_ms"),
    [
        (None, None),
        (T0, None),
        (None, T0 + MIN),
        ("", T0 + MIN),
        (T0, ""),
        ("abc", T0 + MIN),
        (T0, "1e3"),
        ("-5", T0 + MIN),
        (T0, "-1"),
        ("1.5", T0 + MIN),
        (f"{T0}.0", T0 + MIN),
        ("+5", T0 + MIN),
        ("%20" + str(T0), T0 + MIN),
        ("1" * 17, T0 + MIN),
        ("\u0661\u0662", T0 + MIN),
        (T0 + MIN, T0),
        (T0, T0),
        (T0, T0 + PERIOD_MAX_MS + 1),
        (0, PERIOD_MAX_MS + 1),
    ],
)
def test_a_bad_period_is_bad_period(
    rig: tuple[Store, list[str], Api, FakeClock], from_ms: object, to_ms: object
) -> None:
    _, _, api, _ = rig
    pairs = (("fromMs", from_ms), ("toMs", to_ms))
    query = "&".join(f"{name}={quote(str(value))}" for name, value in pairs if value is not None)
    response = api.get(f"/api/recap?{query}" if query else "/api/recap")
    assert response.status_code == 400
    assert response.json() == {"contractVersion": 1, "error": "bad_period"}
    compile_schema(f"{URN}api-error:v1", REGISTRY)(response.json())


def test_an_eight_day_period_is_allowed(rig: tuple[Store, list[str], Api, FakeClock]) -> None:
    _, _, api, clock = rig
    clock.now = T0 + PERIOD_MAX_MS
    response = api.get(url(T0, T0 + PERIOD_MAX_MS))
    assert response.status_code == 200
    body = response.json()
    check(body)
    assert body["toMs"] - body["fromMs"] == PERIOD_MAX_MS


def test_to_is_clamped_to_the_store_clock(rig: tuple[Store, list[str], Api, FakeClock]) -> None:
    _, _, api, _ = rig
    body = api.get(url(T0, NOW + 5 * MIN)).json()
    check(body)
    assert body["toMs"] == NOW and body["coverage"]["spans"][-1]["toMs"] == NOW


def test_a_period_that_starts_after_the_clock_is_bad_period(
    rig: tuple[Store, list[str], Api, FakeClock],
) -> None:
    _, _, api, _ = rig
    for from_ms in (NOW, NOW + MIN):
        assert api.get(url(from_ms, NOW + 5 * MIN)).json()["error"] == "bad_period"


def test_a_period_with_no_tasks_still_says_what_was_covered(
    rig: tuple[Store, list[str], Api, FakeClock],
) -> None:
    store, _, api, _ = rig
    beat(store, T0 + 10 * MIN)
    body = api.get(url(T0, T0 + 10 * MIN)).json()
    check(body)
    assert body["tasks"] == []
    assert body["coverage"]["spans"] == [
        {"fromMs": T0, "toMs": T0 + 10 * MIN, "state": "covered", "reason": "collecting"}
    ]


def test_a_store_that_is_not_ready_answers_503() -> None:
    app = Starlette(routes=work_routes())
    with TestClient(app) as client:
        assert Api(client).get(url(T0, T0 + MIN)).status_code == 503


def test_a_full_recap_is_under_512_kib_and_says_it_is_truncated(tmp_path: Path) -> None:
    store, bots = covered_store(tmp_path, bots=1)
    insert_tasks(store, RECAP_TASK_CAP + 5, bots[0], T0 + MIN, 2000)
    app = Starlette(routes=work_routes())
    app.state.work = WorkService(store, clock=FakeClock(NOW + 24 * 60 * MIN))
    try:
        with TestClient(app) as client:
            response = Api(client).get(url(T0, T0 + 24 * 60 * MIN))
        assert response.status_code == 200
        size = len(response.content)
        print(f"RECAP-SIZE tasks=1000 bytes={size}")
        assert size < SIZE_LIMIT_BYTES
        body = response.json()
        check(body)
        assert len(body["tasks"]) == 1000 and body["truncated"] and body["omittedCount"] == 5
    finally:
        store.close()


def test_the_wire_maps_every_field_of_the_result(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    run_worker(store, 0, 1, T0 + MIN, T0 + 4 * MIN)
    result = recap_tasks(store, T0, T0 + 10 * MIN, T0 + 10 * MIN)
    body = recap_wire(result)
    check(json.loads(json.dumps(body)))
    assert body["tasks"] == [task_item_wire(result.tasks[0])]
    assert body["coverage"] == {
        "firstRunMs": T0 - 1,
        "purgeHorizonMs": None,
        "spans": [
            {"fromMs": s[2], "toMs": s[3], "state": s[0], "reason": s[1]} for s in result.spans
        ],
    }
    store.close()
