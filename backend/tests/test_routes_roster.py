import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from starlette.testclient import TestClient

from backend.app import app
from backend.specter_arena import store as store_api
from backend.specter_arena.collector.supervisor import CollectorStatus, State
from backend.specter_arena.store import (
    BindingSeen,
    CoverageMark,
    DmKey,
    IngestBatch,
    ObservationIn,
    RosterPoll,
    RosterRowIn,
    Store,
    open_store,
    start_run,
)
from backend.specter_arena.store.paging import PAGE_CONTRACT_VERSION
from backend.tests.contract_support import compile_schema, load_registry
from backend.tests.test_routes_ping import SECRET, sign_headers

REGISTRY = load_registry()
VALIDATE_ROSTER = compile_schema("urn:specter-arena:contract:roster:v1", REGISTRY)
VALIDATE_ERROR = compile_schema("urn:specter-arena:contract:api-error:v1", REGISTRY)

NOW_MS = 1_760_000_000_000
KEYS = [
    DmKey(f"bot-{n}-9d63166ee3a{n}", f"member-bot-{n}-9d63166ee3a{n}-aa1{n}") for n in range(1, 4)
]
FORBIDDEN = ("member-", ".memory-", "chat-61", "/Users/", SECRET)


@pytest.fixture(autouse=True)
def proxy_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KIROCREW_PROXY_SECRET", SECRET)


class Runtime:
    probe_on = False

    def __init__(self, opened: Store | None) -> None:
        self.store = opened


class FakeCollector:
    def __init__(self, status: CollectorStatus) -> None:
        self._status = status

    def status(self) -> CollectorStatus:
        return self._status

    async def stop(self) -> None:
        return None


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


def seed(opened: Store, bots: int = 2) -> None:
    started = start_run(opened, run_id="run-00000001", now_ms=NOW_MS)
    items: list[Any] = [BindingSeen(KEYS[n], NOW_MS) for n in range(bots)]
    batch = IngestBatch("run-00000001", started.installation_id, tuple(items))
    store_api.ingest(opened, batch)
    rows = tuple(
        RosterRowIn(KEYS[n].memory_store, f"bot-{n}", f"Bot {n}", "image", f"bot-{n}.png")
        for n in range(bots)
    )
    follow: list[Any] = [CoverageMark("open-covered", NOW_MS), RosterPoll(True, NOW_MS, rows)]
    for n in range(bots):
        dm_key = store_api.build_dm_key(KEYS[n])
        follow.append(
            ObservationIn(
                installation_id=started.installation_id,
                dm_key=dm_key,
                slot_key=dm_key,
                kind="row-change",
                event_type="slot-row",
                received_at_ms=NOW_MS,
                payload={"running": n == 0, "turn": 1, "turnGen": "a8b8767e"},
                turn=1,
                turn_gen="a8b8767e",
                fact_digest=store_api.row_fact_digest(
                    {"running": n == 0, "turn": 1, "turnGen": "a8b8767e"}
                ),
            )
        )
    store_api.ingest(opened, IngestBatch("run-00000001", started.installation_id, tuple(follow)))


def install(opened: Store | None, collector: Any = None) -> None:
    app.state.store_runtime = Runtime(opened)
    app.state.collector = collector


class NoLifespan:
    """Runs the app without its lifespan, so the installed runtime and collector stay put."""

    def __init__(self) -> None:
        self.client = TestClient(app)

    def get(self, target: str) -> tuple[int, Any]:
        response = self.client.get(target, headers=sign_headers(target))
        return response.status_code, response.json()


def fetch(path: str = "/api/roster", **query: str) -> tuple[int, Any]:
    target = path if not query else path + "?" + "&".join(f"{k}={v}" for k, v in query.items())
    return NoLifespan().get(target)


def test_a_signed_request_returns_a_body_that_validates_against_roster_v1(
    use_app: None, opened: Store
) -> None:
    seed(opened)
    install(opened)
    status, body = fetch()
    assert status == 200
    VALIDATE_ROSTER(body)
    assert [item["displayName"] for item in body["items"]] == ["Bot 0", "Bot 1"]
    assert body["nextCursor"] is None and body["contractVersion"] == PAGE_CONTRACT_VERSION


def test_the_body_round_trips_through_the_wire_readers(use_app: None, opened: Store) -> None:
    from backend.specter_arena.wire import READERS

    seed(opened)
    install(opened)
    _, body = fetch()
    assert READERS["roster"](body) == body


def test_the_body_holds_no_slot_key_member_id_memory_store_or_path(
    use_app: None, opened: Store
) -> None:
    seed(opened)
    install(opened)
    _, body = fetch()
    text = json.dumps(body)
    for needle in (*FORBIDDEN, KEYS[0].member_id, KEYS[0].memory_store):
        assert needle not in text


def test_a_running_covered_bot_reads_working_and_an_idle_one_settled(
    use_app: None, opened: Store
) -> None:
    seed(opened)
    install(opened)
    import time

    # The seeded heartbeat is old, so coverage reads as unknown until a fresh beat arrives.
    store_api.heartbeat(opened, run_id="run-00000001", now_ms=int(time.time() * 1000))
    _, body = fetch()
    states = [item["condition"]["state"] for item in body["items"]]
    assert states == ["working", "settled"]


def test_a_stale_heartbeat_never_reads_working(use_app: None, opened: Store) -> None:
    seed(opened)
    install(opened)
    _, body = fetch()
    assert {item["condition"]["state"] for item in body["items"]} == {"unknown"}
    assert {item["coverage"]["reasonCode"] for item in body["items"]} == {"heartbeat-stale"}


def test_a_missing_collector_reads_as_unavailable_with_the_standing_note(
    use_app: None, opened: Store
) -> None:
    seed(opened)
    install(opened, None)
    _, body = fetch()
    assert body["collector"]["state"] == "unavailable"
    assert body["collector"]["reasonCode"] == "collector-not-started"
    assert body["notes"] == [{"code": "cron-turns-not-observable", "count": None}]


def test_a_running_collector_reports_its_state_and_the_store_less_note(
    use_app: None, opened: Store
) -> None:
    status = CollectorStatus(State.RUNNING, None, NOW_MS, (("unsupported-store-less-bot", 2),))
    install(opened, FakeCollector(status))
    _, body = fetch()
    VALIDATE_ROSTER(body)
    assert body["collector"] == {"state": "running", "reasonCode": None, "sinceMs": NOW_MS}
    assert body["notes"][1] == {"code": "unsupported-store-less-bot", "count": 2}


def test_a_stopped_collector_is_reported_with_its_reason(use_app: None, opened: Store) -> None:
    install(opened, FakeCollector(CollectorStatus(State.STOPPED, "auth-stopped", NOW_MS, ())))
    _, body = fetch()
    assert body["collector"]["state"] == "stopped"
    assert body["collector"]["reasonCode"] == "auth-stopped"


def test_the_limit_pages_the_roster_with_a_cursor_that_walks_every_bot_once(
    use_app: None, opened: Store
) -> None:
    seed(opened, bots=3)
    install(opened)
    seen: list[str] = []
    cursor: str | None = None
    for _ in range(5):
        query = {"limit": "1"} | ({"cursor": cursor} if cursor else {})
        status, body = fetch(**query)
        assert status == 200 and len(body["items"]) == 1
        VALIDATE_ROSTER(body)
        seen.append(body["items"][0]["bindingId"])
        cursor = body["nextCursor"]
        if cursor is None:
            break
    assert len(seen) == 3 == len(set(seen))


@pytest.mark.parametrize("limit", ["0", "-1", "10000"])
def test_a_limit_outside_the_bounds_is_clamped_not_refused(
    use_app: None, opened: Store, limit: str
) -> None:
    seed(opened)
    install(opened)
    status, body = fetch(limit=limit)
    assert status == 200 and 1 <= len(body["items"]) <= 200


@pytest.mark.parametrize("limit", ["abc", "1.5", "", "1e3"])
def test_a_limit_that_is_not_an_integer_is_a_400_invalid_limit(
    use_app: None, opened: Store, limit: str
) -> None:
    install(opened)
    status, body = fetch(limit=limit)
    assert (status, body) == (400, {"contractVersion": 1, "error": "invalid_limit"})
    VALIDATE_ERROR(body)


@pytest.mark.parametrize("cursor", ["!!!", "x", "a" * 600, "%20"])
def test_a_bad_cursor_is_a_400_invalid_cursor(use_app: None, opened: Store, cursor: str) -> None:
    install(opened)
    status, body = fetch(cursor=cursor)
    assert (status, body) == (400, {"contractVersion": 1, "error": "invalid_cursor"})
    VALIDATE_ERROR(body)


def test_an_unsigned_request_is_a_401(use_app: None, opened: Store) -> None:
    install(opened)
    assert TestClient(app).get("/api/roster").status_code == 401


def test_without_a_proxy_secret_the_route_answers_503(
    use_app: None, opened: Store, monkeypatch: pytest.MonkeyPatch
) -> None:
    install(opened)
    monkeypatch.delenv("KIROCREW_PROXY_SECRET")
    response = TestClient(app).get("/api/roster", headers=sign_headers("/api/roster"))
    assert (response.status_code, response.json()["error"]) == (503, "proxy_secret_missing")


def test_no_store_is_a_503_store_not_ready(use_app: None) -> None:
    install(None)
    status, body = fetch()
    assert (status, body) == (503, {"contractVersion": 1, "error": "store_not_ready"})
    VALIDATE_ERROR(body)


def test_the_probe_switch_is_a_503_even_with_a_store(use_app: None, opened: Store) -> None:
    runtime = Runtime(opened)
    runtime.probe_on = True
    app.state.store_runtime = runtime
    status, body = fetch()
    assert (status, body["error"]) == (503, "store_not_ready")


def test_a_closed_store_is_a_503_store_unavailable(use_app: None, tmp_path: Path) -> None:
    closed = open_store(tmp_path / "data")
    closed.close()
    install(closed)
    status, body = fetch()
    assert (status, body) == (503, {"contractVersion": 1, "error": "store_unavailable"})
    VALIDATE_ERROR(body)


def test_the_revision_is_read_before_the_page(
    use_app: None, opened: Store, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[str] = []
    real_revision, real_page = store_api.roster_revision, store_api.roster_page

    def revision(store: Store) -> int:
        calls.append("revision")
        return real_revision(store)

    def page(store: Store, **kwargs: Any) -> Any:
        calls.append("page")
        return real_page(store, **kwargs)

    monkeypatch.setattr(store_api, "roster_revision", revision)
    monkeypatch.setattr(store_api, "roster_page", page)
    install(opened)
    assert fetch()[0] == 200
    assert calls == ["revision", "page"]


def test_only_get_is_routed(use_app: None, opened: Store) -> None:
    install(opened)
    response = TestClient(app).post(
        "/api/roster", headers=sign_headers("/api/roster", method="POST")
    )
    assert response.status_code == 405


def test_an_empty_store_returns_an_empty_valid_page(use_app: None, opened: Store) -> None:
    install(opened)
    status, body = fetch()
    assert status == 200 and body["items"] == []
    VALIDATE_ROSTER(body)
    assert body["rosterRevision"] == 0
