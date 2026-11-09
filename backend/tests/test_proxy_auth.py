import hashlib
import hmac

import pytest
from starlette.requests import Request

from backend.specter_arena.proxy_auth import (
    ReplayCache,
    is_nonce,
    request_target,
    signature_v2,
    verify_v2,
)

SECRET = "test-secret"
TS = 1700000000
NONCE = "0123456789abcdef0123456789abcdef"
EMPTY_BODY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
POST_BODY = b'{"a":1}'
POST_BODY_HASH = "015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862"

# Computed with the gateway's own sign_proxy_request_v2 (Crew 0.12.0, kiro_crew/apps/proxy_auth.py).
GET_PING_SIGNATURE = "60ed91c522baca3a391589458c6b4dd42db540dfcf3dffa4b9342e97a1b7b769"
POST_PROBE_SIGNATURE = "d3170f1a077ce5b1f9ae289c21bd2eb187dc12c9d4ebab646b6cd5ad5253682d"


def verify(
    header: str,
    nonce: str = NONCE,
    *,
    secret: str = SECRET,
    method: str = "GET",
    target: str = "/api/ping",
    body: bytes = b"",
    cache: ReplayCache | None = None,
    now: float = float(TS),
) -> bool:
    return verify_v2(
        header,
        nonce,
        secret=secret,
        method=method,
        target=target,
        body=body,
        cache=cache or ReplayCache(),
        now=now,
    )


def test_known_vector_for_an_empty_get() -> None:
    assert hashlib.sha256(b"").hexdigest() == EMPTY_BODY_HASH
    assert signature_v2(SECRET, str(TS), NONCE, "GET", "/api/ping", b"") == GET_PING_SIGNATURE


def test_known_vector_for_a_post_with_a_query_and_body() -> None:
    assert hashlib.sha256(POST_BODY).hexdigest() == POST_BODY_HASH
    signature = signature_v2(SECRET, str(TS), NONCE, "POST", "/api/probe/run?x=1", POST_BODY)
    assert signature == POST_PROBE_SIGNATURE


def test_message_format_is_exactly_the_gateways() -> None:
    message = f"v2:{TS}:{NONCE}:GET:/api/ping:{EMPTY_BODY_HASH}"
    expected = hmac.new(SECRET.encode(), message.encode(), hashlib.sha256).hexdigest()
    assert expected == GET_PING_SIGNATURE


def test_valid_signature_is_accepted() -> None:
    assert verify(f"{TS}:{GET_PING_SIGNATURE}")


def test_valid_post_signature_is_accepted() -> None:
    assert verify(
        f"{TS}:{POST_PROBE_SIGNATURE}",
        method="POST",
        target="/api/probe/run?x=1",
        body=POST_BODY,
    )


@pytest.mark.parametrize("offset", [-60, -59, 0, 59, 60])
def test_timestamp_inside_the_window_is_accepted(offset: int) -> None:
    assert verify(f"{TS}:{GET_PING_SIGNATURE}", now=float(TS + offset))


@pytest.mark.parametrize("offset", [-61, 61, 3600])
def test_timestamp_outside_the_window_is_rejected(offset: int) -> None:
    assert not verify(f"{TS}:{GET_PING_SIGNATURE}", now=float(TS + offset))


def test_replayed_nonce_is_rejected() -> None:
    cache = ReplayCache()
    header = f"{TS}:{GET_PING_SIGNATURE}"
    assert verify(header, cache=cache)
    assert not verify(header, cache=cache)


def test_failed_verification_does_not_consume_the_nonce() -> None:
    cache = ReplayCache()
    assert not verify(f"{TS}:{'0' * 64}", cache=cache)
    assert verify(f"{TS}:{GET_PING_SIGNATURE}", cache=cache)


def test_wrong_secret_is_rejected() -> None:
    assert not verify(f"{TS}:{GET_PING_SIGNATURE}", secret="other-secret")


def test_tampered_body_is_rejected() -> None:
    assert not verify(f"{TS}:{GET_PING_SIGNATURE}", body=b"x")


def test_tampered_method_is_rejected() -> None:
    assert not verify(f"{TS}:{GET_PING_SIGNATURE}", method="POST")


def test_tampered_target_is_rejected() -> None:
    assert not verify(f"{TS}:{GET_PING_SIGNATURE}", target="/api/ping?x=1")


def test_empty_secret_fails_closed() -> None:
    empty_secret_signature = signature_v2("", str(TS), NONCE, "GET", "/api/ping", b"")
    assert not verify(f"{TS}:{empty_secret_signature}", secret="")


def test_non_ascii_signature_is_rejected_without_raising() -> None:
    assert not verify(f"{TS}:{'é' * 64}")


def test_lone_surrogate_signature_is_rejected_without_raising() -> None:
    assert not verify(f"{TS}:\udcff" + "0" * 63)


@pytest.mark.parametrize(
    "header",
    [
        "",
        "no-colon",
        f"{TS}:",
        f":{GET_PING_SIGNATURE}",
        f"-{TS}:{GET_PING_SIGNATURE}",
        f"²:{GET_PING_SIGNATURE}",
        f"{'9' * 13}:{GET_PING_SIGNATURE}",
    ],
)
def test_malformed_header_is_rejected(header: str) -> None:
    assert not verify(header)


@pytest.mark.parametrize(
    "nonce",
    ["", "short", NONCE.upper(), NONCE + "0", "g" * 32],
)
def test_malformed_nonce_is_rejected(nonce: str) -> None:
    assert not verify(f"{TS}:{GET_PING_SIGNATURE}", nonce)


def test_is_nonce_accepts_only_32_lowercase_hex() -> None:
    assert is_nonce(NONCE)
    assert not is_nonce(NONCE[:-1])
    assert not is_nonce(NONCE.upper())


def test_replay_cache_expires_entries_after_the_window() -> None:
    cache = ReplayCache()
    assert cache.accept("a", expires_at=10.0, now=0.0)
    assert not cache.accept("a", expires_at=10.0, now=5.0)
    assert cache.accept("a", expires_at=30.0, now=11.0)


def test_replay_cache_refuses_new_nonces_when_full_instead_of_evicting() -> None:
    cache = ReplayCache(max_entries=2)
    assert cache.accept("a", expires_at=100.0, now=0.0)
    assert cache.accept("b", expires_at=100.0, now=0.0)
    assert not cache.accept("c", expires_at=100.0, now=0.0)
    assert not cache.accept("a", expires_at=100.0, now=0.0)


def test_replay_cache_rejects_a_non_positive_size() -> None:
    with pytest.raises(ValueError):
        ReplayCache(max_entries=0)


def make_request(raw_path: bytes | None, query: bytes) -> Request:
    scope: dict[str, object] = {
        "type": "http",
        "method": "GET",
        "path": "/api/ping",
        "query_string": query,
        "headers": [],
        "scheme": "http",
        "server": ("127.0.0.1", 9100),
    }
    if raw_path is not None:
        scope["raw_path"] = raw_path
    return Request(scope)


def test_request_target_uses_the_raw_path_and_raw_query() -> None:
    request = make_request(b"/api/ping", b"q=a%20b&r=%C3%A9")
    assert request_target(request) == "/api/ping?q=a%20b&r=%C3%A9"


def test_request_target_omits_the_question_mark_without_a_query() -> None:
    assert request_target(make_request(b"/api/ping", b"")) == "/api/ping"


def test_request_target_falls_back_to_the_decoded_path() -> None:
    assert request_target(make_request(None, b"")) == "/api/ping"
