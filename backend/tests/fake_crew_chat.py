"""A fake Crew gateway for the summoner client: token exchange, chat slots and the chat SSE.

It speaks HTTP/1.1 over asyncio streams, records every request, and is scripted per scenario.
Test-time only."""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qs, urlsplit

APP_SECRET = "fake-app-secret"
SLOT_PREFIX = "/api/chat/slots/"


@dataclass
class Seen:
    method: str
    path: str
    query: dict[str, str]
    body: Any
    headers: dict[str, str]


@dataclass
class Script:
    exchange_status: int = 200
    create_status: int = 200
    create_unauthorized_first: bool = False
    row: dict[str, Any] | None = None
    send_status: int = 200
    send_mode: str = "chunks"
    send_events: list[Any] = field(default_factory=list)
    stop_status: int = 200
    delete_status: int = 200
    chunked: bool = True


def sse(row: Any) -> bytes:
    return b"data: " + json.dumps(row).encode() + b"\n\n"


class FakeCrew:
    def __init__(self, script: Script | None = None) -> None:
        self.script = script or Script()
        self.requests: list[Seen] = []
        self.tokens: list[str] = []
        self.deleted = asyncio.Event()
        self._server: asyncio.Server | None = None
        self.origin = ""
        self._unauthorized_sent = False

    async def start(self) -> FakeCrew:
        self._server = await asyncio.start_server(self._serve, "127.0.0.1", 0)
        port = self._server.sockets[0].getsockname()[1]
        self.origin = f"http://127.0.0.1:{port}"
        return self

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()

    def paths(self, method: str | None = None) -> list[str]:
        return [r.path for r in self.requests if method is None or r.method == method]

    def calls(self, method: str, path: str) -> list[Seen]:
        return [r for r in self.requests if r.method == method and r.path == path]

    async def _serve(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            await self._handle(reader, writer)
        except (ConnectionError, asyncio.IncompleteReadError):
            pass
        finally:
            writer.close()

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        line = (await reader.readline()).decode().split(" ")
        method, target = line[0], line[1]
        headers: dict[str, str] = {}
        while (raw := await reader.readline()) not in (b"\r\n", b""):
            name, _, value = raw.decode().partition(":")
            headers[name.strip().lower()] = value.strip()
        length = int(headers.get("content-length", "0"))
        raw_body = await reader.readexactly(length) if length else b""
        body: Any = json.loads(raw_body) if raw_body else None
        parts = urlsplit(target)
        query = {k: v[0] for k, v in parse_qs(parts.query).items()}
        self.requests.append(Seen(method, parts.path, query, body, headers))
        await self._route(writer, method, parts.path, query, body, headers)

    @staticmethod
    async def _json(writer: asyncio.StreamWriter, status: int, body: Any) -> None:
        data = json.dumps(body).encode()
        head = f"HTTP/1.1 {status} X\r\nContent-Type: application/json\r\n"
        head += f"Content-Length: {len(data)}\r\nConnection: close\r\n\r\n"
        writer.write(head.encode() + data)
        await writer.drain()

    async def _route(
        self,
        writer: asyncio.StreamWriter,
        method: str,
        path: str,
        query: dict[str, str],
        body: Any,
        headers: dict[str, str],
    ) -> None:
        script = self.script
        if path.endswith("/token"):
            if script.exchange_status != 200 or headers.get("x-app-secret") != APP_SECRET:
                await self._json(writer, script.exchange_status or 401, {"error": "no"})
                return
            self.tokens.append(f"tok-{len(self.tokens) + 1}")
            await self._json(writer, 200, {"token": self.tokens[-1]})
            return
        if query.get("token") not in self.tokens or (
            script.create_unauthorized_first
            and path == "/api/chat/slots"
            and not self._unauthorized_sent
        ):
            self._unauthorized_sent = True
            await self._json(writer, 401, {"error": "bad token"})
            return
        if method == "POST" and path == "/api/chat/slots":
            await self._create(writer, body)
        elif method == "POST" and path == "/api/chat":
            await self._send(writer)
        elif method == "POST" and path.endswith("/stop"):
            await self._json(writer, script.stop_status, {"ok": True})
        elif method == "DELETE" and path.startswith(SLOT_PREFIX):
            await self._json(writer, script.delete_status, {"ok": True})
            self.deleted.set()
        else:
            await self._json(writer, 404, {"error": "not found"})

    async def _create(self, writer: asyncio.StreamWriter, body: Any) -> None:
        script = self.script
        if script.create_status != 200:
            await self._json(writer, script.create_status, {"code": "agent_choice_unavailable"})
            return
        row = {
            "key": body["name"],
            "agent": body["agent"],
            "agent_kind": body["agent_kind"],
            "served_model": "claude-fake",
        }
        row.update(script.row or {})
        await self._json(writer, 200, row)

    async def _send(self, writer: asyncio.StreamWriter) -> None:
        script = self.script
        mode = script.send_mode
        if script.send_status != 200:
            await self._json(writer, script.send_status, {"error": "no"})
            return
        if mode == "receipt":
            await self._json(writer, 200, {"queued": True})
            return
        head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n"
        head += "Transfer-Encoding: chunked\r\n\r\n" if script.chunked else "\r\n"
        writer.write(head.encode())
        for event in script.send_events:
            await self._emit(writer, event)
        if mode == "hang":
            while True:
                await asyncio.sleep(0.02)
                await self._emit(writer, b": keepalive\n\n")
        if mode == "truncate":
            return
        await self._emit(writer, b"data: [DONE]\n\n")
        if script.chunked:
            writer.write(b"0\r\n\r\n")
        await writer.drain()

    async def _emit(self, writer: asyncio.StreamWriter, event: Any) -> None:
        data = event if isinstance(event, bytes) else sse(event)
        if self.script.chunked:
            writer.write(f"{len(data):x}\r\n".encode() + data + b"\r\n")
        else:
            writer.write(data)
        await writer.drain()
