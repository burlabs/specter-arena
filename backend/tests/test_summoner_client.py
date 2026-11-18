"""CrewChatSummoner against a fake Crew gateway: FP-06-AC04, AC05 and AC06 on the client side."""

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any

import pytest

from backend.specter_arena.config import GatewayEnv
from backend.specter_arena.summoner import (
    FAILURE_CODES,
    MAX_REPLY_BYTES,
    SummonFailure,
    SummonReply,
    UnavailableSummoner,
)
from backend.specter_arena.summoner import client as client_module
from backend.specter_arena.summoner.client import SUMMON_AGENT, CrewChatSummoner

from .fake_crew_chat import APP_SECRET, FakeCrew, Script

REQUEST_ID = "req_" + "0" * 24
SLOT = f"specter-summon-{REQUEST_ID}"
ALLOWED_PATHS = {
    "/api/apps/specter-arena/token",
    "/api/chat/slots",
    f"/api/chat/slots/{SLOT}/stop",
    f"/api/chat/slots/{SLOT}",
    "/api/chat",
}


def chunk(text: str) -> dict[str, str]:
    return {"type": "chunk", "content": text}


async def with_crew(
    script: Script, scenario: Callable[[FakeCrew, CrewChatSummoner], Awaitable[Any]]
) -> Any:
    crew = await FakeCrew(script).start()
    try:
        env = GatewayEnv(APP_SECRET, crew.origin, "0", "specter-arena")
        return await scenario(crew, CrewChatSummoner(env))
    finally:
        await crew.stop()


def run(
    script: Script,
    scenario: Callable[[FakeCrew, CrewChatSummoner], Awaitable[Any]],
) -> Any:
    return asyncio.run(with_crew(script, scenario))


async def summon(summoner: CrewChatSummoner, timeout_s: float = 5.0) -> SummonReply:
    return await summoner.summon("PROMPT", request_id=REQUEST_ID, timeout_s=timeout_s)


async def failure_of(summoner: CrewChatSummoner, timeout_s: float = 5.0) -> str:
    try:
        await summon(summoner, timeout_s)
    except SummonFailure as failure:
        return failure.code
    raise AssertionError("expected a SummonFailure")


def test_a_reply_is_the_chunk_text_with_the_served_model_and_the_slot_is_deleted() -> None:
    async def scenario(crew: FakeCrew, summoner: CrewChatSummoner) -> None:
        reply = await summon(summoner)
        assert reply == SummonReply(text='{"a": 1}', model_label="claude-fake")
        assert crew.deleted.is_set()
        assert crew.calls("POST", f"/api/chat/slots/{SLOT}/stop") == []

    run(Script(send_events=[b": keepalive\n\n", chunk('{"a"'), chunk(": 1}")]), scenario)


def test_the_create_body_pins_the_summoner_agent_and_the_send_repeats_it() -> None:
    async def scenario(crew: FakeCrew, summoner: CrewChatSummoner) -> None:
        await summon(summoner)
        (created,) = crew.calls("POST", "/api/chat/slots")
        assert created.body == {
            "name": SLOT,
            "agent": "specter-arena-summoner",
            "agent_kind": "template",
            "memory_mode": "temporary",
            "title": "Specter summoning",
        }
        assert "app_agent_owner" not in created.body
        (sent,) = crew.calls("POST", "/api/chat")
        assert sent.body == {"message": "PROMPT", "slot": SLOT, "agent": SUMMON_AGENT}
        assert SUMMON_AGENT == "specter-arena-summoner"
        assert crew.requests[0].headers["x-app-secret"] == APP_SECRET
        assert all("x-app-secret" not in r.headers for r in crew.requests[1:])

    run(Script(send_events=[chunk("ok")]), scenario)


def test_only_the_exchange_and_the_four_chat_calls_are_made_and_none_is_a_get() -> None:
    async def scenario(crew: FakeCrew, summoner: CrewChatSummoner) -> None:
        await summon(summoner)
        assert set(crew.paths()) <= ALLOWED_PATHS
        assert "GET" not in {r.method for r in crew.requests}
        assert {r.query.get("token") for r in crew.requests[1:]} == {"tok-1"}

    run(Script(send_events=[chunk("ok")]), scenario)


def test_an_assistant_only_reply_is_used_when_no_chunk_arrived() -> None:
    async def scenario(_crew: FakeCrew, summoner: CrewChatSummoner) -> None:
        assert (await summon(summoner)).text == "whole"

    run(Script(send_events=[{"type": "assistant", "content": "whole"}]), scenario)


def test_chunks_win_over_an_assistant_row() -> None:
    async def scenario(_crew: FakeCrew, summoner: CrewChatSummoner) -> None:
        assert (await summon(summoner)).text == "piece"

    run(Script(send_events=[chunk("piece"), {"type": "assistant", "content": "whole"}]), scenario)


def test_an_unchunked_body_ending_at_close_is_read() -> None:
    async def scenario(_crew: FakeCrew, summoner: CrewChatSummoner) -> None:
        assert (await summon(summoner)).text == "plain"

    run(Script(chunked=False, send_events=[chunk("plain")]), scenario)


def test_an_error_row_then_done_is_unavailable_and_the_slot_is_still_deleted() -> None:
    async def scenario(crew: FakeCrew, summoner: CrewChatSummoner) -> None:
        assert await failure_of(summoner) == "unavailable"
        assert crew.deleted.is_set()

    run(Script(send_events=[{"type": "error", "content": "boom"}]), scenario)


def test_an_error_row_followed_by_reply_text_is_a_reply() -> None:
    async def scenario(_crew: FakeCrew, summoner: CrewChatSummoner) -> None:
        assert (await summon(summoner)).text == "later"

    run(Script(send_events=[{"type": "error", "content": "x"}, chunk("later")]), scenario)


def test_a_permission_row_is_refused() -> None:
    async def scenario(_crew: FakeCrew, summoner: CrewChatSummoner) -> None:
        assert await failure_of(summoner) == "refused"

    run(Script(send_events=[{"type": "permission", "content": "bash"}]), scenario)


def test_a_non_object_or_unknown_row_is_skipped_and_bad_json_is_malformed() -> None:
    async def skipped(_crew: FakeCrew, summoner: CrewChatSummoner) -> None:
        assert (await summon(summoner)).text == "kept"

    run(Script(send_events=[[1, 2], {"type": "other"}, {"type": "chunk"}, chunk("kept")]), skipped)

    async def bad(_crew: FakeCrew, summoner: CrewChatSummoner) -> None:
        assert await failure_of(summoner) == "malformed"

    run(Script(send_events=[b"data: {not json\n\n"]), bad)


def test_a_401_is_retried_once_with_a_fresh_token() -> None:
    async def scenario(crew: FakeCrew, summoner: CrewChatSummoner) -> None:
        assert (await summon(summoner)).text == "ok"
        assert len(crew.calls("POST", "/api/apps/specter-arena/token")) == 2

    run(Script(create_unauthorized_first=True, send_events=[chunk("ok")]), scenario)


def test_a_403_on_create_is_refused_and_nothing_is_sent() -> None:
    async def scenario(crew: FakeCrew, summoner: CrewChatSummoner) -> None:
        assert await failure_of(summoner) == "refused"
        assert crew.calls("POST", "/api/chat") == []
        assert crew.calls("DELETE", f"/api/chat/slots/{SLOT}") == []

    run(Script(create_status=403), scenario)


def test_a_409_agent_choice_unavailable_is_unavailable_with_no_send() -> None:
    async def scenario(crew: FakeCrew, summoner: CrewChatSummoner) -> None:
        assert await failure_of(summoner) == "unavailable"
        assert crew.calls("POST", "/api/chat") == []

    run(Script(create_status=409), scenario)


def test_a_server_error_on_create_is_unavailable() -> None:
    async def scenario(_crew: FakeCrew, summoner: CrewChatSummoner) -> None:
        assert await failure_of(summoner) == "unavailable"

    run(Script(create_status=503), scenario)


@pytest.mark.parametrize(
    "row",
    [{"agent": "default"}, {"agent_kind": "builtin"}, {"key": "member-other"}],
    ids=["other-agent", "other-kind", "other-key"],
)
def test_a_created_row_naming_another_agent_is_unavailable_and_deleted_without_a_send(
    row: dict[str, Any],
) -> None:
    async def scenario(crew: FakeCrew, summoner: CrewChatSummoner) -> None:
        assert await failure_of(summoner) == "unavailable"
        assert crew.calls("POST", "/api/chat") == []
        assert crew.deleted.is_set()

    run(Script(row=row), scenario)


def test_a_403_on_send_is_refused_and_the_slot_is_deleted() -> None:
    async def scenario(crew: FakeCrew, summoner: CrewChatSummoner) -> None:
        assert await failure_of(summoner) == "refused"
        assert crew.deleted.is_set()

    run(Script(send_status=403), scenario)


def test_a_json_receipt_instead_of_a_stream_is_unavailable_and_deleted() -> None:
    async def scenario(crew: FakeCrew, summoner: CrewChatSummoner) -> None:
        assert await failure_of(summoner) == "unavailable"
        assert crew.deleted.is_set()

    run(Script(send_mode="receipt"), scenario)


def test_a_non_200_send_is_unavailable() -> None:
    async def scenario(_crew: FakeCrew, summoner: CrewChatSummoner) -> None:
        assert await failure_of(summoner) == "unavailable"

    run(Script(send_status=500), scenario)


def test_a_stream_that_hangs_past_the_deadline_times_out_then_stops_and_deletes() -> None:
    async def scenario(crew: FakeCrew, summoner: CrewChatSummoner) -> None:
        assert await failure_of(summoner, timeout_s=0.4) == "timeout"
        assert len(crew.calls("POST", f"/api/chat/slots/{SLOT}/stop")) == 1
        assert crew.deleted.is_set()
        paths = crew.paths()
        assert paths.index(f"/api/chat/slots/{SLOT}/stop") < paths.index(f"/api/chat/slots/{SLOT}")

    run(Script(send_mode="hang", send_events=[chunk("partial")]), scenario)


def test_a_cancelled_task_stops_deletes_and_reraises_cancellation() -> None:
    async def scenario(crew: FakeCrew, summoner: CrewChatSummoner) -> None:
        task = asyncio.ensure_future(summon(summoner, timeout_s=30))
        for _ in range(200):
            if crew.calls("POST", "/api/chat"):
                break
            await asyncio.sleep(0.01)
        await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert len(crew.calls("POST", f"/api/chat/slots/{SLOT}/stop")) == 1
        assert crew.deleted.is_set()

    run(Script(send_mode="hang"), scenario)


def test_a_reply_over_16_kib_is_malformed() -> None:
    async def scenario(_crew: FakeCrew, summoner: CrewChatSummoner) -> None:
        assert await failure_of(summoner) == "malformed"

    run(Script(send_events=[chunk("x" * (MAX_REPLY_BYTES + 1))]), scenario)


def test_a_stream_body_over_one_mebibyte_is_malformed() -> None:
    async def scenario(_crew: FakeCrew, summoner: CrewChatSummoner) -> None:
        assert await failure_of(summoner) == "malformed"

    row = chunk("y" * 60_000)
    run(Script(send_events=[row] * 20), scenario)


def test_a_connection_closed_before_done_is_unavailable() -> None:
    async def scenario(crew: FakeCrew, summoner: CrewChatSummoner) -> None:
        assert await failure_of(summoner) == "unavailable"
        assert crew.deleted.is_set()

    run(Script(send_mode="truncate", send_events=[chunk("half")]), scenario)


def test_a_failed_exchange_is_refused_or_unavailable() -> None:
    async def refused(_crew: FakeCrew, summoner: CrewChatSummoner) -> None:
        assert await failure_of(summoner) == "refused"

    run(Script(exchange_status=403), refused)

    async def down(_crew: FakeCrew, summoner: CrewChatSummoner) -> None:
        assert await failure_of(summoner) == "unavailable"

    run(Script(exchange_status=500), down)


def test_an_exchange_without_a_secret_is_unavailable() -> None:
    summoner = CrewChatSummoner(GatewayEnv("", "http://127.0.0.1:1", "0", "specter-arena"))
    assert asyncio.run(failure_of(summoner)) == "unavailable"


def test_a_closed_port_is_unavailable() -> None:
    summoner = CrewChatSummoner(GatewayEnv(APP_SECRET, "http://127.0.0.1:1", "0", "specter-arena"))
    assert asyncio.run(failure_of(summoner)) == "unavailable"


def test_a_non_http_origin_is_unavailable() -> None:
    with pytest.raises(SummonFailure) as caught:
        CrewChatSummoner(GatewayEnv(APP_SECRET, "https://example.invalid", "0", "specter-arena"))
    assert caught.value.code == "unavailable"


def test_the_token_is_reused_within_its_lifetime_and_renewed_after_it() -> None:
    now = [0.0]

    async def scenario(crew: FakeCrew, _summoner: CrewChatSummoner) -> None:
        env = GatewayEnv(APP_SECRET, crew.origin, "0", "specter-arena")
        summoner = CrewChatSummoner(env, clock=lambda: now[0])
        await summon(summoner)
        await summon(summoner)
        assert len(crew.calls("POST", "/api/apps/specter-arena/token")) == 1
        now[0] = client_module.TOKEN_REFRESH_S + 1
        await summon(summoner)
        assert len(crew.calls("POST", "/api/apps/specter-arena/token")) == 2

    run(Script(send_events=[chunk("ok")]), scenario)


def test_no_log_record_or_failure_text_carries_the_token_or_secret(
    caplog: pytest.LogCaptureFixture,
) -> None:
    async def scenario(crew: FakeCrew, summoner: CrewChatSummoner) -> None:
        with caplog.at_level(logging.DEBUG):
            for _ in range(2):
                try:
                    await summon(summoner)
                except SummonFailure as failure:
                    assert str(failure) in FAILURE_CODES
        assert APP_SECRET not in caplog.text
        assert not any(token in caplog.text for token in crew.tokens)

    run(Script(create_status=409), scenario)


def test_an_unavailable_summoner_always_fails_unavailable() -> None:
    async def attempt() -> None:
        await UnavailableSummoner().summon("p", request_id=REQUEST_ID, timeout_s=1)

    with pytest.raises(SummonFailure) as caught:
        asyncio.run(attempt())
    assert caught.value.code == "unavailable"


def test_an_unknown_failure_code_is_rejected() -> None:
    with pytest.raises(ValueError):
        SummonFailure("bogus")
    assert json.dumps(sorted(FAILURE_CODES))
