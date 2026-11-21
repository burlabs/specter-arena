"""FP-19 crew-integration: the signed data lifecycle routes and `POST /api/collector` over the real
store, the real work and Specter services and the real collector (scripted gateway only).

Names `data-lifecycle:v1`, `collector-control:v1`, `roster:v1` and `api-error:v1` so the
schema-producer check sees real producers. Test-time only."""

from __future__ import annotations

import base64
import sqlite3
from collections.abc import Iterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from backend.specter_arena.collector.supervisor import SqliteStorePort
from backend.specter_arena.data_routes import data_routes
from backend.specter_arena.lifecycle.service import DataService
from backend.specter_arena.routes import roster
from backend.specter_arena.specter_routes import specter_routes
from backend.specter_arena.specters.service import SpecterService
from backend.specter_arena.store import Store, get_work, insert_asset, set_avatar
from backend.specter_arena.work.service import WorkService
from backend.specter_arena.work_routes import work_routes

from .collector_fakes import FakeClock as CollectorClock
from .collector_scenarios import build, slots
from .contract_support import compile_schema, load_registry
from .lifecycle_fakes import CUT, NEW, NOW_FOR_30_DAYS, OLD, Lifecycle
from .lifecycle_fakes import build as build_store
from .png_support import png
from .specter_fakes import FakeClock
from .work_api_fakes import SIGNING_VALUE, Api
from .work_fakes import decide, query, submit_and_accept

REGISTRY = load_registry()
DATA_V1 = compile_schema("urn:specter-arena:contract:data-lifecycle:v1", REGISTRY)
CONTROL_V1 = compile_schema("urn:specter-arena:contract:collector-control:v1", REGISTRY)
ROSTER_V1 = compile_schema("urn:specter-arena:contract:roster:v1", REGISTRY)
ERROR_V1 = compile_schema("urn:specter-arena:contract:api-error:v1", REGISTRY)


@pytest.fixture(autouse=True)
def gateway_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KIROCREW_PROXY_SECRET", SIGNING_VALUE)


@dataclass
class Rig:
    seeded: Lifecycle
    store: Store
    api: Api
    client: TestClient
    clock: FakeClock
    app: Starlette
    collector: Any


def wait_until_covered(store: Store) -> None:
    import time

    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if query(store, "SELECT 1 FROM coverage_interval WHERE state = 'covered'"):
            return
        time.sleep(0.01)
    raise AssertionError("the scripted collector never opened coverage")


@pytest.fixture
def rig(tmp_path: Path) -> Iterator[Rig]:
    seeded = build_store(tmp_path)
    store = seeded.store
    clock = FakeClock(NOW_FOR_30_DAYS)
    harness = build(
        store=SqliteStorePort(store),
        run_id="run-collector-1",
        feeds=[[slots()]],
        holding=True,
        clock=CollectorClock(NOW_FOR_30_DAYS),
    )

    @asynccontextmanager
    async def lifespan(app: Starlette) -> Any:
        await harness.collector.start()
        app.state.collector = harness.collector
        yield
        await harness.collector.stop()

    app = Starlette(
        routes=[
            *data_routes(),
            *work_routes(),
            *specter_routes(),
            Route("/api/roster", roster, methods=["GET"]),
        ],
        lifespan=lifespan,
    )
    app.state.lifecycle = DataService(store, clock=clock)
    app.state.work = WorkService(store, clock=clock)
    app.state.specters = SpecterService(store, clock=clock)
    app.state.store_runtime = SimpleNamespace(probe_on=False, store=store)
    app.state.collector = None
    try:
        with TestClient(app) as client:
            wait_until_covered(store)
            yield Rig(seeded, store, Api(client), client, clock, app, harness.collector)
    finally:
        store.close()


def ok(response: Any, schema: Any = DATA_V1) -> dict[str, Any]:
    assert response.status_code == 200, response.text
    body = response.json()
    schema(body)
    return body  # type: ignore[no-any-return]


def error(response: Any, status: int, code: str) -> None:
    assert (response.status_code, response.json()["error"]) == (status, code), response.text
    ERROR_V1(response.json())


def counts(store: Store) -> dict[str, int]:
    names = ("observation", "quarantine", "attempt", "asset", "work_item", "xp_entry")
    return {n: int(query(store, f"SELECT count(*) FROM {n}")[0][0]) for n in names}


# ---- status and retention (FP19-CI-01) --------------------------------------------------------


def test_the_default_status_keeps_everything_and_previews_nothing(rig: Rig) -> None:
    body = ok(rig.api.get("/api/data"))
    assert body["retention"] == {"retentionDays": None, "changedAtMs": None, "revision": 0}
    assert (body["preview"], body["horizonMs"], body["running"]) == (None, None, None)
    assert (body["lastPurge"], body["lastCleanup"], body["lastExport"]) == (None, None, None)
    assert body["uploads"] == {"stored": 0, "cap": 100, "unused": 0}
    assert (body["exports"], body["paused"], body["asOfMs"]) == ([], False, NOW_FOR_30_DAYS)


def test_saving_a_retention_window_previews_the_purge_and_deletes_nothing(rig: Rig) -> None:
    before = counts(rig.store)
    body = ok(rig.api.call("POST", "/api/data/retention", {"retentionDays": 30}))
    assert body["retention"] == {
        "retentionDays": 30,
        "changedAtMs": NOW_FOR_30_DAYS,
        "revision": 1,
    }
    assert body["preview"]["cutoffMs"] == CUT
    assert body["preview"]["observations"] > 0 and body["preview"]["attempts"] == 3
    assert counts(rig.store) == before
    again = ok(rig.api.call("POST", "/api/data/retention", {"retentionDays": 30}))
    assert again["retention"] == body["retention"]  # idempotent
    cleared = ok(rig.api.call("POST", "/api/data/retention", {"retentionDays": None}))
    assert cleared["retention"]["retentionDays"] is None and cleared["preview"] is None


@pytest.mark.parametrize(
    "body",
    [
        {"retentionDays": 45},
        {"retentionDays": 0},
        {"retentionDays": True},
        {"retentionDays": "30"},
        {"retentionDays": 30.5},
        {},
        {"retentionDays": 30, "extra": 1},
        [],
        None,
        "30",
    ],
)
def test_a_bad_retention_body_is_refused(rig: Rig, body: Any) -> None:
    error(rig.api.call("POST", "/api/data/retention", body), 400, "invalid_body")
    assert ok(rig.api.get("/api/data"))["retention"]["retentionDays"] is None


def test_a_body_that_is_not_json_or_repeats_a_key_is_refused(rig: Rig) -> None:
    from .work_api_fakes import signed

    for raw in (b"{", b'{"retentionDays": 30, "retentionDays": 90}', b'{"retentionDays": NaN}'):
        response = rig.client.post(
            "/api/data/retention",
            content=raw,
            headers=signed("POST", "/api/data/retention", raw),
        )
        error(response, 400, "invalid_body")


# ---- purge (FP19-WL-03, FP19-WL-04, FP19-WL-07) -----------------------------------------------


READS = (
    "/api/work?view=list&order=updated",
    "/api/work?view=list&order=created",
    "/api/work",
    "/api/xp",
    "/api/xp?view=paged",
)


def snapshot(rig: Rig) -> dict[str, str]:
    found: dict[str, str] = {}
    for target in READS:
        response = rig.api.get(target)
        assert response.status_code == 200, (target, response.text)
        found[target] = response.text
    for binding in rig.seeded.bindings:
        target = f"/api/roster/{binding}/xp"
        response = rig.api.get(target)
        assert response.status_code == 200, (target, response.text)
        found[target] = response.text
    return found


def test_a_purge_leaves_every_work_and_xp_read_byte_for_byte_the_same(rig: Rig) -> None:
    ok(rig.api.call("POST", "/api/data/retention", {"retentionDays": 30}))
    before = snapshot(rig)
    assert '"everAccepted":true' in before["/api/work?view=list&order=updated"].replace(" ", "")
    body = ok(rig.api.call("POST", "/api/data/purge", {"retentionDays": 30}))
    assert snapshot(rig) == before
    last = body["lastPurge"]
    assert (last["kind"], last["state"], last["cutoffMs"]) == ("purge", "completed", CUT)
    assert last["deleted"]["attempts"] == 3 and last["deleted"]["quarantine"] == 3
    assert last["deleted"]["observations"] > 0 and last["deleted"]["assets"] == 0
    assert body["horizonMs"] == CUT and body["running"] is None
    assert body["preview"] == {"cutoffMs": CUT, "observations": 0, "quarantine": 0, "attempts": 0}
    assert ok(rig.api.get("/api/data")) == body


def test_linked_attempts_survive_and_the_inspector_reopen_and_re_accept_still_work(
    rig: Rig,
) -> None:
    ok(rig.api.call("POST", "/api/data/retention", {"retentionDays": 30}))
    ok(rig.api.call("POST", "/api/data/purge", {"retentionDays": 30}))
    store = rig.store
    accepted = get_work(store, rig.seeded.accepted.work_id)
    assert [a.present for a in accepted.attempts] == [True]
    assert accepted.evidence_revision == rig.seeded.accepted.evidence_revision
    opened = get_work(store, rig.seeded.open_item.work_id)
    assert [a.present for a in opened.attempts] == [True]
    reopened = decide(store, accepted, "reopen", 31, at=NEW + 10)
    assert reopened.state == "reopened"
    again = submit_and_accept(store, reopened, 32, at=NEW + 20)
    assert again.state == "accepted"
    detail = rig.api.get(f"/api/work/{accepted.work_id}")
    assert detail.status_code == 200 and detail.json()["attempts"][0]["present"] is True


def test_a_purge_needs_a_saved_window_that_matches_the_request(rig: Rig) -> None:
    before = counts(rig.store)
    error(rig.api.call("POST", "/api/data/purge", {"retentionDays": 30}), 409, "retention_not_set")
    ok(rig.api.call("POST", "/api/data/retention", {"retentionDays": 90}))
    error(rig.api.call("POST", "/api/data/purge", {"retentionDays": 30}), 409, "retention_mismatch")
    for body in ({"retentionDays": None}, {}, {"retentionDays": 45}, {"retentionDays": 90, "x": 1}):
        error(rig.api.call("POST", "/api/data/purge", body), 400, "invalid_body")
    assert counts(rig.store) == before
    assert not list(rig.store.backups_dir.glob("pre-purge-*"))


def test_a_failed_pre_purge_backup_deletes_nothing_and_opens_no_run(
    rig: Rig, monkeypatch: pytest.MonkeyPatch
) -> None:
    import importlib

    from backend.specter_arena.store.errors import BackupError

    ok(rig.api.call("POST", "/api/data/retention", {"retentionDays": 30}))
    before = counts(rig.store)

    def broken(source: Path, dest: Path, name: str) -> Path:
        raise BackupError("backup failed")

    backup_module = importlib.import_module("backend.specter_arena.store.backup")
    with monkeypatch.context() as patched:
        patched.setattr(backup_module, "copy_database", broken)
        error(rig.api.call("POST", "/api/data/purge", {"retentionDays": 30}), 500, "backup_failed")
    assert counts(rig.store) == before
    assert query(rig.store, "SELECT count(*) FROM lifecycle_run") == [(0,)]
    assert ok(rig.api.call("POST", "/api/data/purge", {"retentionDays": 30}))["lastPurge"]


def test_the_purge_writes_the_pre_purge_backup_first_and_keeps_only_the_newest(rig: Rig) -> None:
    ok(rig.api.call("POST", "/api/data/retention", {"retentionDays": 30}))
    ok(rig.api.call("POST", "/api/data/purge", {"retentionDays": 30}))
    ok(rig.api.call("POST", "/api/data/purge", {"retentionDays": 30}))
    backups = sorted(rig.store.backups_dir.glob("pre-purge-*.db"))
    assert len(backups) == 1
    copy = sqlite3.connect(backups[0])
    try:
        # The second purge's backup, taken after the first purge: only the new row is left.
        assert copy.execute("SELECT count(*) FROM quarantine").fetchone()[0] == 1
    finally:
        copy.close()


def test_a_second_action_while_one_runs_answers_409_busy(rig: Rig) -> None:
    ok(rig.api.call("POST", "/api/data/retention", {"retentionDays": 30}))
    service: DataService = rig.app.state.lifecycle
    assert service._exclusive.acquire(blocking=False)
    try:
        for method, target, body in (
            ("POST", "/api/data/retention", {"retentionDays": 90}),
            ("POST", "/api/data/purge", {"retentionDays": 30}),
            ("POST", "/api/data/export", {}),
            ("POST", "/api/data/asset-cleanup", {}),
        ):
            error(rig.api.call(method, target, body), 409, "lifecycle_busy")
        assert ok(rig.api.get("/api/data"))["retention"]["retentionDays"] == 30  # reads still work
    finally:
        service._exclusive.release()


def test_an_open_run_from_another_process_answers_409_before_any_backup(rig: Rig) -> None:
    from backend.specter_arena.store import lifecycle as lc

    ok(rig.api.call("POST", "/api/data/retention", {"retentionDays": 30}))
    lc.begin_run(rig.store, "purge", CUT, 1)
    error(rig.api.call("POST", "/api/data/purge", {"retentionDays": 30}), 409, "lifecycle_busy")
    error(rig.api.call("POST", "/api/data/asset-cleanup", {}), 409, "lifecycle_busy")
    assert not list(rig.store.backups_dir.glob("pre-*"))
    assert ok(rig.api.get("/api/data"))["running"]["state"] == "running"


# ---- export (FP19-WL-09) ----------------------------------------------------------------------


def test_an_export_route_writes_one_file_and_lists_it(rig: Rig) -> None:
    body = ok(rig.api.call("POST", "/api/data/export", {}))
    item = body["lastExport"]
    assert body["exports"] == [item]
    assert (rig.store.data_dir / "exports" / item["fileName"]).is_file()
    assert "/" not in item["fileName"] and "\\" not in item["fileName"]
    assert ok(rig.api.get("/api/data"))["lastExport"] == item
    second = ok(rig.api.call("POST", "/api/data/export", {}))
    assert len(second["exports"]) == 2 and second["lastExport"] != item
    bad_bodies: list[Any] = [{"x": 1}, [], None, "x"]
    for bad in bad_bodies:
        error(rig.api.call("POST", "/api/data/export", bad), 400, "invalid_body")


def test_a_failed_export_answers_500_and_leaves_the_store_alone(
    rig: Rig, monkeypatch: pytest.MonkeyPatch
) -> None:
    import importlib

    from backend.specter_arena.store.errors import BackupError

    def broken(source: Path, dest: Path, name: str) -> Path:
        raise BackupError("backup failed")

    monkeypatch.setattr(
        importlib.import_module("backend.specter_arena.store.backup"), "copy_database", broken
    )
    before = counts(rig.store)
    error(rig.api.call("POST", "/api/data/export", {}), 500, "export_failed")
    assert counts(rig.store) == before


# ---- upload cap and cleanup (FP19-REQ-01, FP19-REQ-02) ----------------------------------------


def upload(rig: Rig, side: int, label: str = "up") -> Any:
    body = {
        "mediaType": "image/png",
        "dataBase64": base64.b64encode(png(side, side)).decode(),
        "label": label,
    }
    return rig.api.post("/api/assets", body)


def test_the_hundred_and_first_new_upload_is_refused_and_a_repeat_is_not(rig: Rig) -> None:
    for n in range(100):
        insert_asset(
            rig.store,
            data=png(1 + n % 40, 1 + n // 40),
            width=1 + n % 40,
            height=1 + n // 40,
            origin="uploaded",
            label=f"u{n}",
            now_ms=OLD + n,
        )
    error(upload(rig, 61), 409, "upload_limit_reached")
    assert upload(rig, 1).status_code == 201  # the first image again: not new, not counted
    assert ok(rig.api.get("/api/data"))["uploads"] == {"stored": 100, "cap": 100, "unused": 100}
    cleaned = ok(rig.api.call("POST", "/api/data/asset-cleanup", {}))
    assert cleaned["lastCleanup"]["deleted"]["assets"] == 100
    assert cleaned["uploads"] == {"stored": 0, "cap": 100, "unused": 0}
    assert upload(rig, 61).status_code == 201  # room again


def test_cleanup_keeps_bundled_referenced_and_young_assets_and_backs_up_first(rig: Rig) -> None:
    store = rig.store
    bundled = insert_asset(
        store, data=png(2, 2), width=2, height=2, origin="bundled", label="b", now_ms=OLD
    )
    used = insert_asset(
        store, data=png(3, 3), width=3, height=3, origin="uploaded", label="u", now_ms=OLD
    )
    spare = insert_asset(
        store, data=png(4, 4), width=4, height=4, origin="uploaded", label="s", now_ms=OLD
    )
    young = insert_asset(
        store,
        data=png(5, 5),
        width=5,
        height=5,
        origin="uploaded",
        label="y",
        now_ms=NOW_FOR_30_DAYS - 60_000,
    )
    set_avatar(store, rig.seeded.bindings[0], 0, used.record.asset_id, OLD + 1)
    body = ok(rig.api.call("POST", "/api/data/asset-cleanup", {}))
    assert body["lastCleanup"]["deleted"] == {
        "observations": 0,
        "quarantine": 0,
        "attempts": 0,
        "assets": 1,
    }
    left = {r[0] for r in query(store, "SELECT asset_id FROM asset")}
    assert left == {bundled.record.asset_id, used.record.asset_id, young.record.asset_id}
    assert spare.record.asset_id not in left
    assert len(list(store.backups_dir.glob("pre-cleanup-*.db"))) == 1
    assert body["lastPurge"] is None and body["horizonMs"] is None  # a cleanup is not a purge


# ---- authentication and readiness (FP19-CI-03) ------------------------------------------------

ROUTES: tuple[tuple[str, str, Any], ...] = (
    ("GET", "/api/data", None),
    ("POST", "/api/data/retention", {"retentionDays": 30}),
    ("POST", "/api/data/purge", {"retentionDays": 30}),
    ("POST", "/api/data/export", {}),
    ("POST", "/api/data/asset-cleanup", {}),
    ("POST", "/api/collector", {"paused": True}),
)


@pytest.mark.parametrize(("method", "target", "body"), ROUTES)
def test_every_data_route_refuses_an_unsigned_request_and_changes_nothing(
    rig: Rig, method: str, target: str, body: Any
) -> None:
    before = counts(rig.store)
    response = rig.api.call(method, target, body, sign=False)
    error(response, 401, "unauthorized")
    assert counts(rig.store) == before
    assert query(
        rig.store, "SELECT paused, retention_days FROM collector_setting, retention_setting"
    ) == [(0, None)]


@pytest.mark.parametrize(("method", "target", "body"), ROUTES)
def test_every_data_route_answers_503_while_the_service_is_not_ready(
    rig: Rig, method: str, target: str, body: Any
) -> None:
    rig.app.state.lifecycle = None
    error(rig.api.call(method, target, body), 503, "store_not_ready")


def test_the_data_routes_take_only_their_own_method(rig: Rig) -> None:
    assert rig.client.get("/api/data/purge").status_code == 405
    assert rig.client.post("/api/data").status_code == 405
    assert rig.client.get("/api/collector").status_code == 405


def test_an_oversized_body_is_refused_before_it_is_read(rig: Rig) -> None:
    response = rig.client.post("/api/data/purge", content=b"x" * (1_572_864 + 1))
    assert response.status_code == 413 and response.json()["error"] == "body_too_large"


# ---- pause and resume (FP19-CI-02) ------------------------------------------------------------


def gaps(store: Store) -> list[tuple[Any, ...]]:
    return query(
        store,
        "SELECT i.reason, i.end_ms IS NULL FROM coverage_interval i JOIN collector_run r"
        " ON r.run_id = i.run_id WHERE r.run_id = 'run-collector-1' AND i.state = 'gap'"
        " ORDER BY i.interval_id",
    )


def test_pause_is_signed_idempotent_and_records_a_paused_gap(rig: Rig) -> None:
    first = ok(rig.api.post("/api/collector", {"paused": True}), CONTROL_V1)
    assert first["paused"] is True and first["state"] == "paused" and first["revision"] >= 1
    assert gaps(rig.store)[-1] == ("paused", 1)  # an open gap with reason paused
    assert query(rig.store, "SELECT paused FROM collector_setting") == [(1,)]
    again = ok(rig.api.post("/api/collector", {"paused": True}), CONTROL_V1)
    assert again == first  # same revision, same time, same state
    assert gaps(rig.store).count(("paused", 1)) == 1  # no second gap
    assert ok(rig.api.get("/api/data"))["paused"] is True


def test_resume_clears_the_flag_and_is_idempotent(rig: Rig) -> None:
    ok(rig.api.post("/api/collector", {"paused": True}), CONTROL_V1)
    resumed = ok(rig.api.post("/api/collector", {"paused": False}), CONTROL_V1)
    assert resumed["paused"] is False and resumed["state"] != "paused"
    assert resumed["revision"] > 0
    again = ok(rig.api.post("/api/collector", {"paused": False}), CONTROL_V1)
    assert (
        again["revision"] == resumed["revision"] and again["changedAtMs"] == resumed["changedAtMs"]
    )
    assert ok(rig.api.get("/api/data"))["paused"] is False
    assert any(reason == "paused" for reason, _ in gaps(rig.store))  # the pause stays on record


def test_a_resume_with_no_pause_changes_nothing(rig: Rig) -> None:
    before = query(rig.store, "SELECT paused, changed_at_ms, revision FROM collector_setting")
    body = ok(rig.api.post("/api/collector", {"paused": False}), CONTROL_V1)
    assert body["paused"] is False
    assert (
        query(rig.store, "SELECT paused, changed_at_ms, revision FROM collector_setting") == before
    )


def test_the_roster_names_a_paused_collector_and_paused_time_is_a_gap(rig: Rig) -> None:
    ok(rig.api.post("/api/collector", {"paused": True}), CONTROL_V1)
    body = ok(rig.api.get("/api/roster"), ROSTER_V1)
    assert body["collector"]["state"] == "paused"
    bots = body["items"]
    assert bots and all(item["coverage"]["state"] != "covered" for item in bots)
    assert {item["coverage"]["state"] for item in bots} <= {"gap", "unknown"}
    assert {item["coverage"]["reasonCode"] for item in bots} == {"paused"}


@pytest.mark.parametrize(
    "body",
    [{"paused": "true"}, {"paused": 1}, {"paused": None}, {}, {"paused": True, "x": 1}, [], None],
)
def test_a_bad_pause_body_is_refused_and_the_flag_stays(rig: Rig, body: Any) -> None:
    error(rig.api.post("/api/collector", body), 400, "invalid_body")
    assert query(rig.store, "SELECT paused FROM collector_setting") == [(0,)]


def test_without_a_collector_the_route_answers_503(rig: Rig) -> None:
    rig.app.state.collector = None
    error(rig.api.post("/api/collector", {"paused": True}), 503, "collector_unavailable")
    assert query(rig.store, "SELECT paused FROM collector_setting") == [(0,)]


def test_a_halted_collector_that_cannot_pause_answers_503(rig: Rig) -> None:
    rig.client.portal.call(rig.collector.stop)  # type: ignore[union-attr]
    error(rig.api.post("/api/collector", {"paused": True}), 503, "collector_unavailable")
