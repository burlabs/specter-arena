"""The gateway client against a real local socket: no Crew, no external network."""

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from http import HTTPStatus
from typing import Any
from urllib.parse import parse_qs, urlparse

import pytest
from websockets.asyncio.server import ServerConnection, serve
from websockets.http11 import Request, Response

from backend.specter_arena.collector import gateway as gateway_module
from backend.specter_arena.collector.gateway import (
    AuthRejected,
    GatewayClient,
    MalformedAnswer,
    PolicyClose,
    Transient,
)
from backend.specter_arena.collector.vocabulary import LIMITS
from backend.specter_arena.config import GatewayEnv

SECRET = "test-app-secret"
TOKEN = "test-gateway-token"
EXCHANGE_PATH = "/api/apps/specter-arena/token"
STATUS = {"401": 401, "403": 403, "404": 404, "500": 500}


@dataclass
class Script:
    exchange: str = "ok"
    agents: str = "ok"
    ws: str = "ok"
    frames: list[str | bytes] = field(default_factory=list)
    close_code: int | None = None
    seen: list[tuple[str, dict[str, str]]] = field(default_factory=list)

    def exchanges(self) -> int:
        return sum(1 for path, _ in self.seen if path == EXCHANGE_PATH)


def _json_response(connection: ServerConnection, status: int, body: str) -> Response:
    response = connection.respond(HTTPStatus(status), body)
    response.headers["Content-Type"] = "application/json"
    return response


def _exchange_answer(connection: ServerConnection, script: Script, secret: str | None) -> Response:
    mode = script.exchange
    if mode in STATUS:
        return _json_response(connection, STATUS[mode], "{}")
    if secret != SECRET:
        return _json_response(connection, 403, "{}")
    answers = {
        "ok": json.dumps({"token": TOKEN}),
        "no-token": json.dumps({"other": 1}),
        "token-int": json.dumps({"token": 5}),
        "bad-json": "not json",
        "list": "[1]",
    }
    return _json_response(connection, 200, answers[mode])


def _agents_answer(connection: ServerConnection, script: Script, token: str | None) -> Response:
    if script.agents in STATUS:
        return _json_response(connection, STATUS[script.agents], "{}")
    if token != TOKEN:
        return _json_response(connection, 403, "{}")
    if script.agents == "bad-json":
        return _json_response(connection, 200, "not json")
    if script.agents == "big":
        return _json_response(connection, 200, '"' + "x" * (LIMITS.http_body_max_bytes + 10) + '"')
    return _json_response(connection, 200, json.dumps([{"name": "bot"}]))


def make_request_handler(script: Script) -> Callable[[ServerConnection, Request], Response | None]:
    def handle(connection: ServerConnection, request: Request) -> Response | None:
        parts = urlparse(request.path)
        query = parse_qs(parts.query)
        token = query.get("token", [None])[0]
        script.seen.append((parts.path, dict(request.headers.raw_items())))
        if parts.path == EXCHANGE_PATH:
            return _exchange_answer(connection, script, request.headers.get("X-App-Secret"))
        if parts.path == "/api/agents":
            return _agents_answer(connection, script, token)
        if parts.path == "/api/ws":
            if script.ws in STATUS:
                return _json_response(connection, STATUS[script.ws], "{}")
            return None if token == TOKEN else _json_response(connection, 403, "{}")
        return _json_response(connection, 404, "{}")

    return handle


async def feed_handler(connection: ServerConnection, script: Script) -> None:
    for frame in script.frames:
        await connection.send(frame)
    if script.close_code is not None:
        await connection.close(script.close_code)
    else:
        await connection.wait_closed()


def run_against_server(
    script: Script, scenario: Callable[[GatewayEnv], Awaitable[Any]], secret: str = SECRET
) -> Any:
    async def main() -> Any:
        async def handler(connection: ServerConnection) -> None:
            await feed_handler(connection, script)

        async with serve(
            handler, "127.0.0.1", 0, process_request=make_request_handler(script)
        ) as server:
            port = server.sockets[0].getsockname()[1]
            env = GatewayEnv(
                secret=secret,
                origin=f"http://127.0.0.1:{port}",
                port=str(port),
                app_name="specter-arena",
            )
            return await scenario(env)

    return asyncio.run(main())


def unused_port_env() -> GatewayEnv:
    import socket

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    return GatewayEnv(
        secret=SECRET, origin=f"http://127.0.0.1:{port}", port=str(port), app_name="specter-arena"
    )


class StepClock:
    def __init__(self) -> None:
        self.now = 100.0

    def __call__(self) -> float:
        return self.now


# --- token exchange --------------------------------------------------------------------


def test_exchange_stores_a_token_and_starts_its_age_clock() -> None:
    clock = StepClock()
    script = Script()

    async def scenario(env: GatewayEnv) -> None:
        client = GatewayClient(env, clock=clock)
        assert client.token_age_s == float("inf")
        await client.exchange_token()
        assert client.token_age_s == 0.0
        clock.now += 90.5
        assert client.token_age_s == 90.5

    run_against_server(script, scenario)
    assert script.exchanges() == 1
    headers = {key.lower(): value for key, value in script.seen[0][1].items()}
    assert headers["x-app-secret"] == SECRET
    assert "cookie" not in headers and "authorization" not in headers


@pytest.mark.parametrize(
    ("mode", "status"),
    [
        ("401", 401),
        ("403", 403),
        ("404", 404),
        ("no-token", 200),
        ("token-int", 200),
        ("bad-json", 200),
        ("list", 200),
    ],
)
def test_a_rejected_exchange_is_distinct_from_a_transient_failure(mode: str, status: int) -> None:
    async def scenario(env: GatewayEnv) -> AuthRejected:
        with pytest.raises(AuthRejected) as caught:
            await GatewayClient(env).exchange_token()
        return caught.value

    error = run_against_server(Script(exchange=mode), scenario)
    assert (error.status, error.exchange) == (status, True)


def test_an_exchange_server_error_is_transient() -> None:
    async def scenario(env: GatewayEnv) -> None:
        with pytest.raises(Transient) as caught:
            await GatewayClient(env).exchange_token()
        assert caught.value.reason == "exchange-500"

    run_against_server(Script(exchange="500"), scenario)


def test_a_wrong_secret_is_a_rejected_exchange() -> None:
    async def scenario(env: GatewayEnv) -> None:
        with pytest.raises(AuthRejected) as caught:
            await GatewayClient(env).exchange_token()
        assert (caught.value.status, caught.value.exchange) == (403, True)

    run_against_server(Script(), scenario, secret="wrong")


def test_no_secret_means_no_request_and_a_rejected_exchange() -> None:
    script = Script()

    async def scenario(env: GatewayEnv) -> None:
        with pytest.raises(AuthRejected) as caught:
            await GatewayClient(env).exchange_token()
        assert (caught.value.status, caught.value.exchange) == (0, True)

    run_against_server(script, scenario, secret="")
    assert script.seen == []


def test_a_refused_connection_is_transient_for_every_call() -> None:
    async def scenario() -> None:
        client = GatewayClient(unused_port_env())
        with pytest.raises(Transient):
            await client.exchange_token()
        with pytest.raises(Transient):
            await client.get_json("/api/agents")
        with pytest.raises(Transient):
            async with client.open_feed():
                pass

    asyncio.run(scenario())


# --- get_json --------------------------------------------------------------------------


def test_get_json_presents_the_token_in_the_query_and_nothing_else() -> None:
    script = Script()

    async def scenario(env: GatewayEnv) -> object:
        return await GatewayClient(env).get_json("/api/agents")

    assert run_against_server(script, scenario) == [{"name": "bot"}]
    assert script.exchanges() == 1
    headers = {key.lower() for key in script.seen[-1][1]}
    assert "cookie" not in headers and "authorization" not in headers


def test_get_json_appends_to_an_existing_query() -> None:
    script = Script()

    async def scenario(env: GatewayEnv) -> object:
        return await GatewayClient(env).get_json("/api/agents?limit=5")

    assert run_against_server(script, scenario) == [{"name": "bot"}]


def test_get_json_reuses_one_token() -> None:
    script = Script()

    async def scenario(env: GatewayEnv) -> None:
        client = GatewayClient(env)
        await client.get_json("/api/agents")
        await client.get_json("/api/agents")

    run_against_server(script, scenario)
    assert script.exchanges() == 1


@pytest.mark.parametrize("status", [401, 403])
def test_get_json_maps_refusals_to_auth_rejected_not_exchange(status: int) -> None:
    async def scenario(env: GatewayEnv) -> AuthRejected:
        with pytest.raises(AuthRejected) as caught:
            await GatewayClient(env).get_json("/api/agents")
        return caught.value

    error = run_against_server(Script(agents=str(status)), scenario)
    assert (error.status, error.exchange) == (status, False)


def test_get_json_maps_a_server_error_to_transient() -> None:
    async def scenario(env: GatewayEnv) -> None:
        with pytest.raises(Transient) as caught:
            await GatewayClient(env).get_json("/api/agents")
        assert caught.value.reason == "http-500"

    run_against_server(Script(agents="500"), scenario)


@pytest.mark.parametrize("mode", ["404", "bad-json", "big"])
def test_get_json_maps_an_unusable_answer_to_malformed(mode: str) -> None:
    async def scenario(env: GatewayEnv) -> None:
        with pytest.raises(MalformedAnswer):
            await GatewayClient(env).get_json("/api/agents")

    run_against_server(Script(agents=mode), scenario)


def test_get_json_refuses_a_path_outside_the_api() -> None:
    async def scenario(env: GatewayEnv) -> None:
        client = GatewayClient(env)
        for path in ("/apps/specter-arena/api/ping", "api/agents", "//evil/api/", ""):
            with pytest.raises(ValueError):
                await client.get_json(path)

    script = Script()
    run_against_server(script, scenario)
    assert script.seen == []


# --- feed ------------------------------------------------------------------------------


def test_frames_arrive_over_a_real_socket_then_close_1008_is_a_policy_close() -> None:
    script = Script(frames=['{"type":"slots","data":[]}', b"\x00binary"], close_code=1008)

    async def scenario(env: GatewayEnv) -> list[str | bytes]:
        received: list[str | bytes] = []
        client = GatewayClient(env)
        with pytest.raises(PolicyClose):
            async with client.open_feed() as feed:
                while True:
                    received.append(await feed.recv())
        return received

    assert run_against_server(script, scenario) == ['{"type":"slots","data":[]}', b"\x00binary"]


def test_another_close_code_is_transient() -> None:
    script = Script(frames=["x"], close_code=1011)

    async def scenario(env: GatewayEnv) -> None:
        async with GatewayClient(env).open_feed() as feed:
            assert await feed.recv() == "x"
            with pytest.raises(Transient):
                await feed.recv()

    run_against_server(script, scenario)


def test_an_oversize_frame_ends_the_connection_as_transient() -> None:
    script = Script(frames=["x" * (3 * 1024 * 1024)])

    async def scenario(env: GatewayEnv) -> None:
        async with GatewayClient(env).open_feed() as feed:
            with pytest.raises(Transient):
                await feed.recv()

    run_against_server(script, scenario)


@pytest.mark.parametrize("status", [401, 403])
def test_a_refused_handshake_is_auth_rejected(status: int) -> None:
    async def scenario(env: GatewayEnv) -> None:
        with pytest.raises(AuthRejected) as caught:
            async with GatewayClient(env).open_feed():
                pass
        assert (caught.value.status, caught.value.exchange) == (status, False)

    run_against_server(Script(ws=str(status)), scenario)


@pytest.mark.parametrize("mode", ["404", "500"])
def test_any_other_handshake_failure_is_transient(mode: str) -> None:
    async def scenario(env: GatewayEnv) -> None:
        with pytest.raises(Transient) as caught:
            async with GatewayClient(env).open_feed():
                pass
        assert caught.value.reason == f"handshake-{mode}"

    run_against_server(Script(ws=mode), scenario)


def test_an_exception_raised_by_the_caller_inside_the_feed_propagates_unchanged() -> None:
    class Boom(Exception):
        pass

    async def scenario(env: GatewayEnv) -> None:
        with pytest.raises(Boom):
            async with GatewayClient(env).open_feed():
                raise Boom

    run_against_server(Script(), scenario)


def test_the_feed_uses_the_cached_token() -> None:
    script = Script(frames=["a"], close_code=1000)

    async def scenario(env: GatewayEnv) -> None:
        client = GatewayClient(env)
        await client.exchange_token()
        async with client.open_feed() as feed:
            assert await feed.recv() == "a"

    run_against_server(script, scenario)
    assert script.exchanges() == 1


# --- the token never reaches a log or a message ---------------------------------------------


def test_the_token_and_secret_never_appear_in_any_log_record_at_debug(
    caplog: pytest.LogCaptureFixture,
) -> None:
    script = Script(frames=["a"], close_code=1008)
    caplog.set_level(logging.DEBUG)
    for name in ("websockets", "websockets.client", "websockets.server", ""):
        logging.getLogger(name).setLevel(logging.DEBUG)

    async def scenario(env: GatewayEnv) -> None:
        client = GatewayClient(env)
        await client.get_json("/api/agents")
        with pytest.raises(PolicyClose):
            async with client.open_feed() as feed:
                while True:
                    await feed.recv()

    run_against_server(script, scenario)
    client_records = [r for r in caplog.records if "specter_arena.collector" in r.name]
    assert client_records == []
    for record in caplog.records:
        if record.name.startswith("websockets.server") or record.name == "asyncio":
            continue
        rendered = record.getMessage()
        assert TOKEN not in rendered and SECRET not in rendered


def test_error_messages_never_carry_the_token_or_the_secret() -> None:
    async def scenario(env: GatewayEnv) -> list[str]:
        client = GatewayClient(env)
        messages: list[str] = []
        for call in (client.exchange_token(), client.get_json("/api/agents")):
            try:
                await call
            except (AuthRejected, Transient, MalformedAnswer) as error:
                messages.append(str(error))
        return messages

    messages = run_against_server(Script(exchange="500"), scenario)
    assert messages and all(SECRET not in m and TOKEN not in m for m in messages)
    refused = asyncio.run(_refused_messages())
    assert all(SECRET not in m and "token=" not in m for m in refused)


async def _refused_messages() -> list[str]:
    client = GatewayClient(unused_port_env())
    messages = []
    try:
        await client.exchange_token()
    except Transient as error:
        messages.append(str(error))
    return messages


# --- failures the loopback server cannot produce ----------------------------------------


@pytest.mark.parametrize("failure", [OSError("down"), TimeoutError()])
def test_a_connect_error_is_transient(
    monkeypatch: pytest.MonkeyPatch, failure: BaseException
) -> None:
    async def failing_connect(*args: object, **kwargs: object) -> object:
        raise failure

    monkeypatch.setattr(gateway_module, "connect", failing_connect)

    async def scenario(env: GatewayEnv) -> None:
        with pytest.raises(Transient) as caught:
            async with GatewayClient(env).open_feed():
                pass
        assert caught.value.reason == type(failure).__name__

    run_against_server(Script(), scenario)


def test_a_socket_error_while_receiving_is_transient(monkeypatch: pytest.MonkeyPatch) -> None:
    class BrokenConnection:
        async def __aenter__(self) -> "BrokenConnection":
            return self

        async def __aexit__(self, *exc: object) -> None:
            return None

        async def recv(self) -> str:
            raise OSError("reset")

    async def fake_connect(*args: object, **kwargs: object) -> BrokenConnection:
        return BrokenConnection()

    monkeypatch.setattr(gateway_module, "connect", fake_connect)

    async def scenario(env: GatewayEnv) -> None:
        async with GatewayClient(env).open_feed() as feed:
            with pytest.raises(Transient) as caught:
                await feed.recv()
        assert caught.value.reason == "OSError"

    run_against_server(Script(), scenario)
