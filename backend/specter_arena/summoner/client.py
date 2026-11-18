from __future__ import annotations

import asyncio
import contextlib
import json
import time
from collections.abc import AsyncIterator, Callable, Mapping
from typing import Any, Final
from urllib.parse import quote, urlencode, urlparse

from ..config import GatewayEnv
from . import MAX_MODEL_LABEL, MAX_REPLY_BYTES, SummonFailure, SummonReply

SUMMON_AGENT: Final = "specter-arena-summoner"
SLOT_PREFIX: Final = "specter-summon-"
SLOT_TITLE: Final = "Specter summoning"
SLOTS_PATH: Final = "/api/chat/slots"
CHAT_PATH: Final = "/api/chat"
DEFAULT_APP_NAME: Final = "specter-arena"
TOKEN_REFRESH_S: Final = 3000.0
CONTROL_TIMEOUT_S: Final = 15.0
CLEANUP_TIMEOUT_S: Final = 10.0
MAX_BODY_BYTES: Final = 1024 * 1024
MAX_CONTROL_BYTES: Final = 64 * 1024
MAX_LINE_BYTES: Final = 64 * 1024
HTTP_UNAUTHORIZED: Final = 401
HTTP_FORBIDDEN: Final = 403
HTTP_SERVER_ERROR: Final = 500
HTTP_OK: Final = 200

Reader = asyncio.StreamReader
Writer = asyncio.StreamWriter
Head = tuple[int, dict[str, str], Reader, Writer]


class _Http:
    """One HTTP/1.1 exchange over asyncio streams: no redirects, no proxy, Connection: close."""

    def __init__(self, origin: str) -> None:
        parts = urlparse(origin)
        if parts.scheme != "http" or not parts.hostname:
            raise SummonFailure("unavailable")
        self.host, self.port = parts.hostname, parts.port or 80

    async def open(
        self,
        method: str,
        target: str,
        body: bytes | None,
        extra_headers: Mapping[str, str] | None = None,
    ) -> Head:
        try:
            reader, writer = await asyncio.open_connection(
                self.host, self.port, limit=MAX_LINE_BYTES
            )
        except OSError:
            raise SummonFailure("unavailable") from None
        try:
            head = [
                f"{method} {target} HTTP/1.1",
                f"Host: {self.host}:{self.port}",
                "Connection: close",
                "Accept: application/json, text/event-stream",
            ]
            head += [f"{name}: {value}" for name, value in (extra_headers or {}).items()]
            if body is not None:
                head += ["Content-Type: application/json", f"Content-Length: {len(body)}"]
            writer.write(("\r\n".join(head) + "\r\n\r\n").encode("ascii") + (body or b""))
            await writer.drain()
            status, headers = await _read_head(reader)
        except (SummonFailure, OSError, asyncio.IncompleteReadError, ValueError):
            writer.close()
            raise SummonFailure("unavailable") from None
        except BaseException:
            writer.close()
            raise
        return status, headers, reader, writer


async def _read_head(reader: Reader) -> tuple[int, dict[str, str]]:
    status_line = await reader.readline()
    try:
        status = int(status_line.split(b" ", 2)[1])
    except (IndexError, ValueError):
        raise SummonFailure("unavailable") from None
    headers: dict[str, str] = {}
    while (line := await reader.readline()) not in (b"\r\n", b"\n", b""):
        name, _, value = line.decode("latin-1").partition(":")
        headers[name.strip().lower()] = value.strip()
    return status, headers


async def _body_chunks(reader: Reader, headers: Mapping[str, str]) -> AsyncIterator[bytes]:
    if headers.get("transfer-encoding", "").lower() == "chunked":
        while True:
            size_line = await reader.readline()
            size = int(size_line.split(b";", 1)[0].strip() or b"0", 16)
            if size == 0:
                return
            if size > MAX_BODY_BYTES:
                raise SummonFailure("malformed")
            yield await reader.readexactly(size)
            await reader.readexactly(2)
    elif "content-length" in headers:
        length = int(headers["content-length"])
        if length > MAX_BODY_BYTES:
            raise SummonFailure("malformed")
        yield await reader.readexactly(length)
    else:
        while chunk := await reader.read(8192):
            yield chunk


def _close(writer: Writer) -> None:
    writer.close()


class CrewChatSummoner:
    """SC6-7 over grant A: create an app-owned slot on the summoner agent, send one turn, read
    its SSE reply, delete the slot. Calls only the four paths above and the token exchange;
    never names another agent. Errors carry a failure code only, never a URL, token or Crew text."""

    def __init__(self, env: GatewayEnv, *, clock: Callable[[], float] = time.monotonic) -> None:
        self._env = env
        self._clock = clock
        self._http = _Http(env.origin.rstrip("/"))
        self._token = ""
        self._token_at = 0.0
        self._exchange_lock = asyncio.Lock()

    async def _exchange(self) -> str:
        async with self._exchange_lock:
            if self._token and self._clock() - self._token_at < TOKEN_REFRESH_S:
                return self._token
            if not self._env.secret:
                raise SummonFailure("unavailable")
            name = quote(self._env.app_name or DEFAULT_APP_NAME, safe="")
            status, data = await self._json_call(
                "POST", f"/api/apps/{name}/token", b"", {"X-App-Secret": self._env.secret}
            )
            token = data.get("token") if status == HTTP_OK and isinstance(data, dict) else None
            if not isinstance(token, str) or not token:
                refused = status in (HTTP_UNAUTHORIZED, HTTP_FORBIDDEN)
                raise SummonFailure("refused" if refused else "unavailable")
            self._token, self._token_at = token, self._clock()
            return token

    @staticmethod
    def _target(path: str, token: str) -> str:
        return f"{path}?{urlencode({'token': token})}"

    async def _json_call(
        self,
        method: str,
        target: str,
        body: bytes | None,
        extra_headers: Mapping[str, str] | None = None,
    ) -> tuple[int, Any]:
        """One small JSON request bounded by CONTROL_TIMEOUT_S; (status, parsed dict or None)."""
        try:
            async with asyncio.timeout(CONTROL_TIMEOUT_S):
                status, headers, reader, writer = await self._http.open(
                    method, target, body, extra_headers
                )
                try:
                    raw = b""
                    async for chunk in _body_chunks(reader, headers):
                        raw += chunk
                        if len(raw) > MAX_CONTROL_BYTES:
                            raise SummonFailure("malformed")
                finally:
                    _close(writer)
        except TimeoutError:
            raise SummonFailure("unavailable") from None
        except (OSError, asyncio.IncompleteReadError, ValueError):
            raise SummonFailure("unavailable") from None
        try:
            parsed = json.loads(raw)
        except ValueError:
            return status, None
        return status, parsed if isinstance(parsed, dict) else None

    async def _authed(
        self, method: str, path: str, payload: dict[str, Any] | None
    ) -> tuple[int, Any]:
        """One retry after a 401 with a fresh token; 403 is refused; 5xx is unavailable."""
        body = None if payload is None else json.dumps(payload).encode()
        for attempt in (1, 2):
            token = await self._exchange()
            status, data = await self._json_call(method, self._target(path, token), body)
            if status == HTTP_UNAUTHORIZED and attempt == 1:
                self._token = ""
                continue
            if status == HTTP_FORBIDDEN:
                raise SummonFailure("refused")
            if status >= HTTP_SERVER_ERROR or status == HTTP_UNAUTHORIZED:
                raise SummonFailure("unavailable")
            return status, data
        raise SummonFailure("unavailable")  # pragma: no cover

    async def summon(self, prompt: str, *, request_id: str, timeout_s: float) -> SummonReply:
        slot = SLOT_PREFIX + request_id
        deadline = asyncio.get_running_loop().time() + timeout_s
        created = False
        try:
            async with asyncio.timeout_at(deadline):
                status, row = await self._authed(
                    "POST",
                    SLOTS_PATH,
                    {
                        "name": slot,
                        "agent": SUMMON_AGENT,
                        "agent_kind": "template",
                        "memory_mode": "temporary",
                        "title": SLOT_TITLE,
                    },
                )
                if status != HTTP_OK or not isinstance(row, dict):
                    raise SummonFailure("unavailable")
                created = True
                if (
                    row.get("key") != slot
                    or row.get("agent") != SUMMON_AGENT
                    or row.get("agent_kind") != "template"
                ):
                    raise SummonFailure("unavailable")
                text = await self._stream_turn(slot, prompt)
            label = row.get("served_model") or row.get("model") or ""
            label = label[:MAX_MODEL_LABEL] if isinstance(label, str) else ""
            return SummonReply(text=text, model_label=label)
        except TimeoutError:
            await self._stop(slot, created)
            raise SummonFailure("timeout") from None
        except asyncio.CancelledError:
            await self._stop(slot, created)
            raise
        finally:
            if created:
                await self._delete(slot)

    async def _stream_turn(self, slot: str, prompt: str) -> str:
        token = await self._exchange()
        body = json.dumps({"message": prompt, "slot": slot, "agent": SUMMON_AGENT}).encode()
        status, headers, reader, writer = await self._http.open(
            "POST", self._target(CHAT_PATH, token), body
        )
        try:
            if status == HTTP_FORBIDDEN:
                raise SummonFailure("refused")
            if status != HTTP_OK or not headers.get("content-type", "").startswith(
                "text/event-stream"
            ):
                raise SummonFailure("unavailable")
            try:
                return await _read_reply(_body_chunks(reader, headers))
            except (OSError, asyncio.IncompleteReadError, ValueError):
                raise SummonFailure("unavailable") from None
        finally:
            _close(writer)
            with contextlib.suppress(Exception):
                await writer.wait_closed()

    async def _stop(self, slot: str, created: bool) -> None:
        if created:
            with contextlib.suppress(Exception):
                await asyncio.wait_for(
                    self._authed("POST", f"{SLOTS_PATH}/{quote(slot, safe='')}/stop", {}),
                    CLEANUP_TIMEOUT_S,
                )

    async def _delete(self, slot: str) -> None:
        with contextlib.suppress(Exception):
            await asyncio.wait_for(
                self._authed("DELETE", f"{SLOTS_PATH}/{quote(slot, safe='')}", None),
                CLEANUP_TIMEOUT_S,
            )


async def _read_reply(chunks: AsyncIterator[bytes]) -> str:
    """SSE rules from Crew's own reader: `chunk` text accumulates; `assistant` counts only when
    no chunk arrived; an `error` row fails the turn unless reply text follows it; `[DONE]` ends
    it. A `permission` row means the agent asked for a tool it must not have: refused."""
    buffer = b""
    total = 0
    pieces: list[str] = []
    assistant = ""
    error_pending = False
    async for data in chunks:
        total += len(data)
        if total > MAX_BODY_BYTES:
            raise SummonFailure("malformed")
        buffer += data
        while b"\n" in buffer:
            line, buffer = buffer.split(b"\n", 1)
            line = line.rstrip(b"\r")
            if not line.startswith(b"data: "):
                continue
            payload = line[6:]
            if payload == b"[DONE]":
                if error_pending:
                    raise SummonFailure("unavailable")
                text = "".join(pieces) or assistant
                if len(text.encode()) > MAX_REPLY_BYTES:
                    raise SummonFailure("malformed")
                return text
            try:
                row = json.loads(payload)
            except ValueError:
                raise SummonFailure("malformed") from None
            kind = row.get("type") if isinstance(row, dict) else None
            content = row.get("content") if isinstance(row, dict) else None
            if kind == "permission":
                raise SummonFailure("refused")
            if kind == "error":
                error_pending = True
            elif kind == "chunk" and isinstance(content, str) and content:
                pieces.append(content)
                error_pending = False
            elif kind == "assistant" and isinstance(content, str) and content:
                assistant = assistant or content
                error_pending = False
    raise SummonFailure("unavailable")
