"""The 13 signed Specter routes over a real store, with only the model scripted."""

import base64
import hashlib
import hmac
import json
import secrets
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from starlette.applications import Starlette
from starlette.testclient import TestClient

from backend.specter_arena.specter_routes import MAX_BODY_BYTES, specter_routes
from backend.specter_arena.specters.service import UNSET, Limits, SpecterService
from backend.specter_arena.store import Store, open_store
from backend.specter_arena.summoner import SummonFailure

from .contract_support import compile_schema, load_registry
from .png_support import png
from .specter_fakes import ALPHA, FakeClock, ScriptedSummoner, bind, good_reply, table_counts

SECRET = "specter-route-secret"
REGISTRY = load_registry()
RID = "req_" + "0" * 23 + "1"
RID2 = "req_" + "0" * 23 + "2"
URN = "urn:specter-arena:contract:"
SPECTER_TABLES = ("specter", "generation_request", "asset")


def validator(name: str) -> Any:
    return compile_schema(f"{URN}{name}:v1", REGISTRY)


def signed(method: str, target: str, body: bytes = b"") -> dict[str, str]:
    stamp = str(int(time.time()))
    nonce = secrets.token_hex(16)
    digest = hashlib.sha256(body).hexdigest()
    message = f"v2:{stamp}:{nonce}:{method}:{target}:{digest}"
    mac = hmac.new(SECRET.encode(), message.encode(), hashlib.sha256).hexdigest()
    return {"X-KiroCrew-Proxy-V2": f"{stamp}:{mac}", "X-KiroCrew-Proxy-Nonce": nonce}


class Api:
    def __init__(self, client: TestClient) -> None:
        self.client = client

    def call(self, method: str, target: str, body: Any = None, *, sign: bool = True) -> Any:
        raw = b"" if body is None else json.dumps(body).encode()
        headers = signed(method, target, raw) if sign else {}
        return self.client.request(method, target, content=raw or None, headers=headers)

    def get(self, target: str) -> Any:
        return self.call("GET", target)

    def post(self, target: str, body: Any = None) -> Any:
        return self.call("POST", target, {} if body is None else body)


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


class Rig:
    def __init__(self, opened: Store, *steps: Any) -> None:
        self.store = opened
        self.binding = bind(opened, ALPHA, "Probe Bot")
        self.summoner = ScriptedSummoner(*steps)
        self.service = SpecterService(
            opened, self.summoner, clock=FakeClock(), limits=Limits(timeout_s=2.0)
        )
        self.app = Starlette(routes=specter_routes())
        self.app.state.specters = self.service


@pytest.fixture
def rig(opened: Store) -> Iterator[tuple[Rig, Api]]:
    made = Rig(opened)
    with TestClient(made.app) as client:
        client.portal.call(made.service.start)  # type: ignore[union-attr]
        yield made, Api(client)


def settle(api: Api, request_id: str) -> dict[str, Any]:
    for _ in range(400):
        body = api.get(f"/api/summonings/{request_id}").json()
        if body["status"] in ("ready", "failed", "cancelled"):
            return body  # type: ignore[no-any-return]
        time.sleep(0.005)
    raise AssertionError("request did not settle")


class Recorder:
    """Stands in for the service and records each call."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []

    def __getattr__(self, name: str) -> Any:
        async def method(*args: Any) -> Any:
            self.calls.append((name, args))
            if name == "start_summoning":
                return 202, {"ok": True}
            return {"ok": True}

        return method


def recorded_app() -> tuple[Starlette, Recorder]:
    recorder = Recorder()
    app = Starlette(routes=specter_routes())
    app.state.specters = recorder
    return app, recorder


BID = "bnd_" + "a" * 24
AID = "ast_" + "b" * 24
ROUTES: list[tuple[str, str, Any]] = [
    ("GET", "/api/specters", None),
    ("GET", f"/api/specters/{BID}", None),
    ("POST", f"/api/specters/{BID}/summonings", {"requestId": RID}),
    ("POST", f"/api/specters/{BID}/manual", {"expectedVersion": 0, "profile": {}}),
    ("POST", f"/api/specters/{BID}/name", {"expectedVersion": 1, "name": "N"}),
    ("POST", f"/api/specters/{BID}/portrait", {"expectedVersion": 1, "assetId": None}),
    ("POST", f"/api/specters/{BID}/archive", {"expectedVersion": 1}),
    ("GET", f"/api/summonings/{RID}", None),
    ("POST", f"/api/summonings/{RID}/cancel", {}),
    ("POST", f"/api/summonings/{RID}/accept", {"expectedVersion": 0}),
    ("GET", "/api/portraits", None),
    ("POST", "/api/assets", {"mediaType": "image/png", "dataBase64": ""}),
    ("GET", f"/api/assets/{AID}", None),
]
EXPECTED_CALLS = [
    ("list_specters", ()),
    ("get_specter", (BID,)),
    ("start_summoning", (BID, {"requestId": RID})),
    ("save_manual", (BID, 0, {})),
    ("rename", (BID, 1, "N", UNSET)),
    ("set_portrait", (BID, 1, None)),
    ("archive", (BID, 1)),
    ("get_summoning", (RID,)),
    ("cancel_summoning", (RID,)),
    ("accept", (RID, 0)),
    ("list_portraits", ()),
    ("upload_asset", ({"mediaType": "image/png", "dataBase64": ""},)),
    ("get_asset", (AID,)),
]


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
            assert api.call(method, target, body).status_code in (200, 201, 202)
    assert recorder.calls == EXPECTED_CALLS


def test_upload_returns_201_and_a_start_returns_the_service_status() -> None:
    app, _ = recorded_app()
    with TestClient(app) as client:
        api = Api(client)
        assert api.post("/api/assets", {"mediaType": "image/png"}).status_code == 201
        assert api.post(f"/api/specters/{BID}/summonings", {"requestId": RID}).status_code == 202


def test_a_present_epithet_is_passed_through_including_null() -> None:
    app, recorder = recorded_app()
    with TestClient(app) as client:
        api = Api(client)
        api.post(f"/api/specters/{BID}/name", {"expectedVersion": 1, "name": "N", "epithet": None})
        api.post(f"/api/specters/{BID}/name", {"expectedVersion": 1, "name": "N", "epithet": "e"})
    assert [call[1][3] for call in recorder.calls] == [None, "e"]


def test_a_service_that_is_not_running_is_503_store_not_ready() -> None:
    app = Starlette(routes=specter_routes())
    app.state.specters = None
    with TestClient(app) as client:
        response = Api(client).get("/api/specters")
    assert response.status_code == 503
    assert response.json() == {"contractVersion": 1, "error": "store_not_ready"}


def test_a_missing_proxy_secret_is_503(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("KIROCREW_PROXY_SECRET")
    app, _ = recorded_app()
    with TestClient(app) as client:
        response = client.get("/api/specters")
    assert response.status_code == 503
    assert response.json()["error"] == "proxy_secret_missing"


@pytest.mark.parametrize("path", [f"/api/summonings/{RID}/accept", "/api/portraits"])
def test_the_wrong_method_is_405(path: str) -> None:
    app, _ = recorded_app()
    with TestClient(app) as client:
        response = client.request("PUT", path, headers=signed("PUT", path))
    assert response.status_code == 405


def test_a_body_over_the_cap_is_413_before_the_signature_is_checked() -> None:
    app, recorder = recorded_app()
    with TestClient(app) as client:
        big = b"x" * (MAX_BODY_BYTES + 1)
        over = client.post(f"/api/summonings/{RID}/accept", content=big)
        asset = client.post("/api/assets", content=big)
    assert over.status_code == 413 and over.json()["error"] == "body_too_large"
    assert asset.status_code == 413 and asset.json()["error"] == "asset_too_large"
    assert recorder.calls == []


def test_a_post_without_a_content_length_is_413() -> None:
    app, recorder = recorded_app()
    with TestClient(app) as client:
        response = client.post(f"/api/summonings/{RID}/accept", content=iter([b"{}"]))
    assert response.status_code == 413
    assert recorder.calls == []


@pytest.mark.parametrize(
    "body",
    [b"not json", b"[]", b"7", b'{"expectedVersion": 1, "extra": 1}', b"{}"],
    ids=["text", "list", "number", "extra-key", "missing-key"],
)
def test_a_wrong_body_is_400_invalid_body(body: bytes) -> None:
    app, recorder = recorded_app()
    target = f"/api/summonings/{RID}/accept"
    with TestClient(app) as client:
        response = client.post(target, content=body, headers=signed("POST", target, body))
    assert response.status_code == 400
    assert response.json() == {"contractVersion": 1, "error": "invalid_body"}
    assert recorder.calls == []


def test_every_body_shape_check_is_enforced() -> None:
    app, recorder = recorded_app()
    with TestClient(app) as client:
        api = Api(client)
        bad = [
            (f"/api/summonings/{RID}/cancel", {"x": 1}),
            (f"/api/specters/{BID}/manual", {"expectedVersion": 0}),
            (f"/api/specters/{BID}/name", {"expectedVersion": 0}),
            (f"/api/specters/{BID}/portrait", {"expectedVersion": 0}),
            (f"/api/specters/{BID}/archive", {}),
        ]
        for target, body in bad:
            assert api.post(target, body).status_code == 400, target
        for target in (f"/api/specters/{BID}/summonings", "/api/assets"):
            raw = b"{nope"
            response = client.post(target, content=raw, headers=signed("POST", target, raw))
            assert response.status_code == 400, target
    assert recorder.calls == []


@pytest.mark.parametrize("bad_id", ["a.b", "%20", "x" * 65, "bnd_short"])
def test_malformed_ids_give_the_same_404_as_unknown_ones(rig: tuple[Rig, Api], bad_id: str) -> None:
    _, api = rig
    unknown = api.get(f"/api/specters/{'bnd_' + 'f' * 24}")
    for target in (
        f"/api/specters/{bad_id}",
        f"/api/summonings/{bad_id}",
        f"/api/assets/{bad_id}",
    ):
        response = api.get(target)
        assert response.status_code == 404, target
        assert response.headers["x-content-type-options"] == "nosniff"
    assert api.get(f"/api/specters/{bad_id}").status_code == unknown.status_code


def test_the_whole_flow_over_http_validates_against_the_contracts_and_leaves_no_other_rows(
    rig: tuple[Rig, Api],
) -> None:
    made, api = rig
    before = table_counts(made.store, except_prefixes=SPECTER_TABLES)
    errors = validator("api-error")

    assert api.get("/api/specters").json() == {"contractVersion": 1, "items": []}
    validator("specters")(api.get("/api/specters").json())

    start = api.post(f"/api/specters/{made.binding}/summonings", {"requestId": RID})
    assert start.status_code == 202
    validator("summoning")(start.json())
    assert (
        api.post(f"/api/specters/{made.binding}/summonings", {"requestId": RID}).status_code == 200
    )
    ready = settle(api, RID)
    assert ready["status"] == "ready"
    validator("summoning")(ready)
    assert len(made.summoner.prompts) == 1

    accepted = api.post(f"/api/summonings/{RID}/accept", {"expectedVersion": 0})
    assert accepted.status_code == 200
    validator("specter")(accepted.json())
    version = accepted.json()["version"]

    stale = api.post(f"/api/summonings/{RID}/accept", {"expectedVersion": 0})
    assert stale.status_code == 409
    errors(stale.json())

    renamed = api.post(
        f"/api/specters/{made.binding}/name", {"expectedVersion": version, "name": "Wick Two"}
    )
    assert renamed.status_code == 200 and renamed.json()["profile"]["name"] == "Wick Two"
    validator("specter")(renamed.json())
    version = renamed.json()["version"]

    pixels = png(8, 8)
    upload = api.post(
        "/api/assets",
        {
            "mediaType": "image/png",
            "dataBase64": base64.b64encode(pixels).decode(),
            "label": "Mine",
        },
    )
    assert upload.status_code == 201
    validator("portrait-asset")(upload.json())
    asset_id = upload.json()["assetId"]

    gallery = api.get("/api/portraits").json()
    validator("portrait-asset")(gallery["items"][0])
    assert asset_id in {item["assetId"] for item in gallery["items"]}
    assert {item["origin"] for item in gallery["items"]} >= {"bundled", "uploaded"}

    fetched = api.get(f"/api/assets/{asset_id}")
    assert fetched.status_code == 200
    validator("portrait-asset")(fetched.json())
    assert fetched.json()["dataBase64"] is not None

    chosen = api.post(
        f"/api/specters/{made.binding}/portrait", {"expectedVersion": version, "assetId": asset_id}
    )
    assert chosen.status_code == 200 and chosen.json()["portrait"]["assetId"] == asset_id
    version = chosen.json()["version"]

    assert api.get(f"/api/specters/{made.binding}").json()["version"] == version
    listing = api.get("/api/specters").json()
    validator("specters")(listing)
    assert len(listing["items"]) == 1

    archived = api.post(f"/api/specters/{made.binding}/archive", {"expectedVersion": version})
    assert archived.status_code == 200
    assert table_counts(made.store, except_prefixes=SPECTER_TABLES) == before


def test_manual_entry_and_cancel_work_over_http(rig: tuple[Rig, Api]) -> None:
    made, api = rig
    profile = json.loads(good_reply("Manual Name"))
    profile["contractVersion"] = 1
    saved = api.post(
        f"/api/specters/{made.binding}/manual", {"expectedVersion": 0, "profile": profile}
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["source"] == "manual"
    made.summoner.steps.append(ScriptedSummoner.HANG)
    assert (
        api.post(f"/api/specters/{made.binding}/summonings", {"requestId": RID2}).status_code == 202
    )
    cancelled = api.post(f"/api/summonings/{RID2}/cancel")
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"


def test_a_failed_generation_is_reported_in_the_summoning_body(opened: Store) -> None:
    made = Rig(opened, SummonFailure("refused"))
    with TestClient(made.app) as client:
        client.portal.call(made.service.start)  # type: ignore[union-attr]
        api = Api(client)
        api.post(f"/api/specters/{made.binding}/summonings", {"requestId": RID})
        body = settle(api, RID)
    assert body["status"] == "failed"
    validator("summoning")(body)
    assert SECRET not in json.dumps(body)


def test_a_bad_png_is_rejected_with_the_matrix_status(rig: tuple[Rig, Api]) -> None:
    _, api = rig
    wrong_type = api.post("/api/assets", {"mediaType": "image/svg+xml", "dataBase64": "AAAA"})
    assert wrong_type.status_code == 415
    not_png = api.post(
        "/api/assets",
        {"mediaType": "image/png", "dataBase64": base64.b64encode(b"<svg onload=x>").decode()},
    )
    assert not_png.status_code in (415, 422)
    validator("api-error")(not_png.json())
