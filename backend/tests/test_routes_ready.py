from collections.abc import Iterator
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from backend.app import app
from backend.specter_arena.store import StoreStatus, latest_version
from backend.specter_arena.store_runtime import StoreRuntime
from backend.tests.test_routes_ping import SECRET, sign_headers

READY_KEYS = {"contractVersion", "status", "store", "storeVersion", "latestVersion"}
LATEST = latest_version()


@pytest.fixture(autouse=True)
def proxy_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KIROCREW_PROXY_SECRET", SECRET)


@pytest.fixture
def use_runtime() -> Iterator[None]:
    original = app.state.store_runtime
    yield
    app.state.store_runtime = original


def get_ready(client: TestClient) -> tuple[int, dict[str, object]]:
    response = client.get("/api/ready", headers=sign_headers("/api/ready"))
    return response.status_code, response.json()


class FixedRuntime:
    probe_on = False

    def __init__(self, status: StoreStatus) -> None:
        self.status = status

    async def refresh(self) -> StoreStatus:
        return self.status


def test_a_ready_store_answers_200_with_the_ready_v1_body(use_runtime: None) -> None:
    app.state.store_runtime = FixedRuntime(StoreStatus("ready", LATEST, LATEST))
    status, body = get_ready(TestClient(app))
    assert status == 200
    assert body == {
        "contractVersion": 1,
        "status": "ready",
        "store": "ready",
        "storeVersion": LATEST,
        "latestVersion": LATEST,
    }


@pytest.mark.parametrize(
    "state", ["unconfigured", "migrating", "schema-newer", "sqlite-too-old", "unavailable"]
)
def test_every_other_state_answers_503_with_the_state_word(use_runtime: None, state: str) -> None:
    app.state.store_runtime = FixedRuntime(StoreStatus(state, None, LATEST))  # type: ignore[arg-type]
    status, body = get_ready(TestClient(app))
    assert status == 503
    assert set(body) == READY_KEYS
    assert (body["status"], body["store"], body["latestVersion"]) == ("not-ready", state, LATEST)
    assert isinstance(body["latestVersion"], int) and body["contractVersion"] == 1


def test_under_the_probe_switch_the_body_is_the_disabled_literal(use_runtime: None) -> None:
    app.state.store_runtime = StoreRuntime(probe_on=True, environ={})
    status, body = get_ready(TestClient(app))
    assert status == 503
    assert body == {
        "contractVersion": 1,
        "status": "not-ready",
        "store": "disabled",
        "storeVersion": None,
        "latestVersion": None,
    }


def test_a_real_store_under_a_crew_home_is_ready_end_to_end(
    use_runtime: None, tmp_path: Path
) -> None:
    env = {"KIROCREW_HOME": str(tmp_path), "KIROCREW_APP_NAME": "specter-arena"}
    app.state.store_runtime = StoreRuntime(probe_on=False, environ=env)
    with TestClient(app) as client:
        status, body = get_ready(client)
        health = client.get("/health").status_code
    assert (status, body["store"], health) == (200, "ready", 200)


def test_an_empty_environment_is_unconfigured_and_health_stays_200(use_runtime: None) -> None:
    app.state.store_runtime = StoreRuntime(probe_on=False, environ={})
    with TestClient(app) as client:
        status, body = get_ready(client)
        assert client.get("/health").status_code == 200
    assert (status, body["store"]) == (503, "unconfigured")


def test_health_stays_200_while_the_store_is_unavailable(use_runtime: None) -> None:
    app.state.store_runtime = FixedRuntime(StoreStatus("unavailable", None, LATEST))
    client = TestClient(app)
    assert client.get("/health").status_code == 200
    assert get_ready(client)[0] == 503


def test_unsigned_and_wrong_method_requests_are_refused_without_detail() -> None:
    client = TestClient(app)
    unsigned = client.get("/api/ready")
    assert (unsigned.status_code, unsigned.json()) == (
        401,
        {"contractVersion": 1, "error": "unauthorized"},
    )
    assert client.post("/api/ready").status_code == 405


def test_no_ready_body_carries_a_path_or_traceback(use_runtime: None, tmp_path: Path) -> None:
    client = TestClient(app)
    bodies = [client.get("/api/ready").text]
    for runtime in (
        StoreRuntime(probe_on=True, environ={}),
        FixedRuntime(StoreStatus("unavailable", None, LATEST)),
        StoreRuntime(probe_on=False, environ={"KIROCREW_HOME": str(tmp_path)}),
    ):
        app.state.store_runtime = runtime
        bodies.append(client.get("/api/ready", headers=sign_headers("/api/ready")).text)
    for text in bodies:
        assert "/" not in text and ".sqlite" not in text and "Traceback" not in text, text
