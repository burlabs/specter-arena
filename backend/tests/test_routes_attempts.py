import json
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from starlette.testclient import TestClient

from backend.app import app
from backend.specter_arena import store as store_api
from backend.specter_arena.store import (
    BindingSeen,
    CoverageMark,
    DmKey,
    IngestBatch,
    ObservationIn,
    Store,
    open_store,
    start_run,
)
from backend.tests.contract_support import compile_schema, load_registry
from backend.tests.test_routes_ping import SECRET, sign_headers

REGISTRY = load_registry()
VALIDATE_ATTEMPTS = compile_schema("urn:specter-arena:contract:attempts:v1", REGISTRY)
VALIDATE_ATTEMPT_ITEM = compile_schema("urn:specter-arena:contract:attempt-item:v1", REGISTRY)
VALIDATE_ROSTER = compile_schema("urn:specter-arena:contract:roster:v1", REGISTRY)
VALIDATE_ERROR = compile_schema("urn:specter-arena:contract:api-error:v1", REGISTRY)

RUN = "run-00000001"
KEY = DmKey("bot-1-9d63166ee3a1", "member-bot-1-9d63166ee3a1-aa11")
DM = store_api.build_dm_key(KEY)
HOUR = 3_600_000
FORBIDDEN = ("member-", ".memory-", "chat-61", "/Users/", SECRET)
BAD_BINDING_IDS = ["a" * 65, "a.b", "%20", "%0a"]


@pytest.fixture(autouse=True)
def proxy_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KIROCREW_PROXY_SECRET", SECRET)


class Runtime:
    probe_on = False

    def __init__(self, opened: Store | None) -> None:
        self.store = opened


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


def install(opened: Store | None) -> None:
    app.state.store_runtime = Runtime(opened)
    app.state.collector = None


def now_ms() -> int:
    return int(time.time() * 1000)


class Seeder:
    """Writes through the real store API, in the minutes before the request, on the wall clock."""

    def __init__(self, opened: Store, base_ms: int) -> None:
        self.opened = opened
        self.base = base_ms
        started = start_run(opened, run_id=RUN, now_ms=base_ms)
        self.installation = started.installation_id
        self.ingest(BindingSeen(KEY, base_ms), CoverageMark("open-covered", base_ms))

    def ingest(self, *items: Any) -> None:
        store_api.ingest(self.opened, IngestBatch(RUN, self.installation, items))

    def row(self, ms: int, slot: str | None = None, **facts: Any) -> ObservationIn:
        payload: dict[str, Any] = {"running": True, **facts}
        return ObservationIn(
            installation_id=self.installation,
            dm_key=DM,
            slot_key=slot or DM,
            kind="row-change",
            event_type="slot-row",
            received_at_ms=ms,
            payload=payload,
            turn=payload.get("turn"),
            turn_gen=payload.get("turnGen"),
            fact_digest=store_api.row_fact_digest(payload),
        )

    def worker(self, ms: int, slot: str, created: int, **facts: Any) -> ObservationIn:
        return self.row(ms, slot=slot, createdBy=DM, createdMs=created, **facts)

    def chat_done(self, ms: int, turn: int, gen: str = "ab12") -> ObservationIn:
        return ObservationIn(
            installation_id=self.installation,
            dm_key=DM,
            slot_key=DM,
            kind="event",
            event_type="chat_done",
            received_at_ms=ms,
            payload={},
            turn=turn,
            turn_gen=gen,
            dedup_key=f"chat_done:{gen}:{turn}",
        )

    def beat(self) -> None:
        store_api.heartbeat(self.opened, run_id=RUN, now_ms=now_ms())


def seeded(opened: Store) -> Seeder:
    return Seeder(opened, now_ms() - 3 * HOUR)


def two_workers(seed: Seeder) -> None:
    """One worker seen again after the feed reopened (working), one not (unknown, feed-absent)."""
    base = seed.base
    seed.ingest(
        seed.worker(base + 1_000, "chat-old", 1),
        seed.worker(base + 1_001, "chat-new", 2),
        CoverageMark("close", base + 2_000, "disconnect"),
    )
    seed.ingest(
        CoverageMark("open-covered", base + 3_000), seed.worker(base + 3_001, "chat-new", 2)
    )
    seed.beat()


def binding(opened: Store) -> str:
    with opened.read() as conn:
        return str(conn.execute("SELECT binding_id FROM bot_binding").fetchone()[0])


def fetch(target: str) -> tuple[int, Any]:
    client = TestClient(app)
    response = client.get(target, headers=sign_headers(target))
    try:
        return response.status_code, response.json()
    except ValueError:
        return response.status_code, response.text


def attempts_path(opened: Store, **query: str) -> str:
    base = f"/api/roster/{binding(opened)}/attempts"
    return base if not query else base + "?" + "&".join(f"{k}={v}" for k, v in query.items())


def assert_window(window: dict[str, int], as_of: int) -> None:
    assert window["toMs"] == as_of
    assert window["toMs"] - window["fromMs"] == window["windowMs"]
    assert window["fromMs"] <= window["observedFromMs"] <= window["toMs"]
    assert 0 <= window["coveredMs"] <= window["toMs"] - window["observedFromMs"]
    assert window["sampleSize"] == window["botTurnsStarted"] + window["workersStarted"]
    assert window["sampleSize"] == window["ended"] + window["stillOpen"] + window["unknown"]


def test_a_signed_request_returns_a_body_that_validates_against_attempts_v1(
    use_app: None, opened: Store
) -> None:
    seed = seeded(opened)
    seed.ingest(seed.row(seed.base + 500, turn=1, turnGen="ab12"))
    two_workers(seed)
    install(opened)
    status, body = fetch(attempts_path(opened))
    assert status == 200
    VALIDATE_ATTEMPTS(body)
    for item in body["items"]:
        VALIDATE_ATTEMPT_ITEM(item)
    assert body["bindingId"] == binding(opened)
    assert [item["kind"] for item in body["items"]] == ["worker", "worker", "bot-turn"]
    for key in ("last24h", "last7d"):
        assert_window(body["activity"][key], body["asOfMs"])


def test_two_concurrent_workers_show_working_and_unknown_separately(
    use_app: None, opened: Store
) -> None:
    seed = seeded(opened)
    two_workers(seed)
    install(opened)
    _, body = fetch(attempts_path(opened))
    conditions = sorted(
        (item["condition"]["state"], item["condition"]["reasonCode"]) for item in body["items"]
    )
    assert conditions == [("unknown", "feed-absent"), ("working", "running")]
    day = body["activity"]["last24h"]
    assert (day["workersStarted"], day["stillOpen"], day["unknown"], day["ended"]) == (2, 1, 1, 0)


def test_an_ended_bot_turn_carries_its_end_signal_in_wire_form(
    use_app: None, opened: Store
) -> None:
    seed = seeded(opened)
    base = seed.base
    seed.ingest(seed.row(base + 100, turn=1, turnGen="ab12"), seed.row(base + 200, running=False))
    seed.ingest(seed.row(base + 300, turn=2, turnGen="cd34"), seed.chat_done(base + 400, 2, "cd34"))
    seed.beat()
    install(opened)
    _, body = fetch(attempts_path(opened))
    VALIDATE_ATTEMPTS(body)
    ended = [
        (item["endSignal"], item["condition"]["reasonCode"], item["endedMs"] is not None)
        for item in body["items"]
    ]
    assert sorted(ended) == [
        ("chat-done", "ended-chat-done", True),
        ("row-idle", "ended-row-idle", True),
    ]


def test_a_stale_heartbeat_reads_every_open_attempt_unknown(use_app: None, opened: Store) -> None:
    seed = seeded(opened)
    seed.ingest(seed.worker(seed.base + 10, "chat-1", 1))
    install(opened)
    _, body = fetch(attempts_path(opened))
    (item,) = body["items"]
    assert item["condition"] == {"state": "unknown", "reasonCode": "heartbeat-stale"}
    day = body["activity"]["last24h"]
    assert (day["stillOpen"], day["unknown"]) == (0, 1)


def test_observed_from_is_the_first_seen_time_inside_the_window(
    use_app: None, opened: Store
) -> None:
    seed = seeded(opened)
    seed.beat()
    install(opened)
    _, body = fetch(attempts_path(opened))
    day = body["activity"]["last24h"]
    assert day["observedFromMs"] == max(day["fromMs"], seed.base)
    assert day["observedFromMs"] == seed.base
    assert day["coveredMs"] > 0


def test_a_bot_with_no_collected_time_reads_zero_covered(use_app: None, opened: Store) -> None:
    started = start_run(opened, run_id=RUN, now_ms=now_ms() - HOUR)
    store_api.ingest(
        opened, IngestBatch(RUN, started.installation_id, (BindingSeen(KEY, now_ms()),))
    )
    install(opened)
    status, body = fetch(attempts_path(opened))
    assert status == 200
    VALIDATE_ATTEMPTS(body)
    assert body["items"] == [] and body["nextCursor"] is None
    for key in ("last24h", "last7d"):
        window = body["activity"][key]
        assert (window["coveredMs"], window["gapCount"], window["sampleSize"]) == (0, 0, 0)


def test_a_reconnect_replay_leaves_every_count_unchanged(use_app: None, opened: Store) -> None:
    seed = seeded(opened)
    base = seed.base
    batch = (
        seed.row(base + 100, turn=1, turnGen="ab12"),
        seed.worker(base + 200, "chat-1", 1),
        seed.chat_done(base + 300, 1),
    )
    seed.ingest(*batch)
    seed.beat()
    install(opened)
    _, before = fetch(attempts_path(opened))
    seed.ingest(*batch)
    seed.beat()
    _, after = fetch(attempts_path(opened))
    assert after["items"] == before["items"]
    for key in ("last24h", "last7d"):
        for field in ("botTurnsStarted", "workersStarted", "sampleSize", "ended", "stillOpen"):
            assert after["activity"][key][field] == before["activity"][key][field]


def test_limit_one_pages_every_attempt_once_in_order_and_ends_with_a_null_cursor(
    use_app: None, opened: Store
) -> None:
    seed = seeded(opened)
    base = seed.base
    seed.ingest(*(seed.worker(base + 10 + i // 2, f"chat-{i}", i) for i in range(5)))
    seed.beat()
    install(opened)
    seen: list[tuple[int, str]] = []
    cursor: str | None = None
    for _ in range(10):
        query = {"limit": "1"} | ({"cursor": cursor} if cursor else {})
        status, body = fetch(attempts_path(opened, **query))
        assert status == 200 and len(body["items"]) == 1
        seen.append((body["items"][0]["startedMs"], body["items"][0]["attemptId"]))
        cursor = body["nextCursor"]
        if cursor is None:
            break
    assert len(seen) == 5 == len(set(seen))
    assert seen == sorted(seen, reverse=True)


def test_exactly_fifty_attempts_end_without_a_trailing_page(use_app: None, opened: Store) -> None:
    seed = seeded(opened)
    seed.ingest(*(seed.worker(seed.base + 10 + i, f"chat-{i}", i) for i in range(50)))
    seed.beat()
    install(opened)
    _, body = fetch(attempts_path(opened))
    assert len(body["items"]) == 50 and body["nextCursor"] is None


@pytest.mark.parametrize("limit", ["0", "-1", "10000"])
def test_a_limit_outside_the_bounds_is_clamped_not_refused(
    use_app: None, opened: Store, limit: str
) -> None:
    seed = seeded(opened)
    seed.ingest(*(seed.worker(seed.base + 10 + i, f"chat-{i}", i) for i in range(3)))
    install(opened)
    status, body = fetch(attempts_path(opened, limit=limit))
    assert status == 200 and 1 <= len(body["items"]) <= 50


@pytest.mark.parametrize("limit", ["abc", "1.5", "", "1e3"])
def test_a_limit_that_is_not_an_integer_is_a_400_invalid_limit(
    use_app: None, opened: Store, limit: str
) -> None:
    seeded(opened)
    install(opened)
    status, body = fetch(attempts_path(opened, limit=limit))
    assert (status, body) == (400, {"contractVersion": 1, "error": "invalid_limit"})
    VALIDATE_ERROR(body)


@pytest.mark.parametrize("cursor", ["!!!", "x", "a" * 600, "%20"])
def test_a_bad_cursor_is_a_400_invalid_cursor(use_app: None, opened: Store, cursor: str) -> None:
    seeded(opened)
    install(opened)
    status, body = fetch(attempts_path(opened, cursor=cursor))
    assert (status, body) == (400, {"contractVersion": 1, "error": "invalid_cursor"})
    VALIDATE_ERROR(body)


def test_an_unknown_id_with_a_valid_shape_is_a_404_unknown_binding(
    use_app: None, opened: Store
) -> None:
    seeded(opened)
    install(opened)
    status, body = fetch("/api/roster/bnd_unknown/attempts")
    assert (status, body) == (404, {"contractVersion": 1, "error": "unknown_binding"})
    VALIDATE_ERROR(body)


@pytest.mark.parametrize("bad_id", BAD_BINDING_IDS)
def test_a_malformed_id_that_reaches_the_handler_is_the_same_404(
    use_app: None, opened: Store, bad_id: str
) -> None:
    seeded(opened)
    install(opened)
    status, body = fetch(f"/api/roster/{bad_id}/attempts")
    assert (status, body) == (404, {"contractVersion": 1, "error": "unknown_binding"})


@pytest.mark.parametrize("bad_id", ["..", "%2f", "a%2fb", "%2e%2e"])
def test_a_crafted_id_that_never_reaches_the_handler_is_a_404_not_a_500(
    use_app: None, opened: Store, bad_id: str
) -> None:
    seeded(opened)
    install(opened)
    status, _ = fetch(f"/api/roster/{bad_id}/attempts")
    assert status == 404


def test_a_bad_limit_on_an_unknown_id_is_still_a_404(use_app: None, opened: Store) -> None:
    install(opened)
    status, body = fetch("/api/roster/a.b/attempts?limit=abc")
    assert (status, body["error"]) == (404, "unknown_binding")


def test_an_unsigned_request_is_a_401(use_app: None, opened: Store) -> None:
    seeded(opened)
    install(opened)
    assert TestClient(app).get(attempts_path(opened)).status_code == 401


def test_without_a_proxy_secret_the_route_answers_503(
    use_app: None, opened: Store, monkeypatch: pytest.MonkeyPatch
) -> None:
    seeded(opened)
    install(opened)
    target = attempts_path(opened)
    monkeypatch.delenv("KIROCREW_PROXY_SECRET")
    response = TestClient(app).get(target, headers=sign_headers(target))
    assert (response.status_code, response.json()["error"]) == (503, "proxy_secret_missing")


def test_no_store_is_a_503_store_not_ready(use_app: None) -> None:
    install(None)
    status, body = fetch("/api/roster/bnd_x/attempts")
    assert (status, body) == (503, {"contractVersion": 1, "error": "store_not_ready"})
    VALIDATE_ERROR(body)


def test_the_probe_switch_is_a_503_even_with_a_store(use_app: None, opened: Store) -> None:
    runtime = Runtime(opened)
    runtime.probe_on = True
    app.state.store_runtime = runtime
    status, body = fetch("/api/roster/bnd_x/attempts")
    assert (status, body["error"]) == (503, "store_not_ready")


def test_a_closed_store_is_a_503_store_unavailable(use_app: None, tmp_path: Path) -> None:
    closed = open_store(tmp_path / "data")
    closed.close()
    install(closed)
    status, body = fetch("/api/roster/bnd_x/attempts")
    assert (status, body) == (503, {"contractVersion": 1, "error": "store_unavailable"})
    VALIDATE_ERROR(body)


def test_only_get_is_routed(use_app: None, opened: Store) -> None:
    install(opened)
    target = "/api/roster/bnd_x/attempts"
    response = TestClient(app).post(target, headers=sign_headers(target, method="POST"))
    assert response.status_code == 405


def test_the_body_holds_no_slot_key_member_id_memory_store_or_path(
    use_app: None, opened: Store
) -> None:
    seed = seeded(opened)
    seed.ingest(seed.row(seed.base + 5, turn=1, turnGen="ab12"))
    two_workers(seed)
    install(opened)
    _, body = fetch(attempts_path(opened))
    text = json.dumps(body)
    for needle in (*FORBIDDEN, KEY.member_id, KEY.memory_store, "chat-old", "chat-new"):
        assert needle not in text


def test_the_roster_counts_equal_the_worker_attempt_counts_on_the_wire(
    use_app: None, opened: Store
) -> None:
    seed = seeded(opened)
    two_workers(seed)
    install(opened)
    _, attempts = fetch(attempts_path(opened))
    _, roster = fetch("/api/roster")
    VALIDATE_ROSTER(roster)
    (item,) = roster["items"]
    workers = [i for i in attempts["items"] if i["kind"] == "worker"]
    states = [i["condition"]["state"] for i in workers]
    assert item["workers"]["running"] == states.count("working") == 1
    assert item["workers"]["unknown"] == states.count("unknown") == 1
    assert item["workers"]["seen"] == len(workers)
    assert item["workers"]["running"] + item["workers"]["unknown"] == len(workers)


def test_the_revision_comes_from_the_same_read_as_the_page(
    use_app: None, opened: Store, monkeypatch: pytest.MonkeyPatch
) -> None:
    seed = seeded(opened)
    seed.beat()
    install(opened)

    def broken(_store: Store) -> int:
        raise AssertionError("the attempts route must not read the revision separately")

    monkeypatch.setattr(store_api, "roster_revision", broken)
    status, body = fetch(attempts_path(opened))
    assert status == 200
    assert (
        body["rosterRevision"]
        == store_api.attempts_page(
            opened, binding(opened), cursor=None, limit=1, as_of_ms=body["asOfMs"]
        ).revision
    )
