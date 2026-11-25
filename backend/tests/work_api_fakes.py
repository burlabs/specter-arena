"""Test doubles for the work routes: gateway signing, a calling client, and a store-backed rig.

The rig uses the real store and the real `WorkService`; only the clock is replaced. Test-time
only."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import secrets
import time
from collections.abc import Coroutine
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from starlette.applications import Starlette
from starlette.testclient import TestClient

from backend.specter_arena.store import Store
from backend.specter_arena.work.service import WorkService
from backend.specter_arena.work_routes import work_routes

from .specter_fakes import FakeClock
from .work_fakes import T0, Seeded, open_seeded

SIGNING_VALUE = "work-route-test-signing-value"
URN = "urn:specter-arena:contract:"


def signed(
    method: str,
    target: str,
    body: bytes = b"",
    *,
    signing: str = SIGNING_VALUE,
    age_s: int = 0,
    nonce: str | None = None,
) -> dict[str, str]:
    """Gateway v2 headers for one request; `age_s` back-dates the timestamp."""
    stamp = str(int(time.time()) - age_s)
    used = nonce or secrets.token_hex(16)
    digest = hashlib.sha256(body).hexdigest()
    message = f"v2:{stamp}:{used}:{method}:{target}:{digest}"
    mac = hmac.new(signing.encode(), message.encode(), hashlib.sha256).hexdigest()
    return {"X-KiroCrew-Proxy-V2": f"{stamp}:{mac}", "X-KiroCrew-Proxy-Nonce": used}


class Api:
    def __init__(self, client: TestClient) -> None:
        self.client = client

    def call(self, method: str, target: str, body: Any = None, *, sign: bool = True) -> Any:
        raw = b"" if body is None else json.dumps(body).encode()
        headers = signed(method, target, raw) if sign else {}
        return self.client.request(method, target, content=raw or None, headers=headers)

    def get(self, target: str) -> Any:
        return self.call("GET", target)

    def post(self, target: str, body: Any = None) -> Any:
        return self.call("POST", target, {} if body is None else body)


def run[T](coro: Coroutine[Any, Any, T]) -> T:
    return asyncio.run(coro)


@dataclass
class WorkRig:
    store: Store
    seeded: Seeded
    clock: FakeClock
    service: WorkService
    app: Starlette


def build_rig(root: Path, *, bots: int = 3, per_bot: int = 5) -> WorkRig:
    store, seeded = open_seeded(root, bots=bots, per_bot=per_bot)
    clock = FakeClock(T0 + 100_000)
    service = WorkService(store, clock=clock)
    app = Starlette(routes=work_routes())
    app.state.work = service
    return WorkRig(store, seeded, clock, service, app)
