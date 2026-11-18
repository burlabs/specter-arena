"""`GET /api/scene-assets/{key}`: signed, read only, static bytes, no store and no service."""

import base64
import hashlib
from collections.abc import Iterator
from typing import Any

import pytest
from starlette.applications import Starlette
from starlette.testclient import TestClient

from backend.specter_arena import specter_routes as routes
from backend.specter_arena.specters import scene_art

from .contract_support import compile_schema, load_registry
from .test_specter_routes import SECRET, Api, signed

REGISTRY = load_registry()
SCENE_SCHEMA = compile_schema("urn:specter-arena:contract:scene-asset:v1", REGISTRY)
ERROR_SCHEMA = compile_schema("urn:specter-arena:contract:api-error:v1", REGISTRY)
KEYS = [art.key for art in scene_art.SCENE]


@pytest.fixture(autouse=True)
def proxy_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KIROCREW_PROXY_SECRET", SECRET)


@pytest.fixture
def client() -> Iterator[TestClient]:
    app = Starlette(routes=routes.specter_routes())
    app.state.specters = None  # the scene route needs no service and no store
    with TestClient(app) as test_client:
        yield test_client


@pytest.mark.parametrize("key", KEYS)
def test_a_signed_get_serves_each_key_as_a_valid_scene_asset(client: TestClient, key: str) -> None:
    response = Api(client).get(f"/api/scene-assets/{key}")
    assert response.status_code == 200
    assert response.headers["x-content-type-options"] == "nosniff"
    body = response.json()
    SCENE_SCHEMA(body)
    raw = base64.b64decode(body["dataBase64"], validate=True)
    assert body["key"] == key
    assert body["sha256"] == hashlib.sha256(raw).hexdigest()
    assert body["byteLength"] == len(raw)


def test_unsigned_is_401_and_other_methods_are_405(client: TestClient) -> None:
    target = "/api/scene-assets/arena-map"
    assert client.get(target).status_code == 401
    for method in ("POST", "PUT", "DELETE"):
        response = client.request(method, target, headers=signed(method, target))
        assert response.status_code == 405
    assert Api(client).get("/api/scene-assets").status_code == 404  # no list route


@pytest.mark.parametrize(
    "key", ["nope", "arena-map.png", "Arena-Map", "a" * 65, "%20", "a..b", "1map", "-map"]
)
def test_an_unknown_or_malformed_key_is_404_unknown_scene_asset(
    client: TestClient, key: str
) -> None:
    response = Api(client).get(f"/api/scene-assets/{key}")
    assert response.status_code == 404
    assert response.json() == {"contractVersion": 1, "error": "unknown_scene_asset"}
    ERROR_SCHEMA(response.json())


def test_a_key_whose_file_failed_verification_is_never_served(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(scene_art, "_served", lambda: {})
    response = Api(client).get("/api/scene-assets/arena-map")
    assert response.status_code == 404
    assert response.json()["error"] == "unknown_scene_asset"


def test_a_loader_failure_is_not_swallowed(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(_: str) -> dict[str, Any] | None:
        raise scene_art.SceneArtError("arena-map")

    monkeypatch.setattr(scene_art, "get_scene_asset", broken)
    with pytest.raises(scene_art.SceneArtError):
        Api(client).get("/api/scene-assets/arena-map")
