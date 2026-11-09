# SPECTER-DIAGNOSTIC-ONLY
from __future__ import annotations

import asyncio
import http.client
import json
import logging
import time
from collections.abc import AsyncIterator
from urllib.parse import quote, urlencode, urlparse

from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import InvalidStatus, WebSocketException

from ..config import GatewayEnv
from .steps import FeedRejected, PortError, TokenExchangeError

MARKER = "SPECTER-DIAGNOSTIC-ONLY"

APP_SLUG = "specter-arena"
TRANSPORTS = ("query", "cookie", "bearer")
NOT_AUTHENTICATED = 401
TOKEN_LIFETIME_SECONDS = 45 * 60
BACKOFF_SECONDS = (1, 2, 4, 8, 16, 30)
HTTP_TIMEOUT_SECONDS = 15.0
MAX_BODY_BYTES = 1024 * 1024

# The websocket library logs request lines at DEBUG, and ours carry the token in the query.
_SILENT = logging.getLogger("specter_arena.probe.live")
_SILENT.disabled = True


def _send(
    method: str, origin: str, target: str, headers: dict[str, str], body: bytes | None
) -> tuple[int, bytes]:
    """One request, no redirects and no proxy. Errors name the exception type, never a URL."""
    parts = urlparse(origin)
    connection = http.client.HTTPConnection(
        parts.hostname or "", parts.port, timeout=HTTP_TIMEOUT_SECONDS
    )
    try:
        connection.request(method, target, body, headers)
        response = connection.getresponse()
        return response.status, response.read(MAX_BODY_BYTES)
    except TimeoutError:
        raise
    except (OSError, http.client.HTTPException) as error:
        raise PortError(f"gateway request failed: {type(error).__name__}") from None
    finally:
        connection.close()


class LiveGateway:
    def __init__(self, env: GatewayEnv) -> None:
        self._env = env
        self._origin = env.origin.rstrip("/")
        self._token, self._token_at = "", 0.0
        self._transport: str | None = None
        self._http_transport: str | None = None

    @property
    def token_transport(self) -> str | None:
        return self._transport

    async def exchange_token(self) -> str:
        if not self._env.secret:
            raise TokenExchangeError(None)
        target = f"/api/apps/{quote(self._env.app_name or APP_SLUG, safe='')}/token"
        headers = {"X-App-Secret": self._env.secret}
        status, body = await asyncio.to_thread(_send, "POST", self._origin, target, headers, b"")
        try:
            token = json.loads(body)["token"] if status == 200 else ""
        except (ValueError, KeyError, TypeError):
            token = ""
        if not token or not isinstance(token, str):
            raise TokenExchangeError(status)
        self._token, self._token_at = token, time.monotonic()
        return token

    def _present(self, transport: str, target: str, token: str) -> tuple[str, dict[str, str]]:
        if transport == "query":
            return f"{target}{'&' if '?' in target else '?'}{urlencode({'token': token})}", {}
        if transport == "cookie":
            return target, {"Cookie": f"mc_token_{urlparse(self._origin).port or 80}={token}"}
        return target, {"Authorization": f"Bearer {token}"}

    async def http(
        self,
        method: str,
        path: str,
        body: bytes | None = None,
        *,
        token: bool = True,
        local: bool = False,
    ) -> tuple[int, bytes]:
        origin = f"http://127.0.0.1:{self._env.port}" if local else self._origin
        headers = {"Content-Type": "application/json"} if body is not None else {}
        if local or not token:
            return await asyncio.to_thread(_send, method, origin, path, headers, body)
        stale = time.monotonic() - self._token_at >= TOKEN_LIFETIME_SECONDS
        credential = await self.exchange_token() if stale or not self._token else self._token
        status, answer = NOT_AUTHENTICATED, b""
        for transport in (self._http_transport,) if self._http_transport else TRANSPORTS:
            target, extra = self._present(transport, path, credential)
            status, answer = await asyncio.to_thread(
                _send, method, origin, target, headers | extra, body
            )
            if status != NOT_AUTHENTICATED:
                self._http_transport = transport
                break
        return status, answer

    async def _dial(self, credential: str) -> ClientConnection:
        ws_origin = "ws" + self._origin[len("http") :]
        known = (self._transport,) if self._transport else TRANSPORTS
        for transport in known:
            target, extra = self._present(transport, "/api/ws", credential)
            try:
                connection = await connect(
                    ws_origin + target, additional_headers=extra, logger=_SILENT
                )
            except InvalidStatus as refusal:
                status = refusal.response.status_code
                if status == NOT_AUTHENTICATED and transport != known[-1]:
                    continue
                raise FeedRejected(status) from None
            self._transport = transport
            return connection
        raise FeedRejected(NOT_AUTHENTICATED)

    async def open_feed(self) -> AsyncIterator[dict[str, object]]:
        failures = 0
        while True:
            try:
                connection = await self._dial(await self.exchange_token())
                failures = 0
                async with connection:
                    renew_at = time.monotonic() + TOKEN_LIFETIME_SECONDS
                    while (left := renew_at - time.monotonic()) > 0:
                        raw = await asyncio.wait_for(connection.recv(), left)
                        try:
                            frame = json.loads(raw) if isinstance(raw, str) else None
                        except ValueError:
                            frame = None
                        if isinstance(frame, dict):
                            yield frame
            except (TimeoutError, OSError, WebSocketException):
                await asyncio.sleep(BACKOFF_SECONDS[min(failures, len(BACKOFF_SECONDS) - 1)])
                failures += 1
