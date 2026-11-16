from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import fastjsonschema
import pytest
from starlette.testclient import TestClient

from backend.app import app
from backend.specter_arena.store import StoreStatus, latest_version
from backend.specter_arena.store_runtime import StoreRuntime
from backend.tests.contract_support import compile_schema, load_registry
from backend.tests.test_routes_ping import SECRET, sign_headers
from backend.tests.test_routes_ready import FixedRuntime

READY_V1 = "urn:specter-arena:contract:ready:v1"
API_ERROR_V1 = "urn:specter-arena:contract:api-error:v1"
LATEST = latest_version()


@pytest.fixture(scope="module")
def validator() -> Callable[[str], Callable[[Any], Any]]:
    registry = load_registry()
    return lambda schema_id: compile_schema(schema_id, registry)


@pytest.fixture(autouse=True)
def proxy_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KIROCREW_PROXY_SECRET", SECRET)


@pytest.fixture
def restore_runtime() -> Iterator[None]:
    original = app.state.store_runtime
    yield
    app.state.store_runtime = original


def ready_body(client: TestClient) -> tuple[int, Any]:
    response = client.get("/api/ready", headers=sign_headers("/api/ready"))
    return response.status_code, response.json()


@pytest.mark.parametrize(
    "status",
    [
        StoreStatus("ready", LATEST, LATEST),
        StoreStatus("unconfigured", None, LATEST),
        StoreStatus("migrating", None, LATEST),
        StoreStatus("schema-newer", LATEST + 1, LATEST),
        StoreStatus("sqlite-too-old", None, LATEST),
        StoreStatus("unavailable", None, LATEST),
    ],
    ids=lambda status: status.state,
)
def test_every_real_ready_body_validates_against_ready_v1(
    restore_runtime: None, validator: Callable[[str], Callable[[Any], Any]], status: StoreStatus
) -> None:
    app.state.store_runtime = FixedRuntime(status)
    code, body = ready_body(TestClient(app))
    assert code == (200 if status.state == "ready" else 503)
    validator(READY_V1)(body)


def test_the_probe_switch_body_validates_against_ready_v1(
    restore_runtime: None, validator: Callable[[str], Callable[[Any], Any]]
) -> None:
    app.state.store_runtime = StoreRuntime(probe_on=True, environ={})
    code, body = ready_body(TestClient(app))
    assert (code, body["latestVersion"]) == (503, None)
    validator(READY_V1)(body)


def test_a_real_store_ready_body_validates_end_to_end(
    restore_runtime: None, validator: Callable[[str], Callable[[Any], Any]], tmp_path: Path
) -> None:
    env = {"KIROCREW_HOME": str(tmp_path), "KIROCREW_APP_NAME": "specter-arena"}
    app.state.store_runtime = StoreRuntime(probe_on=False, environ=env)
    with TestClient(app) as client:
        code, body = ready_body(client)
    assert (code, body["store"]) == (200, "ready")
    validator(READY_V1)(body)


def test_signed_error_bodies_validate_against_api_error_v1(
    validator: Callable[[str], Callable[[Any], Any]], monkeypatch: pytest.MonkeyPatch
) -> None:
    client = TestClient(app)
    unsigned = client.get("/api/ready")
    monkeypatch.delenv("KIROCREW_PROXY_SECRET")
    missing = client.get("/api/ready", headers=sign_headers("/api/ready"))
    for response in (unsigned, missing):
        validator(API_ERROR_V1)(response.json())
    assert (unsigned.status_code, missing.status_code) == (401, 503)


def test_a_ready_body_that_breaks_the_contract_is_rejected(
    validator: Callable[[str], Callable[[Any], Any]],
) -> None:
    broken = {
        "contractVersion": 1,
        "status": "not-ready",
        "store": "migrating",
        "storeVersion": None,
        "latestVersion": None,
    }
    with pytest.raises(fastjsonschema.JsonSchemaException):
        validator(READY_V1)(broken)
