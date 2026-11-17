"""FP-03-AC04: revoked permission, a disabled app and an authentication failure stop collection
safely, and no call ever carries a credential other than the token the app secret bought."""

import asyncio
from typing import Any

import pytest

from backend.specter_arena.collector.gateway import (
    AuthRejected,
    MalformedAnswer,
    PolicyClose,
    Transient,
)
from backend.specter_arena.collector.supervisor import CollectionStopped, State
from backend.specter_arena.config import Grants
from backend.tests.collector_fakes import FakeStore
from backend.tests.collector_scenarios import (
    KEY_A,
    NARROWED,
    agent_row,
    bot_row,
    build,
    slots,
    until,
)

END = Transient("scripted-end")


def run(coro: Any) -> Any:
    return asyncio.run(coro)


def stopped(harness: Any, reason: str) -> bool:
    status = harness.collector.status()
    return bool(status.state is State.STOPPED and status.reason_code == reason)


def test_a_manifest_that_loses_a_grant_stops_the_feed_with_scope_lost_or_silent() -> None:
    harness = build(feeds=[[slots(bot_row()), END]])
    harness.grants_now[0] = NARROWED

    async def scenario() -> None:
        await harness.collector.begin()
        with pytest.raises(CollectionStopped) as caught:
            await harness.collector.feed_once()
        assert caught.value.reason == "scope-lost-or-silent"

    run(scenario())
    assert harness.gateway.calls == []


def test_a_roster_poll_rereads_the_manifest_and_stops_when_a_grant_is_gone() -> None:
    harness = build(feeds=[[slots(bot_row()), END]], answers={"/api/agents": [[]]})

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.feed_once()
        harness.grants_now[0] = NARROWED
        with pytest.raises(CollectionStopped) as caught:
            await harness.collector.poll_roster()
        assert caught.value.reason == "scope-lost-or-silent"

    run(scenario())
    assert harness.gateway.calls_of("get") == []


def test_the_loop_stops_on_a_narrowed_manifest_and_records_the_stop_in_the_store() -> None:
    harness = build(feeds=[[slots(bot_row())]], holding=True)

    async def scenario() -> None:
        await harness.collector.start()
        await until(lambda: len(harness.fake_store.observations) == 1)
        harness.grants_now[0] = NARROWED
        await harness.collector._guarded(harness.collector.poll_roster)
        await until(lambda: stopped(harness, "scope-lost-or-silent"))
        await harness.collector.wait_closed()
        await harness.collector.stop()

    run(scenario())
    store = harness.fake_store
    assert store.runs["run-1"].end_reason == "scope-lost-or-silent"
    assert [m.reason for m in store.coverage if m.action == "close"][-1] == "scope-lost-or-silent"


def test_unreadable_grants_do_not_stop_the_collector_but_are_counted() -> None:
    harness = build(feeds=[[slots(bot_row()), END]])
    harness.grants_now[0] = Grants.assumed("manifest-unreadable: OSError")

    async def scenario() -> None:
        await harness.collector.begin()
        assert await harness.collector.feed_once() is False

    run(scenario())
    assert harness.collector.diagnostics()["counters"] == {"grants-unverified": 1}


def test_close_1008_stops_with_app_disabled_and_never_dials_again() -> None:
    harness = build(feeds=[[slots(bot_row()), PolicyClose()], [slots(bot_row())]])

    async def scenario() -> None:
        await harness.collector.start()
        await until(lambda: stopped(harness, "app-disabled"))
        await harness.collector.wait_closed()

    run(scenario())
    assert len(harness.gateway.calls_of("feed")) == 1
    store = harness.fake_store
    assert store.runs["run-1"].end_reason == "app-disabled"
    assert [m.reason for m in store.coverage if m.action == "close"] == ["app-disabled"]
    assert len(store.observations) == 1


def test_one_fresh_exchange_then_the_retried_feed_may_succeed() -> None:
    harness = build(feeds=[AuthRejected(403), [slots(bot_row()), END]])

    async def scenario() -> None:
        await harness.collector.begin()
        assert await harness.collector.feed_once() is True
        assert await harness.collector.feed_once() is False

    run(scenario())
    assert harness.gateway.exchange_count == 2
    assert len(harness.fake_store.observations) == 1


def test_a_second_403_in_the_same_episode_stops_with_auth_stopped() -> None:
    harness = build(feeds=[AuthRejected(403), AuthRejected(403), [slots(bot_row())]])

    async def scenario() -> None:
        await harness.collector.begin()
        assert await harness.collector.feed_once() is True
        with pytest.raises(CollectionStopped) as caught:
            await harness.collector.feed_once()
        assert caught.value.reason == "auth-stopped"

    run(scenario())
    assert harness.gateway.exchange_count == 2


def test_the_fresh_token_allowance_is_restored_once_frames_flow() -> None:
    harness = build(
        feeds=[AuthRejected(403), [slots(bot_row()), END], AuthRejected(403), [slots(bot_row())]]
    )

    async def scenario() -> None:
        await harness.collector.begin()
        assert await harness.collector.feed_once() is True
        assert await harness.collector.feed_once() is False
        assert await harness.collector.feed_once() is True

    run(scenario())
    assert harness.gateway.exchange_count == 3


def test_a_rejected_exchange_stops_with_auth_stopped() -> None:
    harness = build(exchanges=[AuthRejected(403, exchange=True)])

    async def scenario() -> None:
        await harness.collector.begin()
        with pytest.raises(CollectionStopped) as caught:
            await harness.collector.feed_once()
        assert caught.value.reason == "auth-stopped"

    run(scenario())
    assert harness.gateway.calls_of("feed") == []


def test_a_rejected_fresh_exchange_after_a_403_stops_too() -> None:
    harness = build(feeds=[AuthRejected(403)], exchanges=[None, AuthRejected(403, exchange=True)])

    async def scenario() -> None:
        await harness.collector.begin()
        with pytest.raises(CollectionStopped) as caught:
            await harness.collector.feed_once()
        assert caught.value.reason == "auth-stopped"

    run(scenario())


def test_a_transient_exchange_error_is_retried_with_backoff_not_stopped() -> None:
    harness = build(
        feeds=[[slots(bot_row()), PolicyClose()]],
        exchanges=[Transient("exchange-500"), None],
    )

    async def scenario() -> None:
        await harness.collector.start()
        await until(lambda: stopped(harness, "app-disabled"))
        await harness.collector.wait_closed()

    run(scenario())
    assert 1 in harness.sleeper.delays
    assert harness.gateway.exchange_count == 1


def test_a_transient_fresh_exchange_after_a_403_backs_off_instead_of_spinning() -> None:
    harness = build(feeds=[AuthRejected(403)], exchanges=[None, Transient("exchange-500")])

    async def scenario() -> None:
        await harness.collector.begin()
        assert await harness.collector.feed_once() is False

    run(scenario())


def test_a_roster_403_gets_one_fresh_exchange_and_one_retry_then_stops() -> None:
    rows = [agent_row(KEY_A.memory_store)]
    harness = build(
        feeds=[[slots(bot_row()), END]],
        answers={"/api/agents": [AuthRejected(403), rows]},
    )

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.feed_once()
        await harness.collector.poll_roster()

    run(scenario())
    assert harness.fake_store.polls[0].success is True
    assert harness.gateway.exchange_count == 2

    stopping = build(
        feeds=[[slots(bot_row()), END]],
        answers={"/api/agents": [AuthRejected(403)]},
    )

    async def second() -> None:
        await stopping.collector.begin()
        await stopping.collector.feed_once()
        with pytest.raises(CollectionStopped) as caught:
            await stopping.collector.poll_roster()
        assert caught.value.reason == "auth-stopped"

    run(second())
    assert stopping.gateway.exchange_count == 2
    assert len(stopping.gateway.calls_of("get")) == 2


def test_a_roster_retry_that_fails_transiently_is_a_failed_poll_not_a_stop() -> None:
    harness = build(
        feeds=[[slots(bot_row()), END]],
        answers={"/api/agents": [AuthRejected(403), MalformedAnswer()]},
    )

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.feed_once()
        await harness.collector.poll_roster()

    run(scenario())
    assert harness.fake_store.polls[0].success is False


def test_a_roster_exchange_failure_during_refresh_is_a_failed_poll() -> None:
    harness = build(
        feeds=[[slots(bot_row()), END]],
        answers={"/api/agents": [AuthRejected(403)]},
        exchanges=[None, Transient("exchange-500")],
    )

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.feed_once()
        await harness.collector.poll_roster()

    run(scenario())
    assert harness.fake_store.polls[0].success is False


def test_the_token_is_renewed_after_forty_five_minutes_once_even_for_concurrent_callers() -> None:
    rows = [agent_row(KEY_A.memory_store)]
    harness = build(feeds=[[slots(bot_row()), END]], answers={"/api/agents": [rows]})

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.feed_once()
        before = harness.gateway.exchange_count
        harness.clock.advance(45 * 60 + 1)
        await asyncio.gather(harness.collector.poll_roster(), harness.collector.poll_roster())
        assert harness.gateway.exchange_count == before + 1

    run(scenario())


def test_a_young_token_is_not_renewed() -> None:
    rows = [agent_row(KEY_A.memory_store)]
    harness = build(feeds=[[slots(bot_row()), END]], answers={"/api/agents": [rows]})

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.feed_once()
        harness.clock.advance(44 * 60)
        await harness.collector.poll_roster()

    run(scenario())
    assert harness.gateway.exchange_count == 1


def test_a_rejected_renewal_stops_collection() -> None:
    harness = build(
        feeds=[[slots(bot_row()), END]],
        answers={"/api/agents": [[]]},
        exchanges=[None, AuthRejected(401, exchange=True)],
    )

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.feed_once()
        harness.clock.advance(46 * 60)
        with pytest.raises(CollectionStopped) as caught:
            await harness.collector.poll_roster()
        assert caught.value.reason == "auth-stopped"

    run(scenario())


def test_every_gateway_call_carries_only_the_exchanged_token() -> None:
    harness = build(
        feeds=[[slots(bot_row()), END]], answers={"/api/agents": [[agent_row(KEY_A.memory_store)]]}
    )

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.feed_once()
        await harness.collector.poll_roster()

    run(scenario())
    allowed = {None, harness.gateway.credential}
    assert {call.credential for call in harness.gateway.calls} <= allowed
    assert {call.kind for call in harness.gateway.calls} == {"exchange", "feed", "get"}


def test_a_stopped_collector_keeps_serving_its_status_and_a_second_stop_is_quiet() -> None:
    harness = build(feeds=[[PolicyClose()]])

    async def scenario() -> None:
        await harness.collector.start()
        await until(lambda: stopped(harness, "app-disabled"))
        await harness.collector.wait_closed()
        await harness.collector.stop()
        await harness.collector.stop()

    run(scenario())
    status = harness.collector.status()
    assert (status.state, status.reason_code) == (State.STOPPED, "app-disabled")
    assert harness.collector.diagnostics()["state"] == "stopped"


def test_a_stop_on_an_unavailable_store_still_ends_collection() -> None:
    store = FakeStore()
    harness = build(store=store, feeds=[[slots(bot_row()), PolicyClose()]])

    async def scenario() -> None:
        await harness.collector.start()
        await until(lambda: harness.gateway.calls_of("feed") != [])
        store.fail_next = 100
        await until(lambda: stopped(harness, "app-disabled"))
        await harness.collector.wait_closed()

    run(scenario())
    assert stopped(harness, "app-disabled")


def test_nothing_in_the_calls_names_a_cookie_or_a_second_secret() -> None:
    harness = build(feeds=[[slots(bot_row()), END]])

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.feed_once()

    run(scenario())
    for call in harness.gateway.calls:
        assert call.target in (None, "/api/agents")
        assert call.credential in (None, harness.gateway.credential)
