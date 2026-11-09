from __future__ import annotations

import functools
import hashlib
import hmac
import threading
import time
from collections.abc import Awaitable, Callable

from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from .config import gateway_env

MAX_SKEW_SECONDS = 60
NONCE_HEX_LENGTH = 32
MAX_TS_DIGITS = 12
V2_HEADER = "x-kirocrew-proxy-v2"
NONCE_HEADER = "x-kirocrew-proxy-nonce"

_HEX = frozenset("0123456789abcdef")

Handler = Callable[[Request], Awaitable[Response]]


class ReplayCache:
    """Accept each nonce once until its freshness window closes. Hold one per process.

    A full cache refuses new nonces rather than evicting a live one, because evicting a
    live nonce would make that request replayable again.
    """

    def __init__(self, max_entries: int = 4096) -> None:
        if max_entries < 1:
            raise ValueError("max_entries must be positive")
        self._max_entries = max_entries
        self._seen: dict[str, float] = {}
        self._lock = threading.Lock()

    def accept(self, nonce: str, *, expires_at: float, now: float) -> bool:
        with self._lock:
            for expired in [key for key, expiry in self._seen.items() if expiry < now]:
                del self._seen[expired]
            if nonce in self._seen or len(self._seen) >= self._max_entries:
                return False
            self._seen[nonce] = expires_at
            return True


def is_nonce(value: str) -> bool:
    return len(value) == NONCE_HEX_LENGTH and all(char in _HEX for char in value)


def request_target(request: Request) -> str:
    """Raw request-target as the gateway signs it: raw path plus raw query when present."""
    raw_path: bytes = request.scope.get("raw_path") or request.url.path.encode()
    query: bytes = request.scope.get("query_string", b"")
    target = raw_path.decode("ascii", "surrogateescape")
    return f"{target}?{query.decode('ascii', 'surrogateescape')}" if query else target


def signature_v2(secret: str, ts: str, nonce: str, method: str, target: str, body: bytes) -> str:
    body_hash = hashlib.sha256(body).hexdigest()
    message = f"v2:{ts}:{nonce}:{method}:{target}:{body_hash}"
    return hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()


def verify_v2(
    header: str,
    nonce: str,
    *,
    secret: str,
    method: str,
    target: str,
    body: bytes,
    cache: ReplayCache,
    now: float,
) -> bool:
    """Fails closed: empty secret, malformed header or nonce, skew over 60 s, bad MAC, replay."""
    if not secret or not header or not is_nonce(nonce):
        return False
    ts_str, _, signature = header.partition(":")
    if not (ts_str.isascii() and ts_str.isdigit()) or len(ts_str) > MAX_TS_DIGITS:
        return False
    if not signature:
        return False
    ts = int(ts_str)
    if not now - MAX_SKEW_SECONDS <= ts <= now + MAX_SKEW_SECONDS:
        return False
    expected = signature_v2(secret, ts_str, nonce, method, target, body)
    # Compared as bytes: the signature is attacker-chosen header text, and compare_digest
    # raises TypeError on a str holding a non-ASCII character.
    if not hmac.compare_digest(
        expected.encode("utf-8", "surrogatepass"), signature.encode("utf-8", "surrogatepass")
    ):
        return False
    return cache.accept(nonce, expires_at=ts + MAX_SKEW_SECONDS, now=now)


_CACHE = ReplayCache()


def signed(handler: Handler) -> Handler:
    """Require a fresh, unreplayed gateway v2 signature before running the handler."""

    @functools.wraps(handler)
    async def wrapper(request: Request) -> Response:
        secret = gateway_env().secret
        if not secret:
            return JSONResponse({"error": "proxy_secret_missing"}, status_code=503)
        body = await request.body()
        verified = verify_v2(
            request.headers.get(V2_HEADER, ""),
            request.headers.get(NONCE_HEADER, ""),
            secret=secret,
            method=request.method,
            target=request_target(request),
            body=body,
            cache=_CACHE,
            now=time.time(),
        )
        if not verified:
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        return await handler(request)

    return wrapper
