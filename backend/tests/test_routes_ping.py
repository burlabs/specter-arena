import hashlib
import hmac
import secrets
import time

import pytest
from starlette.testclient import TestClient

from backend.app import app

SECRET = "route-test-secret"


def sign_headers(
    target: str = "/api/ping",
    *,
    method: str = "GET",
    secret: str = SECRET,
    ts: int | None = None,
    nonce: str | None = None,
) -> dict[str, str]:
    stamp = str(int(time.time()) if ts is None else ts)
    nonce = nonce or secrets.token_hex(16)
    message = f"v2:{stamp}:{nonce}:{method}:{target}:{hashlib.sha256(b'').hexdigest()}"
    mac = hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()
    return {"X-KiroCrew-Proxy-V2": f"{stamp}:{mac}", "X-KiroCrew-Proxy-Nonce": nonce}


@pytest.fixture(autouse=True)
def proxy_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KIROCREW_PROXY_SECRET", SECRET)


def test_signed_ping_returns_the_ok_shape() -> None:
    response = TestClient(app).get("/api/ping", headers=sign_headers())
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"ok", "app", "at"}
    assert body["ok"] is True
    assert body["app"] == "specter-arena"
    assert isinstance(body["at"], str)


def test_unsigned_ping_is_401() -> None:
    response = TestClient(app).get("/api/ping")
    assert response.status_code == 401
    assert response.json() == {"error": "unauthorized"}


def test_ping_with_a_bad_signature_is_401() -> None:
    headers = sign_headers(secret="not-the-secret")
    assert TestClient(app).get("/api/ping", headers=headers).status_code == 401


def test_ping_with_a_stale_timestamp_is_401() -> None:
    headers = sign_headers(ts=int(time.time()) - 120)
    assert TestClient(app).get("/api/ping", headers=headers).status_code == 401


def test_ping_replay_is_401() -> None:
    client = TestClient(app)
    headers = sign_headers()
    assert client.get("/api/ping", headers=headers).status_code == 200
    assert client.get("/api/ping", headers=headers).status_code == 401


def test_ping_signed_for_another_target_is_401() -> None:
    headers = sign_headers("/api/other")
    assert TestClient(app).get("/api/ping", headers=headers).status_code == 401


def test_ping_verifies_the_raw_percent_encoded_query() -> None:
    target = "/api/ping?q=a%20b"
    response = TestClient(app).get(target, headers=sign_headers(target))
    assert response.status_code == 200


def test_ping_without_a_configured_secret_is_503(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("KIROCREW_PROXY_SECRET")
    response = TestClient(app).get("/api/ping", headers=sign_headers())
    assert response.status_code == 503
    assert response.json() == {"error": "proxy_secret_missing"}


def test_responses_never_contain_the_secret() -> None:
    client = TestClient(app)
    for response in (
        client.get("/api/ping", headers=sign_headers()),
        client.get("/api/ping"),
    ):
        assert SECRET not in response.text
        assert SECRET not in str(response.headers)


def test_health_stays_unauthenticated_with_a_secret_configured() -> None:
    response = TestClient(app).get("/health", follow_redirects=False)
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_ping_rejects_other_methods() -> None:
    assert TestClient(app).post("/api/ping").status_code == 405
