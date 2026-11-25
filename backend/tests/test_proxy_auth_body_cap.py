"""`@signed` bounds the body it buffers before it checks the signature (FP-14-AC02)."""

import asyncio
import hashlib
import hmac
import json
import secrets
import time
from typing import Any

import pytest
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route
from starlette.testclient import TestClient
from starlette.types import Message

from backend.specter_arena.proxy_auth import MAX_BODY_BYTES, signed

KEY = "body-cap-test-key"
CHUNK = 64 * 1024


@signed
async def echo(request: Request) -> Response:
    raw = await request.body()
    return JSONResponse({"length": len(raw), "again": len(await request.body())})


def build() -> Starlette:
    methods = ["GET", "POST"]
    return Starlette(routes=[Route("/api/echo", echo, methods=methods)])


def signature(method: str, target: str, body: bytes) -> dict[str, str]:
    stamp = str(int(time.time()))
    nonce = secrets.token_hex(16)
    message = f"v2:{stamp}:{nonce}:{method}:{target}:{hashlib.sha256(body).hexdigest()}"
    mac = hmac.new(KEY.encode(), message.encode(), hashlib.sha256).hexdigest()
    return {"X-KiroCrew-Proxy-V2": f"{stamp}:{mac}", "X-KiroCrew-Proxy-Nonce": nonce}


@pytest.fixture(autouse=True)
def proxy_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KIROCREW_PROXY_SECRET", KEY)


async def drive(
    path: str, method: str, headers: list[tuple[bytes, bytes]], chunks: int
) -> tuple[int, dict[str, Any], int]:
    """Run the app over raw ASGI with `chunks` body frames; return status, JSON, frames read."""
    state = {"read": 0}
    sent: list[Message] = []

    async def receive() -> Message:
        if state["read"] >= chunks:
            return {"type": "http.disconnect"}
        state["read"] += 1
        return {
            "type": "http.request",
            "body": b"x" * CHUNK,
            "more_body": state["read"] < chunks,
        }

    async def send(message: Message) -> None:
        sent.append(message)

    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "headers": headers,
        "scheme": "http",
        "server": ("127.0.0.1", 1),
        "client": ("127.0.0.1", 2),
        "http_version": "1.1",
    }
    await build()(scope, receive, send)
    status = next(m["status"] for m in sent if m["type"] == "http.response.start")
    body = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return status, json.loads(body), state["read"]


@pytest.mark.parametrize("method", ["GET", "POST"])
def test_an_oversize_chunked_body_is_413_after_the_cap_not_after_the_whole_body(
    method: str,
) -> None:
    frames = (MAX_BODY_BYTES // CHUNK) * 40
    status, body, read = asyncio.run(drive("/api/echo", method, [], frames))
    assert status == 413 and body["error"] == "body_too_large"
    assert read <= MAX_BODY_BYTES // CHUNK + 2


def test_an_oversize_declared_length_is_413_without_reading_any_body() -> None:
    length = str(MAX_BODY_BYTES + 1).encode()
    status, body, read = asyncio.run(drive("/api/echo", "GET", [(b"content-length", length)], 1000))
    assert status == 413 and body["error"] == "body_too_large"
    assert read == 0


def test_a_malformed_content_length_is_ignored_and_the_streamed_count_still_caps() -> None:
    header = [(b"content-length", b"abc")]
    status, _, _ = asyncio.run(drive("/api/echo", "GET", header, 1))
    assert status == 401
    frames = (MAX_BODY_BYTES // CHUNK) * 40
    status, body, read = asyncio.run(drive("/api/echo", "GET", header, frames))
    assert status == 413 and body["error"] == "body_too_large"
    assert read <= MAX_BODY_BYTES // CHUNK + 2


def test_the_assets_path_keeps_its_own_error_code() -> None:
    app = Starlette(routes=[Route("/api/assets", echo, methods=["POST"])])
    big = b"x" * (MAX_BODY_BYTES + 1)
    response = TestClient(app).post("/api/assets", content=big)
    assert response.status_code == 413 and response.json()["error"] == "asset_too_large"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_a_body_at_the_cap_is_verified_and_reaches_the_handler_twice_readable() -> None:
    raw = b"x" * MAX_BODY_BYTES
    headers = signature("POST", "/api/echo", raw)
    response = TestClient(build()).post("/api/echo", content=raw, headers=headers)
    assert response.status_code == 200
    assert response.json() == {"length": MAX_BODY_BYTES, "again": MAX_BODY_BYTES}


def test_a_small_signed_get_is_unchanged() -> None:
    headers = signature("GET", "/api/echo", b"")
    response = TestClient(build()).get("/api/echo", headers=headers)
    assert response.status_code == 200 and response.json()["length"] == 0


def test_a_tampered_body_within_the_cap_is_still_401() -> None:
    headers = signature("POST", "/api/echo", b"original")
    response = TestClient(build()).post("/api/echo", content=b"tampered", headers=headers)
    assert response.status_code == 401
    assert response.json() == {"contractVersion": 1, "error": "unauthorized"}


def test_a_missing_secret_is_still_503_before_the_body_is_read(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("KIROCREW_PROXY_SECRET")
    response = TestClient(build()).get("/api/echo")
    assert response.status_code == 503 and response.json()["error"] == "proxy_secret_missing"
