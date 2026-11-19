"""The seven signed Specter routes over a real store, and the seven that no longer exist."""

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
from backend.specter_arena.specters.service import SpecterService
from backend.specter_arena.store import Store, open_store

from .contract_support import compile_schema, load_registry
from .png_support import png
from .specter_fakes import ALPHA, BETA, FakeClock, bind, table_counts

SECRET = "specter-route-secret"
REGISTRY = load_registry()
URN = "urn:specter-arena:contract:"
AVATAR_TABLES = ("hero_assignment", "avatar_revision", "asset")


def validator(name: str, version: int = 1) -> Any:
    return compile_schema(f"{URN}{name}:v{version}", REGISTRY)


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
    def __init__(self, opened: Store) -> None:
        self.store = opened
        self.binding = bind(opened, ALPHA, "Probe Bot")
        self.service = SpecterService(opened, clock=FakeClock())
        self.app = Starlette(routes=specter_routes())
        self.app.state.specters = self.service


@pytest.fixture
def rig(opened: Store) -> Iterator[tuple[Rig, Api]]:
    made = Rig(opened)
    with TestClient(made.app) as client:
        client.portal.call(made.service.start)  # type: ignore[union-attr]
        yield made, Api(client)


class Recorder:
    """Stands in for the service and records each call."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []

    def __getattr__(self, name: str) -> Any:
        async def method(*args: Any) -> Any:
            self.calls.append((name, args))
            return {"ok": True}

        return method


def recorded_app() -> tuple[Starlette, Recorder]:
    recorder = Recorder()
    app = Starlette(routes=specter_routes())
    app.state.specters = recorder
    return app, recorder


BID = "bnd_" + "a" * 24
AID = "ast_" + "b" * 24
RID = "req_" + "0" * 23 + "1"
ROUTES: list[tuple[str, str, Any]] = [
    ("GET", "/api/specters", None),
    ("GET", f"/api/specters/{BID}", None),
    ("POST", f"/api/specters/{BID}/portrait", {"expectedVersion": 1, "assetId": None}),
    ("GET", "/api/portraits", None),
    ("POST", "/api/assets", {"mediaType": "image/png", "dataBase64": ""}),
    ("GET", f"/api/assets/{AID}", None),
    ("GET", "/api/scene-assets/arena-map", None),
]
EXPECTED_CALLS = [
    ("list_specters", ()),
    ("get_specter", (BID,)),
    ("set_portrait", (BID, 1, None)),
    ("list_portraits", ()),
    ("upload_asset", ({"mediaType": "image/png", "dataBase64": ""},)),
    ("get_asset", (AID,)),
]
REMOVED: list[tuple[str, str, Any]] = [
    ("POST", f"/api/specters/{BID}/summonings", {"requestId": RID}),
    ("GET", f"/api/summonings/{RID}", None),
    ("POST", f"/api/summonings/{RID}/cancel", {}),
    ("POST", f"/api/summonings/{RID}/accept", {"expectedVersion": 0}),
    ("POST", f"/api/specters/{BID}/manual", {"expectedVersion": 0, "profile": {}}),
    ("POST", f"/api/specters/{BID}/name", {"expectedVersion": 1, "name": "N"}),
    ("POST", f"/api/specters/{BID}/archive", {"expectedVersion": 1}),
]


def test_the_route_table_has_exactly_seven_routes() -> None:
    assert sorted(getattr(route, "path", "") for route in specter_routes()) == [
        "/api/assets",
        "/api/assets/{asset_id}",
        "/api/portraits",
        "/api/scene-assets/{key}",
        "/api/specters",
        "/api/specters/{binding_id}",
        "/api/specters/{binding_id}/portrait",
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
        for method, target, body in ROUTES[:-1]:
            assert api.call(method, target, body).status_code in (200, 201)
    assert recorder.calls == EXPECTED_CALLS


@pytest.mark.parametrize(("method", "target", "body"), REMOVED)
def test_removed_routes_answer_404_even_when_signed(method: str, target: str, body: Any) -> None:
    app, recorder = recorded_app()
    with TestClient(app) as client:
        assert Api(client).call(method, target, body).status_code == 404
        raw = b"" if body is None else json.dumps(body).encode()
        assert client.request(method, target, content=raw or None).status_code == 404
    assert recorder.calls == []


def test_upload_returns_201() -> None:
    app, _ = recorded_app()
    with TestClient(app) as client:
        assert Api(client).post("/api/assets", {"mediaType": "image/png"}).status_code == 201


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


@pytest.mark.parametrize("path", [f"/api/specters/{BID}/portrait", "/api/portraits"])
def test_the_wrong_method_is_405(path: str) -> None:
    app, _ = recorded_app()
    with TestClient(app) as client:
        response = client.request("PUT", path, headers=signed("PUT", path))
    assert response.status_code == 405


def test_a_body_over_the_cap_is_413_before_the_signature_is_checked() -> None:
    app, recorder = recorded_app()
    with TestClient(app) as client:
        big = b"x" * (MAX_BODY_BYTES + 1)
        over = client.post(f"/api/specters/{BID}/portrait", content=big)
        asset = client.post("/api/assets", content=big)
    assert over.status_code == 413 and over.json()["error"] == "body_too_large"
    assert asset.status_code == 413 and asset.json()["error"] == "asset_too_large"
    assert recorder.calls == []


def test_a_post_without_a_content_length_is_413() -> None:
    app, recorder = recorded_app()
    with TestClient(app) as client:
        response = client.post(f"/api/specters/{BID}/portrait", content=iter([b"{}"]))
    assert response.status_code == 413
    assert recorder.calls == []


@pytest.mark.parametrize(
    "body",
    [
        b"not json",
        b"[]",
        b"7",
        b'{"expectedVersion": 1, "assetId": null, "extra": 1}',
        b'{"expectedVersion": 1}',
        b'{"assetId": null}',
        b"{}",
    ],
    ids=["text", "list", "number", "extra-key", "missing-asset", "missing-version", "empty"],
)
def test_a_wrong_portrait_body_is_400_invalid_body(body: bytes) -> None:
    app, recorder = recorded_app()
    target = f"/api/specters/{BID}/portrait"
    with TestClient(app) as client:
        response = client.post(target, content=body, headers=signed("POST", target, body))
    assert response.status_code == 400
    assert response.json() == {"contractVersion": 1, "error": "invalid_body"}
    assert recorder.calls == []


def test_an_upload_body_that_is_not_json_is_400() -> None:
    app, recorder = recorded_app()
    raw = b"{nope"
    with TestClient(app) as client:
        response = client.post(
            "/api/assets", content=raw, headers=signed("POST", "/api/assets", raw)
        )
    assert response.status_code == 400
    assert recorder.calls == []


@pytest.mark.parametrize("bad_id", ["a.b", "%20", "x" * 65, "bnd_short"])
def test_malformed_ids_give_the_same_404_as_unknown_ones(rig: tuple[Rig, Api], bad_id: str) -> None:
    _, api = rig
    unknown = api.get(f"/api/specters/{'bnd_' + 'f' * 24}")
    assert unknown.status_code == 404
    assert unknown.json()["error"] == "unknown_binding"
    for target in (f"/api/specters/{bad_id}", f"/api/assets/{bad_id}"):
        response = api.get(target)
        assert response.status_code == 404, target
        assert response.headers["x-content-type-options"] == "nosniff"
    assert api.get(f"/api/specters/{bad_id}").status_code == unknown.status_code


def test_the_whole_flow_over_http_validates_against_the_contracts_and_writes_no_other_rows(
    rig: tuple[Rig, Api],
) -> None:
    made, api = rig
    other = bind(made.store, BETA, "Second Bot")
    before = table_counts(made.store, except_prefixes=AVATAR_TABLES)
    errors = validator("api-error")

    listing = api.get("/api/specters")
    assert listing.status_code == 200
    validator("specters", 2)(listing.json())
    assert [item["displayName"] for item in listing.json()["items"]] == ["Vell", "Stitch"]
    assert [item["bindingId"] for item in listing.json()["items"]] == [made.binding, other]

    one = api.get(f"/api/specters/{made.binding}")
    validator("specter", 2)(one.json())
    assert one.json()["version"] == 0 and one.json()["avatarChosen"] is False

    upload = api.post(
        "/api/assets",
        {
            "mediaType": "image/png",
            "dataBase64": base64.b64encode(png(8, 8)).decode(),
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
    validator("portrait-asset")(fetched.json())
    assert fetched.json()["dataBase64"] is not None

    chosen = api.post(
        f"/api/specters/{made.binding}/portrait", {"expectedVersion": 0, "assetId": asset_id}
    )
    assert chosen.status_code == 200, chosen.text
    validator("specter", 2)(chosen.json())
    assert chosen.json()["portrait"]["assetId"] == asset_id
    assert chosen.json()["avatarChosen"] is True and chosen.json()["version"] == 1

    stale = api.post(
        f"/api/specters/{made.binding}/portrait", {"expectedVersion": 0, "assetId": None}
    )
    assert stale.status_code == 409
    errors(stale.json())

    reset = api.post(
        f"/api/specters/{made.binding}/portrait", {"expectedVersion": 1, "assetId": None}
    )
    assert reset.status_code == 200
    validator("specter", 2)(reset.json())
    assert reset.json()["avatarChosen"] is False and reset.json()["version"] == 2
    assert reset.json()["portrait"]["assetId"] != asset_id

    missing = api.post(
        f"/api/specters/{made.binding}/portrait", {"expectedVersion": 2, "assetId": AID}
    )
    assert missing.status_code == 404 and missing.json()["error"] == "unknown_asset"

    assert table_counts(made.store, except_prefixes=AVATAR_TABLES) == before


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
