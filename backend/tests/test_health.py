from starlette.testclient import TestClient

from backend.app import app


def test_health_returns_ok_without_redirect() -> None:
    response = TestClient(app).get("/health", follow_redirects=False)
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_needs_no_credentials() -> None:
    response = TestClient(app).get("/health", headers={})
    assert response.status_code == 200
    assert "www-authenticate" not in response.headers


def test_health_rejects_other_methods() -> None:
    assert TestClient(app).post("/health").status_code == 405
