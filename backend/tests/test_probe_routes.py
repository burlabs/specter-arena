import json
import re
import sys
import time
import types
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from starlette.applications import Starlette
from starlette.testclient import TestClient

from backend.specter_arena.probe.routes import (
    MAX_PAGE_REQUESTS,
    SERVICE,
    ProbeService,
    default_port_factory,
    probe_routes,
)
from backend.specter_arena.probe.steps import DEFAULT_STEP_IDS, select_steps
from backend.tests.probe_fakes import (
    SECRET,
    FakePort,
    error_body,
    json_body,
    sign_headers,
    slot_row,
    slots_frame,
)

JSON = {"Content-Type": "application/json"}
LIVE_MODULE = "backend.specter_arena.probe.live"
MakeClient = Callable[[ProbeService], TestClient]


@pytest.fixture(autouse=True)
def proxy_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KIROCREW_PROXY_SECRET", SECRET)


OPTIONS_PATH = Path("unset")


@pytest.fixture(autouse=True)
def staged_options(tmp_path_factory: pytest.TempPathFactory) -> Iterator[None]:
    """Every service in this module reads a staged options file naming the host version."""
    global OPTIONS_PATH
    OPTIONS_PATH = tmp_path_factory.mktemp("options") / ".probe-run.json"
    OPTIONS_PATH.write_text(json.dumps({"hostVersion": "0.12.2"}))
    yield


def service(port: FakePort | None = None, **kwargs: object) -> ProbeService:
    chosen = port or FakePort({("GET", "/api/chat/slots"): (200, json_body([]))})
    options: dict[str, object] = {
        "out_dir": None,
        "gateway_available": lambda: True,
        "capture_seconds": 0.2,
        "options_path": OPTIONS_PATH,
    }
    options.update(kwargs)
    return ProbeService(lambda: chosen, **options)  # type: ignore[arg-type]


@pytest.fixture
def make_client() -> Iterator[MakeClient]:
    clients: list[TestClient] = []

    def build(svc: ProbeService) -> TestClient:
        client = TestClient(Starlette(routes=probe_routes(svc)))
        client.__enter__()
        clients.append(client)
        return client

    yield build
    for client in clients:
        client.__exit__(None, None, None)


def call(
    client: TestClient,
    method: str,
    path: str,
    body: object | bytes | None = None,
    *,
    sign: bool = True,
    headers: dict[str, str] | None = None,
) -> Any:
    raw = body if isinstance(body, bytes) else (b"" if body is None else json.dumps(body).encode())
    sent: dict[str, str] = dict(JSON) if raw else {}
    if sign:
        sent.update(sign_headers(path, method=method, body=raw))
    sent.update(headers or {})
    return client.request(method, path, content=raw, headers=sent)


def wait_until_done(client: TestClient) -> dict[str, object]:
    for _ in range(300):
        state = call(client, "GET", "/api/probe/state").json()
        if state["status"] != "running":
            return state  # type: ignore[no-any-return]
        time.sleep(0.01)
    raise AssertionError("run did not finish")


ROUTES = [
    ("GET", "/api/probe/state"),
    ("POST", "/api/probe/config"),
    ("POST", "/api/probe/run"),
    ("POST", "/api/probe/annotate"),
    ("GET", "/api/probe/snapshot"),
    ("GET", "/api/probe/export"),
]


@pytest.mark.parametrize(("method", "path"), ROUTES)
def test_every_route_rejects_unsigned_requests(
    make_client: MakeClient, method: str, path: str
) -> None:
    client = make_client(service())
    assert call(client, method, path, sign=False).status_code == 401


@pytest.mark.parametrize(("method", "path"), ROUTES)
def test_every_route_rejects_a_wrong_secret(
    make_client: MakeClient, method: str, path: str
) -> None:
    client = make_client(service())
    headers = sign_headers(path, method=method, secret="another-secret")
    assert client.request(method, path, headers=headers).status_code == 401


def test_routes_are_exactly_the_six_probe_paths() -> None:
    paths = sorted(route.path for route in probe_routes())  # type: ignore[attr-defined]
    assert paths == sorted(path for _, path in ROUTES)


def test_signed_run_returns_202_and_the_snapshot_is_live(make_client: MakeClient) -> None:
    port = FakePort(frames=[slots_frame(slot_row("member-probe"))])
    client = make_client(service(port))
    assert call(client, "POST", "/api/probe/config", {"probeSlug": "probe"}).status_code == 204
    response = call(client, "POST", "/api/probe/run", {"steps": ["token-exchange", "ws-capture"]})
    assert response.status_code == 202
    run_id = response.json()["runId"]
    assert wait_until_done(client)["status"] == "done"
    snapshot = call(client, "GET", "/api/probe/snapshot").json()
    assert snapshot["provenance"]["source"] == "live"
    assert snapshot["provenance"]["runId"] == run_id
    states = {cell["key"]: cell["state"] for cell in snapshot["cells"]}
    assert states["app-owned-token-exchange"] == "ALLOWED"
    assert states["bot-id-observable"] == "ALLOWED"
    assert len(snapshot["hostFacts"]) == 16


def test_a_run_with_no_body_runs_the_default_steps(make_client: MakeClient) -> None:
    client = make_client(service())
    assert call(client, "POST", "/api/probe/run").status_code == 202
    state = wait_until_done(client)
    assert state["steps"] == list(DEFAULT_STEP_IDS)
    assert state["decidedCells"] == sum(len(step.cells) for step in select_steps(None))


def test_without_a_gateway_origin_the_run_records_untested_cells(
    make_client: MakeClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("KIROCREW_GATEWAY_ORIGIN", raising=False)
    svc = ProbeService(lambda: FakePort(), out_dir=None, options_path=OPTIONS_PATH)
    client = make_client(svc)
    call(client, "POST", "/api/probe/run", {"steps": ["token-exchange"]})
    wait_until_done(client)
    assert "unavailable" in (svc.run.cells["app-owned-token-exchange"].notes or "")


def test_export_holds_snapshot_matrix_and_host_facts(make_client: MakeClient) -> None:
    client = make_client(service())
    call(client, "POST", "/api/probe/run", {"steps": ["token-exchange"]})
    wait_until_done(client)
    exported = call(client, "GET", "/api/probe/export").json()
    assert set(exported) == {"snapshot", "matrix", "hostFacts", "eventCapture"}
    cells = {cell["id"]: cell for cell in exported["matrix"]["cells"]}
    assert cells["app-owned-token-exchange"]["credential"] == "APP-TOKEN"
    assert exported["hostFacts"]["facts"][0]["status"] == "UNTESTED"


def test_run_validation(make_client: MakeClient) -> None:
    client = make_client(service())
    assert call(client, "POST", "/api/probe/run", {"steps": ["nope"]}).status_code == 422
    assert call(client, "POST", "/api/probe/run", {"steps": "token-exchange"}).status_code == 422
    assert call(client, "POST", "/api/probe/run", {"steps": [1]}).status_code == 422
    assert call(client, "POST", "/api/probe/run", ["a"]).status_code == 422


def test_a_second_run_while_one_is_running_is_409(make_client: MakeClient) -> None:
    svc = service(FakePort(frames=[], hang=True), capture_seconds=0.3)
    client = make_client(svc)
    first = call(client, "POST", "/api/probe/run", {"steps": ["ws-capture"]})
    assert first.status_code == 202
    assert call(client, "POST", "/api/probe/run", {"steps": ["ws-capture"]}).status_code == 409
    assert call(client, "POST", "/api/probe/config", {"probeSlug": "p"}).status_code == 409
    assert wait_until_done(client)["status"] == "done"


def test_a_failing_run_is_reported_as_failed(
    make_client: MakeClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def boom(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("x")

    monkeypatch.setattr("backend.specter_arena.probe.routes.run_steps", boom)
    client = make_client(service())
    call(client, "POST", "/api/probe/run")
    state = wait_until_done(client)
    assert (state["status"], state["error"]) == ("failed", "RuntimeError")


def test_config_validation(make_client: MakeClient) -> None:
    client = make_client(service())
    for bad in (
        {"probeSlug": 5},
        {},
        {"probeSlug": "has space"},
        {"probeSlug": "p", "otherApp": 3},
        {"probeSlug": "p", "otherApp": "bad app"},
        {"probeSlug": "p", "cliSlotKey": 3},
        {"probeSlug": "p", "grantsDeclared": "yes"},
    ):
        assert call(client, "POST", "/api/probe/config", bad).status_code == 422, bad
    ok = {"probeSlug": "p", "otherApp": "other", "cliSlotKey": "k", "grantsDeclared": False}
    assert call(client, "POST", "/api/probe/config", ok).status_code == 204
    state = call(client, "GET", "/api/probe/state").json()
    assert state["probeSlug"] == "p"
    assert state["grantsDeclared"] is False
    assert call(client, "POST", "/api/probe/config", {"probeSlug": ""}).status_code == 204


def test_body_limits_and_content_checks(make_client: MakeClient) -> None:
    client = make_client(service())
    big = json.dumps({"probeSlug": "p", "pad": "x" * 70_000}).encode()
    assert call(client, "POST", "/api/probe/config", big).status_code == 413
    assert call(client, "POST", "/api/probe/config", b"{broken").status_code == 422
    assert call(client, "POST", "/api/probe/config", b"[1]").status_code == 422
    plain = call(client, "POST", "/api/probe/config", b"{}", headers={"Content-Type": "text/plain"})
    assert plain.status_code == 415


def test_a_chunked_oversize_body_is_refused(make_client: MakeClient) -> None:
    client = make_client(service())
    body = json.dumps({"probeSlug": "p", "pad": "x" * 70_000}).encode()
    headers = {**JSON, **sign_headers("/api/probe/config", method="POST", body=body)}
    response = client.post(
        "/api/probe/config", content=iter([body[:100], body[100:]]), headers=headers
    )
    assert response.status_code == 413


def test_a_garbage_content_length_is_not_trusted(make_client: MakeClient) -> None:
    client = make_client(service())
    path = "/api/probe/state"
    headers = {**sign_headers(path), "Content-Length": "abc"}
    response = client.get(path, headers=headers)
    assert response.status_code in (200, 400)


def test_annotate_rules(make_client: MakeClient) -> None:
    client = make_client(service())

    def post(**overrides: object) -> Any:
        body: dict[str, object] = {
            "cellId": "bot-per-bot-opt-in",
            "state": "UNSUPPORTED",
            "note": "grants are app-wide",
            "credential": "OWNER-SESSION",
        }
        body.update(overrides)
        return call(client, "POST", "/api/probe/annotate", body)

    assert post().status_code == 204
    assert post(state="ALLOWED").status_code == 422
    assert post(state="ALLOWED", credential="APP-TOKEN").status_code == 422
    assert post(cellId="no-such-cell").status_code == 422
    assert post(credential="ROOT").status_code == 422
    assert post(note="  ").status_code == 422
    assert post(note=5).status_code == 422
    fact = post(cellId="host-react-version", state="OBSERVED", note="18.3.1")
    assert fact.status_code == 204
    exported = call(client, "GET", "/api/probe/export").json()
    cells = {cell["id"]: cell for cell in exported["matrix"]["cells"]}
    assert cells["bot-per-bot-opt-in"]["state"] == "UNSUPPORTED"
    facts = {item["id"]: item for item in exported["hostFacts"]["facts"]}
    assert facts["host-react-version"]["status"] == "OBSERVED"


def test_frames_are_written_as_jsonl_when_the_folder_is_writable(
    make_client: MakeClient, tmp_path: Path
) -> None:
    svc = service(FakePort(frames=[slots_frame(slot_row("chat-1"))]), out_dir=tmp_path)
    client = make_client(svc)
    call(client, "POST", "/api/probe/run", {"steps": ["ws-capture"]})
    state = wait_until_done(client)
    assert state["evidenceFile"] == "writing"
    lines = (tmp_path / svc.run.run_id / "frames.jsonl").read_text().splitlines()
    assert len(lines) == 1
    assert "chat-1" not in lines[0]


def test_a_denied_write_falls_back_to_memory(make_client: MakeClient, tmp_path: Path) -> None:
    blocker = tmp_path / "blocked"
    blocker.write_text("a file, not a folder")
    svc = service(FakePort(frames=[slots_frame(slot_row("chat-1"))]), out_dir=blocker)
    client = make_client(svc)
    call(client, "POST", "/api/probe/run", {"steps": ["ws-capture"]})
    state = wait_until_done(client)
    assert state["evidenceFile"] == "denied"
    assert state["bufferedFrames"] == 1


def test_the_state_reports_evidence_file_off_without_a_folder(make_client: MakeClient) -> None:
    client = make_client(service())
    assert call(client, "GET", "/api/probe/state").json()["evidenceFile"] == "off"


def test_without_a_live_driver_a_run_is_503(
    make_client: MakeClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setitem(sys.modules, LIVE_MODULE, None)
    client = make_client(ProbeService(out_dir=None, options_path=OPTIONS_PATH))
    assert call(client, "POST", "/api/probe/run").status_code == 503


def test_the_default_factory_builds_the_live_gateway(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = types.ModuleType(LIVE_MODULE)
    fake.LiveGateway = lambda env: ("gateway", env.secret)  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, LIVE_MODULE, fake)
    assert default_port_factory() == ("gateway", SECRET)  # type: ignore[comparison-overlap]


def test_the_module_singleton_is_the_default_service() -> None:
    assert isinstance(SERVICE, ProbeService)
    assert probe_routes()


def test_error_bodies_are_json(make_client: MakeClient) -> None:
    client = make_client(service())
    response = call(client, "POST", "/api/probe/run", {"steps": ["nope"]})
    assert response.json() == {"error": "unknown step nope"}
    assert error_body("x")


def manifest_with(tmp_path: Path, permissions: dict[str, object]) -> Path:
    path = tmp_path / "app.json"
    path.write_text(json.dumps({"permissions": permissions}))
    return path


V0_PERMISSIONS: dict[str, object] = {"api": ["/apps/specter-arena/api/*"]}
V1_PERMISSIONS: dict[str, object] = {
    "api": ["/apps/specter-arena/api/*", "/api/agents", "/api/chat/slots"],
    "events": ["slots:user"],
}


def test_config_without_grants_declared_reads_the_installed_manifest(
    make_client: MakeClient, tmp_path: Path
) -> None:
    v0 = make_client(service(manifest_path=manifest_with(tmp_path, V0_PERMISSIONS)))
    assert call(v0, "POST", "/api/probe/config", {"probeSlug": "p"}).status_code == 204
    state = call(v0, "GET", "/api/probe/state").json()
    assert (state["grantsDeclared"], state["grantsBasis"]) == (False, "manifest")

    v1 = make_client(service(manifest_path=manifest_with(tmp_path, V1_PERMISSIONS)))
    call(v1, "POST", "/api/probe/config", {"probeSlug": "p"})
    state = call(v1, "GET", "/api/probe/state").json()
    assert (state["grantsDeclared"], state["grantsBasis"]) == (True, "manifest")


def test_an_explicit_grants_declared_overrides_the_manifest(
    make_client: MakeClient, tmp_path: Path
) -> None:
    client = make_client(service(manifest_path=manifest_with(tmp_path, V0_PERMISSIONS)))
    call(client, "POST", "/api/probe/config", {"probeSlug": "p", "grantsDeclared": True})
    state = call(client, "GET", "/api/probe/state").json()
    assert (state["grantsDeclared"], state["grantsBasis"]) == (True, "request")


def test_an_unreadable_manifest_keeps_grants_declared_and_records_why(
    make_client: MakeClient, tmp_path: Path
) -> None:
    client = make_client(service(manifest_path=tmp_path / "absent.json"))
    call(client, "POST", "/api/probe/config", {"probeSlug": "p"})
    state = call(client, "GET", "/api/probe/state").json()
    assert state["grantsDeclared"] is True
    assert state["grantsBasis"] == "manifest-unreadable: FileNotFoundError"


def test_the_manifest_is_read_once_per_run_and_a_run_without_config_still_reads_it(
    make_client: MakeClient, tmp_path: Path
) -> None:
    path = manifest_with(tmp_path, V0_PERMISSIONS)
    svc = service(manifest_path=path)
    assert svc.state()["grantsBasis"] == "default"
    client = make_client(svc)
    call(client, "POST", "/api/probe/config", {"probeSlug": "p"})
    path.write_text(json.dumps({"permissions": V1_PERMISSIONS}))
    call(client, "POST", "/api/probe/run", {"steps": ["token-exchange"]})
    state = wait_until_done(client)
    assert (state["grantsDeclared"], state["grantsBasis"]) == (False, "manifest")

    call(client, "POST", "/api/probe/run", {"steps": ["token-exchange"]})
    state = wait_until_done(client)
    assert (state["grantsDeclared"], state["grantsBasis"]) == (True, "manifest")


def test_a_v0_manifest_lets_the_deny_by_default_cell_be_decided(
    make_client: MakeClient, tmp_path: Path
) -> None:
    port = FakePort(frames=[slots_frame()])
    svc = service(port, manifest_path=manifest_with(tmp_path, V0_PERMISSIONS))
    client = make_client(svc)
    call(client, "POST", "/api/probe/config", {"probeSlug": "p"})
    call(client, "POST", "/api/probe/run", {"steps": ["ws-capture"]})
    wait_until_done(client)
    assert svc.run.cells["user-slots-no-grant-denied"].state == "DENIED"
    assert svc.run.grants_basis == "manifest"


def test_state_counts_the_declared_entries_and_an_explicit_false_grants_nothing(
    make_client: MakeClient, tmp_path: Path
) -> None:
    client = make_client(service(manifest_path=manifest_with(tmp_path, V1_PERMISSIONS)))
    call(client, "POST", "/api/probe/config", {"probeSlug": "p"})
    state = call(client, "GET", "/api/probe/state").json()
    assert (state["grantedApi"], state["grantedEvents"]) == (3, 1)
    call(client, "POST", "/api/probe/config", {"probeSlug": "p", "grantsDeclared": False})
    state = call(client, "GET", "/api/probe/state").json()
    assert (state["grantsDeclared"], state["grantsBasis"], state["grantedApi"]) == (
        False,
        "request",
        0,
    )


def test_a_run_without_a_host_version_is_409_before_any_gateway_call(
    make_client: MakeClient, tmp_path: Path
) -> None:
    port = FakePort()
    client = make_client(service(port, options_path=tmp_path / "absent.json"))
    response = call(client, "POST", "/api/probe/run", {"steps": ["token-exchange"]})
    assert (response.status_code, response.json()) == (409, {"error": "host_version_unset"})
    assert port.calls == []
    accepted = call(client, "POST", "/api/probe/run", {"hostVersion": "0.12.2"})
    assert accepted.status_code == 202


@pytest.mark.parametrize(
    ("body", "fragment"),
    [
        ({"captureSeconds": 901}, "captureSeconds must be between 1 and 900"),
        ({"reconnectAfterStartSeconds": 0}, "reconnectAfterStartSeconds"),
        ({"hostVersion": "latest"}, "hostVersion"),
        ({"windowSeconds": 30}, "unknown run option windowSeconds"),
    ],
)
def test_bad_run_options_are_422(make_client: MakeClient, body: object, fragment: str) -> None:
    client = make_client(service())
    response = call(client, "POST", "/api/probe/run", body)
    assert response.status_code == 422
    assert fragment in response.json()["error"]


def test_an_invalid_staged_options_file_is_422(make_client: MakeClient, tmp_path: Path) -> None:
    broken = tmp_path / ".probe-run.json"
    broken.write_text("{")
    client = make_client(service(options_path=broken))
    response = call(client, "POST", "/api/probe/run")
    assert response.json() == {"error": "run options file invalid"}


def test_run_options_reach_the_run_and_the_body_wins_over_the_file(
    make_client: MakeClient, tmp_path: Path
) -> None:
    staged = tmp_path / ".probe-run.json"
    staged.write_text(json.dumps({"hostVersion": "0.12.2", "captureSeconds": 900}))
    svc = service(options_path=staged)
    client = make_client(svc)
    body = {"steps": ["token-exchange"], "captureSeconds": 1, "hostVersion": "0.12.3"}
    call(client, "POST", "/api/probe/run", body)
    wait_until_done(client)
    assert svc.run.host_version == "0.12.3"
    exported = call(client, "GET", "/api/probe/export").json()
    cells = {cell["id"]: cell for cell in exported["matrix"]["cells"]}
    assert cells["app-owned-token-exchange"]["hostVersion"] == "0.12.3"


def test_staged_extra_steps_join_the_default_run_and_a_request_list_wins(
    make_client: MakeClient, tmp_path: Path
) -> None:
    staged = tmp_path / ".probe-run.json"
    staged.write_text(json.dumps({"hostVersion": "0.13.0", "extraSteps": ["usage-turns"]}))
    port = FakePort(
        {
            ("GET", "/api/usage"): (200, json_body({"sessions": {}})),
            ("GET", "/api/sessions/usage"): (200, json_body({"usage": {}})),
        }
    )
    svc = service(port, options_path=staged)
    client = make_client(svc)
    call(client, "POST", "/api/probe/run", {"captureSeconds": 1})
    wait_until_done(client)
    exported = call(client, "GET", "/api/probe/export").json()
    cells = {cell["id"]: cell for cell in exported["matrix"]["cells"]}
    # The default steps ran, and so did the staged opt-in step (no grant declared in this run).
    assert cells["usage-api-app-token"]["state"] != "UNTESTED" or "usage" in str(
        cells["usage-api-app-token"]
    )
    assert "usage/turns" in cells["bot-token-usage-turns-app-scoped"]["notes"]
    svc2 = service(FakePort(), options_path=staged)
    client2 = make_client(svc2)
    call(client2, "POST", "/api/probe/run", {"steps": ["token-exchange"], "captureSeconds": 1})
    wait_until_done(client2)
    cells2 = {
        c["id"]: c for c in call(client2, "GET", "/api/probe/export").json()["matrix"]["cells"]
    }
    assert cells2["bot-token-usage-turns-app-scoped"]["notes"] == "not yet probed"


def test_an_unknown_staged_extra_step_is_422(make_client: MakeClient, tmp_path: Path) -> None:
    staged = tmp_path / ".probe-run.json"
    staged.write_text(json.dumps({"hostVersion": "0.13.0", "extraSteps": ["no-such-step"]}))
    client = make_client(service(options_path=staged))
    response = call(client, "POST", "/api/probe/run")
    assert response.status_code == 422
    assert "no-such-step" in response.json()["error"]


def test_signed_page_requests_are_timed_and_bounded(make_client: MakeClient) -> None:
    svc = service()
    client = make_client(svc)
    for _ in range(3):
        call(client, "GET", "/api/probe/state")
    times = svc.page_request_times()
    assert len(times) == 3
    assert all(stamp.endswith("+00:00") for stamp in times)
    unsigned = client.get("/api/probe/state")
    assert unsigned.status_code == 401
    assert len(svc.page_request_times()) == 3
    for _ in range(MAX_PAGE_REQUESTS):
        svc.page_request()
    assert len(svc.page_request_times()) == MAX_PAGE_REQUESTS


GRAMMAR = re.compile(r"^(sha256:[0-9a-f]{12}|<redacted type=(str|list|object) len=\d+>)$")


def test_the_export_carries_an_event_capture_with_no_raw_text(make_client: MakeClient) -> None:
    frames: list[dict[str, object]] = [
        slots_frame(slot_row("member-p"), slot_row("chat-7")),
        {"type": "chat_done", "data": {"slot": "member-p", "turn": 1, "text": "PRIVATE"}},
        {"type": "tool_call", "data": {"slot": "chat-7", "kind": "execute", "tool": "PRIVATE"}},
        {"type": "chat_chunk", "data": {"slot": "member-p", "text": "PRIVATE"}},
    ]
    client = make_client(service(FakePort(frames=frames)))
    call(client, "POST", "/api/probe/config", {"probeSlug": "p"})
    call(client, "POST", "/api/probe/run", {"steps": ["ws-capture"]})
    wait_until_done(client)
    capture = call(client, "GET", "/api/probe/export").json()["eventCapture"]
    meta, rows = capture["_meta"], capture["rows"]
    assert (meta["capture"], meta["hostVersion"]) == ("event-frames", "0.12.2")
    assert meta["framesSeen"] == {"chat_chunk": 1, "chat_done": 1, "slots": 1, "tool_call": 1}
    assert [row["frameSeq"] for row in rows] == [2, 3]
    assert all(type(row["receivedAtMs"]) is int and "receivedAt" not in row for row in rows)
    assert "PRIVATE" not in json.dumps(capture)
    probe, other = rows
    assert probe["data"] == {"slot": "member-p", "turn": 1}
    for value in other["data"].values():
        assert GRAMMAR.match(value)


def test_each_run_leaves_export_files_on_disk(make_client: MakeClient, tmp_path: Path) -> None:
    svc = service(FakePort(frames=[slots_frame(slot_row("chat-1"))]), out_dir=tmp_path)
    client = make_client(svc)
    call(client, "POST", "/api/probe/run", {"steps": ["ws-capture"]})
    wait_until_done(client)
    folder = tmp_path / svc.run.run_id
    export = json.loads((folder / "export.json").read_text())
    capture = json.loads((folder / "event-capture.json").read_text())
    assert capture == export["eventCapture"]
    assert not list(folder.glob(".*.tmp"))
    note = {"cellId": "bot-fresh-start", "state": "UNTESTED", "note": "skipped"}
    call(client, "POST", "/api/probe/annotate", {**note, "credential": "OWNER-SESSION"})
    export = json.loads((folder / "export.json").read_text())
    cells = {cell["id"]: cell for cell in export["matrix"]["cells"]}
    assert cells["bot-fresh-start"]["notes"] == "skipped"


def test_an_interrupted_export_write_leaves_no_partial_file_and_the_run_finishes(
    make_client: MakeClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def refuse(_self: Path, _target: Path) -> Path:
        raise OSError("disk full")

    monkeypatch.setattr(Path, "replace", refuse)
    svc = service(FakePort(frames=[slots_frame(slot_row("chat-1"))]), out_dir=tmp_path)
    client = make_client(svc)
    call(client, "POST", "/api/probe/run", {"steps": ["ws-capture"]})
    state = wait_until_done(client)
    assert (state["status"], state["evidenceFile"]) == ("done", "denied")
    assert not (tmp_path / svc.run.run_id / "export.json").exists()
