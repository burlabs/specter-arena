"""The eight signed work routes: the route table, signing, dispatch, statuses and body parsing
(FP0809-CI-02, FP-08-AC06)."""

import ast
import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any, cast

import pytest
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from backend.specter_arena.specter_routes import MAX_BODY_BYTES
from backend.specter_arena.work_routes import work_routes

from .contract_support import compile_schema, load_registry
from .work_api_fakes import SIGNING_VALUE, URN, Api, WorkRig, build_rig, signed
from .work_fakes import token

REGISTRY = load_registry()
WID = "wrk_" + "a" * 24
BID = "bnd_" + "b" * 24
ROUTES_FILE = Path(__file__).resolve().parents[1] / "specter_arena" / "work_routes.py"


def validator(name: str) -> Any:
    return compile_schema(f"{URN}{name}:v1", REGISTRY)


@pytest.fixture(autouse=True)
def gateway_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KIROCREW_PROXY_SECRET", SIGNING_VALUE)


@pytest.fixture
def rig(tmp_path: Path) -> Iterator[tuple[WorkRig, Api]]:
    made = build_rig(tmp_path)
    try:
        with TestClient(made.app) as client:
            yield made, Api(client)
    finally:
        made.store.close()


class Recorder:
    """Stands in for the service and records each call with its keyword arguments."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...], dict[str, Any]]] = []
        self.create_status = 201

    def __getattr__(self, name: str) -> Any:
        async def method(*args: Any, **kwargs: Any) -> Any:
            self.calls.append((name, args, kwargs))
            return (self.create_status, {"ok": True}) if name == "create_work" else {"ok": True}

        return method


def recorded_app() -> tuple[Starlette, Recorder]:
    recorder = Recorder()
    app = Starlette(routes=work_routes())
    app.state.work = recorder
    return app, recorder


QUERY = "?state=open&bindingId=" + BID + "&cursor=abc&limit=5"
ROUTES: list[tuple[str, str, Any]] = [
    ("GET", "/api/work" + QUERY, None),
    ("POST", "/api/work", {"requestId": "create-00000001"}),
    ("GET", f"/api/work/{WID}", None),
    ("POST", f"/api/work/{WID}/attempts", {"expectedVersion": 1}),
    ("POST", f"/api/work/{WID}/milestones", {"expectedVersion": 1}),
    ("POST", f"/api/work/{WID}/decisions", {"requestId": "submit-00000001"}),
    ("GET", "/api/xp", None),
    ("GET", f"/api/roster/{BID}/xp?cursor=c&limit=7", None),
]
EXPECTED_CALLS: list[tuple[str, tuple[Any, ...], dict[str, Any]]] = [
    (
        "list_work",
        (),
        {"state": "open", "binding_id": BID, "cursor": "abc", "limit": "5"},
    ),
    ("create_work", ({"requestId": "create-00000001"},), {}),
    ("get_work", (WID,), {}),
    ("link_attempt", (WID, {"expectedVersion": 1}), {}),
    ("set_milestone", (WID, {"expectedVersion": 1}), {}),
    ("decide", (WID, {"requestId": "submit-00000001"}), {}),
    ("xp_summaries", (), {}),
    ("xp_history", (BID,), {"cursor": "c", "limit": "7"}),
]


def mounted() -> list[Route]:
    return [cast(Route, route) for route in work_routes()]


def test_the_route_table_is_exactly_the_contract() -> None:
    pairs = sorted(
        (method, route.path)
        for route in mounted()
        for method in (route.methods or set()) - {"HEAD"}
    )
    assert pairs == sorted(
        [
            ("GET", "/api/work"),
            ("POST", "/api/work"),
            ("GET", "/api/work/{work_id}"),
            ("POST", "/api/work/{work_id}/attempts"),
            ("POST", "/api/work/{work_id}/milestones"),
            ("POST", "/api/work/{work_id}/decisions"),
            ("GET", "/api/xp"),
            ("GET", "/api/roster/{binding_id}/xp"),
        ]
    )


@pytest.mark.parametrize(("method", "target", "body"), ROUTES)
def test_every_route_requires_a_signature(method: str, target: str, body: Any) -> None:
    app, recorder = recorded_app()
    with TestClient(app) as client:
        raw = b"" if body is None else json.dumps(body).encode()
        response = client.request(method, target, content=raw or None)
    assert response.status_code == 401
    assert response.json() == {"contractVersion": 1, "error": "unauthorized"}
    assert recorder.calls == []


def test_each_route_calls_the_matching_service_method_with_the_matching_arguments() -> None:
    app, recorder = recorded_app()
    with TestClient(app) as client:
        api = Api(client)
        for method, target, body in ROUTES:
            assert api.call(method, target, body).status_code in (200, 201), target
    assert recorder.calls == EXPECTED_CALLS


def test_get_and_post_on_api_work_each_reach_their_own_handler() -> None:
    app, recorder = recorded_app()
    with TestClient(app) as client:
        api = Api(client)
        assert api.get("/api/work").status_code == 200
        assert api.post("/api/work", {"requestId": "create-00000001"}).status_code == 201
    assert [call[0] for call in recorder.calls] == ["list_work", "create_work"]
    assert recorder.calls[0][2] == {
        "state": None,
        "binding_id": None,
        "cursor": None,
        "limit": None,
    }


def test_the_create_status_is_the_services_status() -> None:
    app, recorder = recorded_app()
    recorder.create_status = 200
    with TestClient(app) as client:
        assert Api(client).post("/api/work", {}).status_code == 200


def test_a_service_that_is_not_running_is_503_store_not_ready() -> None:
    app = Starlette(routes=work_routes())
    app.state.work = None
    with TestClient(app) as client:
        api = Api(client)
        for method, target, body in ROUTES:
            response = api.call(method, target, body)
            assert response.status_code == 503, target
            assert response.json() == {"contractVersion": 1, "error": "store_not_ready"}
            assert response.headers["x-content-type-options"] == "nosniff"


def test_an_app_with_no_work_state_at_all_is_503_too() -> None:
    app = Starlette(routes=work_routes())
    with TestClient(app) as client:
        assert Api(client).get("/api/xp").status_code == 503


def test_a_missing_proxy_secret_is_503(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("KIROCREW_PROXY_SECRET")
    app, _ = recorded_app()
    with TestClient(app) as client:
        response = client.get("/api/xp")
    assert response.status_code == 503
    assert response.json()["error"] == "proxy_secret_missing"


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("PUT", "/api/work"),
        ("DELETE", "/api/work"),
        ("POST", f"/api/work/{WID}"),
        ("GET", f"/api/work/{WID}/decisions"),
        ("POST", "/api/xp"),
        ("PUT", f"/api/roster/{BID}/xp"),
    ],
)
def test_the_wrong_method_is_405(method: str, path: str) -> None:
    app, recorder = recorded_app()
    with TestClient(app) as client:
        response = client.request(method, path, headers=signed(method, path))
    assert response.status_code == 405
    assert recorder.calls == []


def test_a_body_over_the_cap_is_413_before_the_signature_is_checked() -> None:
    app, recorder = recorded_app()
    with TestClient(app) as client:
        big = b"x" * (MAX_BODY_BYTES + 1)
        for path in ("/api/work", f"/api/work/{WID}/attempts", f"/api/work/{WID}/decisions"):
            response = client.post(path, content=big)
            assert response.status_code == 413 and response.json()["error"] == "body_too_large"
    assert recorder.calls == []


def test_a_post_without_a_content_length_is_413() -> None:
    app, recorder = recorded_app()
    with TestClient(app) as client:
        response = client.post("/api/work", content=iter([b"{}"]))
    assert response.status_code == 413
    assert recorder.calls == []


DEEP = b"[" * 200_000 + b"]" * 200_000
BODIES = [
    pytest.param(b"not json", id="text"),
    pytest.param(b"", id="empty"),
    pytest.param(b'{"a": 1, "a": 2}', id="duplicate-keys"),
    pytest.param(b'{"requestId": NaN}', id="nan"),
    pytest.param(b'{"requestId": Infinity}', id="infinity"),
    pytest.param(b'{"requestId": -Infinity}', id="negative-infinity"),
    pytest.param(b"\xff\xfe{}", id="invalid-utf8"),
    pytest.param(DEEP, id="deeply-nested"),
]


@pytest.mark.parametrize("body", BODIES)
def test_an_unparseable_body_is_400_and_never_reaches_the_service(body: bytes) -> None:
    app, recorder = recorded_app()
    with TestClient(app) as client:
        for path in ("/api/work", f"/api/work/{WID}/attempts", f"/api/work/{WID}/milestones"):
            response = client.post(path, content=body, headers=signed("POST", path, body))
            assert response.status_code == 400, path
            assert response.json() == {"contractVersion": 1, "error": "invalid_body"}
        decisions = f"/api/work/{WID}/decisions"
        response = client.post(decisions, content=body, headers=signed("POST", decisions, body))
        assert response.status_code == 400
    assert recorder.calls == []


@pytest.mark.parametrize("body", [b"[]", b"7", b"null", b'"text"', b"true"])
def test_a_parseable_body_that_is_not_an_object_is_400_from_the_service(
    rig: tuple[WorkRig, Api], body: bytes
) -> None:
    made, _ = rig
    client = TestClient(made.app)
    for path in ("/api/work", f"/api/work/{WID}/decisions"):
        response = client.post(path, content=body, headers=signed("POST", path, body))
        assert response.status_code == 400, path
        assert response.json() == {"contractVersion": 1, "error": "invalid_body"}


@pytest.mark.parametrize("bad", ["a.b", "%20", "x" * 65, "wrk_short", "WRK_" + "a" * 24])
def test_malformed_ids_give_the_same_404_as_unknown_ones(
    rig: tuple[WorkRig, Api], bad: str
) -> None:
    _, api = rig
    unknown = api.get(f"/api/work/{WORK_FAR}")
    assert unknown.status_code == 404
    link = {"expectedVersion": 1, "attemptId": "att_" + "a" * 24}
    decision = {"requestId": "submit-00000001", "expectedVersion": 1, "action": "submit"}
    for response in (
        api.get(f"/api/work/{bad}"),
        api.post(f"/api/work/{bad}/attempts", link),
        api.post(f"/api/work/{bad}/decisions", decision),
    ):
        assert response.status_code == 404
        assert response.json() == unknown.json() == {"contractVersion": 1, "error": "unknown_work"}
        assert response.headers["x-content-type-options"] == "nosniff"
    for response in (api.get(f"/api/roster/{bad}/xp"), api.get("/api/work?bindingId=" + bad)):
        assert response.status_code == 404
        assert response.json() == {"contractVersion": 1, "error": "unknown_binding"}


WORK_FAR = "wrk_" + "f" * 24


def test_the_http_flow_validates_against_every_contract_and_carries_nosniff(
    rig: tuple[WorkRig, Api],
) -> None:
    made, api = rig
    attempts = [made.seeded.attempts[0][0], made.seeded.attempts[1][0]]
    errors = validator("api-error")

    empty = api.get("/api/work")
    assert empty.status_code == 200 and empty.json()["items"] == []
    validator("work-items")(empty.json())
    validator("xp-summaries")(api.get("/api/xp").json())

    body = {
        "requestId": token("create", 1),
        "title": "Write the release notes",
        "acceptanceCondition": "The owner read them and agrees.",
        "rewardable": True,
        "attemptIds": attempts,
        "milestones": ["Outline"],
    }
    created = api.post("/api/work", body)
    assert created.status_code == 201
    item = created.json()
    validator("work-item")(item)
    assert api.post("/api/work", body).status_code == 200

    work = f"/api/work/{item['workId']}"
    milestone = api.post(
        f"{work}/milestones", {"expectedVersion": item["version"], "position": 1, "done": True}
    )
    assert milestone.status_code == 200 and milestone.json()["progress"] == {"done": 1, "total": 1}
    submitted = api.post(
        f"{work}/decisions",
        {"requestId": token("submit"), "expectedVersion": 2, "action": "submit"},
    )
    assert submitted.status_code == 200
    validator("work-item")(submitted.json())
    revision = submitted.json()["evidenceRevision"]

    stale = api.post(
        f"{work}/decisions",
        {
            "requestId": token("accept", 1),
            "expectedVersion": 3,
            "action": "accept",
            "evidenceRevision": "0" * 24,
        },
    )
    assert stale.status_code == 409
    assert stale.json() == {"contractVersion": 1, "error": "stale_evidence"}
    errors(stale.json())

    accept = {
        "requestId": token("accept", 2),
        "expectedVersion": 3,
        "action": "accept",
        "evidenceRevision": revision,
    }
    accepted = api.post(f"{work}/decisions", accept)
    assert accepted.status_code == 200 and accepted.json()["state"] == "accepted"
    assert api.post(f"{work}/decisions", accept).json() == accepted.json()

    fetched = api.get(work)
    assert fetched.json() == accepted.json()
    listing = api.get("/api/work?state=accepted&limit=5")
    assert [i["workId"] for i in listing.json()["items"]] == [item["workId"]]
    validator("work-items")(listing.json())

    summaries = api.get("/api/xp")
    validator("xp-summaries")(summaries.json())
    assert [s["totalXp"] for s in summaries.json()["items"]] == [50, 50]
    history = api.get(f"/api/roster/{made.seeded.bindings[0]}/xp")
    validator("xp-history")(history.json())
    assert history.json()["summary"]["totalXp"] == 50

    for response in (empty, created, milestone, stale, accepted, fetched, summaries, history):
        assert response.headers["x-content-type-options"] == "nosniff"

    bad = api.post(f"{work}/decisions", {**accept, "actor": "app-owner"})
    assert bad.status_code == 400
    errors(bad.json())


@pytest.mark.parametrize(
    ("target", "status", "code"),
    [
        ("/api/work?state=bogus", 400, "invalid_state"),
        ("/api/work?limit=abc", 400, "invalid_limit"),
        ("/api/work?cursor=", 400, "invalid_cursor"),
        ("/api/work?cursor=%00bad", 400, "invalid_cursor"),
        ("/api/work?bindingId=" + "bnd_" + "f" * 24, 404, "unknown_binding"),
        ("/api/roster/" + "bnd_" + "f" * 24 + "/xp", 404, "unknown_binding"),
        ("/api/work?unknown=1&limit=2", 200, ""),
    ],
)
def test_query_errors_are_typed_and_unknown_parameters_are_ignored(
    rig: tuple[WorkRig, Api], target: str, status: int, code: str
) -> None:
    _, api = rig
    response = api.get(target)
    assert response.status_code == status
    if code:
        assert response.json() == {"contractVersion": 1, "error": code}
        validator("api-error")(response.json())


def decorator_names(function: ast.AsyncFunctionDef) -> list[str]:
    return [ast.unparse(d) for d in function.decorator_list]


def handler_decorators(source: str) -> dict[str, list[str]]:
    return {
        node.name: decorator_names(node)
        for node in ast.parse(source).body
        if isinstance(node, ast.AsyncFunctionDef) and not node.name.startswith("_")
    }


def unsigned_handlers(source: str) -> list[str]:
    return [name for name, names in handler_decorators(source).items() if "signed" not in names]


def uncapped_posts(source: str, post_handlers: set[str]) -> list[str]:
    found = handler_decorators(source)
    return [name for name in sorted(post_handlers) if "capped" not in found.get(name, [])]


def test_every_public_handler_is_signed_and_every_post_handler_is_capped() -> None:
    source = ROUTES_FILE.read_text(encoding="utf-8")
    found = handler_decorators(source)
    assert len(found) == 8
    assert unsigned_handlers(source) == []
    posts = {route.endpoint.__name__ for route in mounted() if "POST" in (route.methods or set())}
    assert posts == {"create_work", "link_attempt", "set_milestone", "decide"}
    assert uncapped_posts(source, posts) == []
    assert all(names == ["capped", "signed"] or names == ["signed"] for names in found.values())


def test_negative_control_the_decorator_guard_flags_a_handler_that_lost_its_signature() -> None:
    source = "@signed\nasync def a(r): ...\n\nasync def b(r): ...\n\n@capped\nasync def c(r): ...\n"
    assert unsigned_handlers(source) == ["b", "c"]
    assert uncapped_posts(source, {"a", "c"}) == ["a"]
    assert unsigned_handlers("@signed\nasync def _private(r): ...\nasync def _p(r): ...\n") == []
