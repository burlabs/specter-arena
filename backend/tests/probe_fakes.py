import asyncio
import hashlib
import hmac
import json
import secrets
import time
from collections.abc import AsyncIterator

from backend.specter_arena.probe.steps import FeedRejected, TokenExchangeError

SECRET = "probe-route-test-secret"
NOW = "2026-11-09T12:00:00+00:00"

Response = tuple[int, bytes] | BaseException


def json_body(value: object) -> bytes:
    return json.dumps(value).encode()


def error_body(message: str = "forbidden") -> bytes:
    return json_body({"error": message})


def slot_row(key: str, **overrides: object) -> dict[str, object]:
    """A slot row built only from fields the host's slot projection ships."""
    row: dict[str, object] = {
        "key": key,
        "title": "a title",
        "agent": "kiro",
        "running": False,
        "pending_approval": False,
        "needs_input": False,
        "last_activity_ts": 100.0,
        "wait_state": "",
        "last_message": "",
        "created_by": "",
        "lineage_minted": False,
        "source_links": [],
        "origin": "chat",
        "folder_id": "folder-1",
    }
    row.update(overrides)
    return row


def slots_frame(*rows: dict[str, object]) -> dict[str, object]:
    return {"type": "slots", "data": list(rows)}


def prose_row(key: str, text: str, **overrides: object) -> dict[str, object]:
    """A slot row whose prose-bearing fields all hold `text`."""
    return slot_row(
        key,
        messages=[{"role": "user", "content": text}],
        last_message=text,
        prompt_preview=text,
        welcome_message=text,
        options=[text],
        wait_state="waiting",
        source_links=[{"url": "u"}],
        **overrides,
    )


def event_frame(event_type: str, **data: object) -> dict[str, object]:
    return {"type": event_type, "data": data}


class FakePort:
    """A scripted `GatewayPort`: canned HTTP answers and a canned feed."""

    def __init__(
        self,
        responses: dict[tuple[str, str], Response] | None = None,
        *,
        frames: list[dict[str, object]] | None = None,
        token: str | BaseException = "a-token-value",
        feed_error: BaseException | None = None,
        hang: bool = False,
        transport: str | None = "query",
    ) -> None:
        self.responses = responses or {}
        self.frames = frames or []
        self.token = token
        self.feed_error = feed_error
        self.hang = hang
        self._transport = transport
        self.calls: list[tuple[str, str, bool, bool]] = []
        self.bodies: list[bytes | None] = []
        self.closed = False

    @property
    def token_transport(self) -> str | None:
        return self._transport

    async def exchange_token(self) -> str:
        if isinstance(self.token, BaseException):
            raise self.token
        return self.token

    async def http(
        self,
        method: str,
        path: str,
        body: bytes | None = None,
        *,
        token: bool = True,
        local: bool = False,
    ) -> tuple[int, bytes]:
        self.calls.append((method, path, token, local))
        self.bodies.append(body)
        answer = self.responses.get((method, path), (404, error_body("not_found")))
        if isinstance(answer, BaseException):
            raise answer
        return answer

    def open_feed(self) -> AsyncIterator[dict[str, object]]:
        return self._feed()

    async def _feed(self) -> AsyncIterator[dict[str, object]]:
        try:
            if self.feed_error is not None:
                raise self.feed_error
            for frame in self.frames:
                yield frame
            if self.hang:
                await asyncio.sleep(30)
        finally:
            self.closed = True


def rejected(status: int) -> FeedRejected:
    return FeedRejected(status)


def exchange_refused(status: int | None) -> TokenExchangeError:
    return TokenExchangeError(status)


def sign_headers(
    target: str, *, method: str = "GET", body: bytes = b"", secret: str = SECRET
) -> dict[str, str]:
    stamp = str(int(time.time()))
    nonce = secrets.token_hex(16)
    message = f"v2:{stamp}:{nonce}:{method}:{target}:{hashlib.sha256(body).hexdigest()}"
    mac = hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()
    return {"X-KiroCrew-Proxy-V2": f"{stamp}:{mac}", "X-KiroCrew-Proxy-Nonce": nonce}
