from __future__ import annotations

import asyncio
import http.client
import json
import logging
import time
from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from typing import Protocol
from urllib.parse import quote, urlencode, urlparse

from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import ConnectionClosed, InvalidStatus, WebSocketException

from ..config import GatewayEnv
from .vocabulary import LIMITS

DEFAULT_APP_NAME = "specter-arena"
HTTP_TIMEOUT_SECONDS = 15.0
OPEN_TIMEOUT_SECONDS = 15.0
POLICY_CLOSE_CODE = 1008
REJECTED_STATUSES = frozenset({401, 403})
SERVER_ERROR_FLOOR = 500

# The websocket library logs request lines at DEBUG, and ours carry the token in the query.
_SILENT = logging.getLogger("specter_arena.collector.gateway")
_SILENT.disabled = True


class AuthRejected(Exception):
    """The gateway refused the credential: HTTP 401/403 on any call, or a rejected exchange.

    `status` is 0 when no request was made (no secret configured).
    """

    def __init__(self, status: int, *, exchange: bool = False) -> None:
        super().__init__(f"auth rejected (status {status}, exchange={exchange})")
        self.status = status
        self.exchange = exchange


class PolicyClose(Exception):
    """The feed was closed with code 1008: the host disabled the app or withdrew its scope."""


class Transient(Exception):
    """A failure a retry may fix: connection error, timeout, 5xx or any other protocol error."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class MalformedAnswer(Exception):
    """A 200 whose body is not JSON, or is larger than the body cap."""


class Feed(Protocol):
    async def recv(self) -> str | bytes: ...


class GatewayPort(Protocol):
    async def exchange_token(self) -> None: ...

    async def get_json(self, path: str) -> object: ...

    def open_feed(self) -> AbstractAsyncContextManager[Feed]: ...

    @property
    def token_age_s(self) -> float: ...


def _send(
    method: str, origin: str, target: str, headers: dict[str, str], body: bytes | None
) -> tuple[int, bytes, bool]:
    """One request, no redirects, no proxy. Returns status, body (capped) and whether it overran.

    Errors name only the exception type, never a URL, so the token cannot reach a message.
    """
    parts = urlparse(origin)
    connection = http.client.HTTPConnection(
        parts.hostname or "", parts.port, timeout=HTTP_TIMEOUT_SECONDS
    )
    try:
        connection.request(method, target, body, headers)
        response = connection.getresponse()
        data = response.read(LIMITS.http_body_max_bytes + 1)
        return (
            response.status,
            data[: LIMITS.http_body_max_bytes],
            len(data) > LIMITS.http_body_max_bytes,
        )
    except (OSError, http.client.HTTPException) as error:
        raise Transient(type(error).__name__) from None
    finally:
        connection.close()


class _WsFeed:
    def __init__(self, connection: ClientConnection) -> None:
        self._connection = connection

    async def recv(self) -> str | bytes:
        try:
            return await self._connection.recv()
        except ConnectionClosed as closed:
            if closed.rcvd is not None and closed.rcvd.code == POLICY_CLOSE_CODE:
                raise PolicyClose from None
            raise Transient("ConnectionClosed") from None
        except (OSError, WebSocketException) as error:
            raise Transient(type(error).__name__) from None


class GatewayClient:
    """The collector's own gateway client. Query-token transport only, one credential source.

    No cookie transport, no bearer transport, no read of any file or other secret.
    """

    def __init__(self, env: GatewayEnv, *, clock: Callable[[], float] = time.monotonic) -> None:
        self._env = env
        self._origin = env.origin.rstrip("/")
        self._clock = clock
        self._token = ""
        self._token_at = 0.0

    @property
    def token_age_s(self) -> float:
        return self._clock() - self._token_at if self._token else float("inf")

    async def exchange_token(self) -> None:
        if not self._env.secret:
            raise AuthRejected(0, exchange=True)
        target = f"/api/apps/{quote(self._env.app_name or DEFAULT_APP_NAME, safe='')}/token"
        headers = {"X-App-Secret": self._env.secret}
        status, body, _ = await asyncio.to_thread(_send, "POST", self._origin, target, headers, b"")
        if status >= SERVER_ERROR_FLOOR:
            raise Transient(f"exchange-{status}")
        token = self._token_from(body) if status == 200 else ""
        if not token:
            raise AuthRejected(status, exchange=True)
        self._token, self._token_at = token, self._clock()

    @staticmethod
    def _token_from(body: bytes) -> str:
        try:
            token = json.loads(body).get("token")
        except (ValueError, AttributeError):
            return ""
        return token if isinstance(token, str) else ""

    async def _ensure_token(self) -> str:
        if not self._token:
            await self.exchange_token()
        return self._token

    async def get_json(self, path: str) -> object:
        if not path.startswith("/api/"):
            raise ValueError("path must start with /api/")
        token = await self._ensure_token()
        separator = "&" if "?" in path else "?"
        target = f"{path}{separator}{urlencode({'token': token})}"
        status, body, overran = await asyncio.to_thread(
            _send, "GET", self._origin, target, {}, None
        )
        if status in REJECTED_STATUSES:
            raise AuthRejected(status)
        if status >= SERVER_ERROR_FLOOR:
            raise Transient(f"http-{status}")
        if status != 200 or overran:
            raise MalformedAnswer
        try:
            return json.loads(body)
        except ValueError:
            raise MalformedAnswer from None

    @asynccontextmanager
    async def open_feed(self) -> AsyncIterator[Feed]:
        token = await self._ensure_token()
        ws_origin = "ws" + self._origin[len("http") :]
        url = f"{ws_origin}/api/ws?{urlencode({'token': token})}"
        try:
            connection = await connect(
                url,
                max_size=LIMITS.ws_max_size,
                open_timeout=OPEN_TIMEOUT_SECONDS,
                logger=_SILENT,
            )
        except InvalidStatus as refusal:
            status = refusal.response.status_code
            if status in REJECTED_STATUSES:
                raise AuthRejected(status) from None
            raise Transient(f"handshake-{status}") from None
        except (OSError, TimeoutError, WebSocketException) as error:
            raise Transient(type(error).__name__) from None
        async with connection:
            yield _WsFeed(connection)
