import asyncio
import inspect
from collections.abc import Callable

import pytest

from backend.specter_arena.collector.gateway import (
    AuthRejected,
    Feed,
    GatewayPort,
    MalformedAnswer,
    PolicyClose,
    Transient,
)
from backend.specter_arena.store import (
    BindingSeen,
    CoverageMark,
    DmKey,
    IngestBatch,
    IngestResult,
    ObservationIn,
    QuarantineIn,
    RosterPoll,
    RosterRowIn,
    RunStart,
    StoreUnavailable,
    UnknownRun,
    build_dm_key,
)
from backend.tests.collector_fakes import (
    SCRIPT_END,
    START_MS,
    FakeClock,
    FakeGateway,
    FakeSleeper,
    FakeStore,
    FixedRandom,
)

KEY = DmKey("bot-a-9d63166ee3a3", "member-bot-a-9d63166ee3a3-aa11")
OTHER = DmKey("bot-b-0a1b2c3d4e5f", "member-bot-b-0a1b2c3d4e5f-bb22")
DM_KEY = build_dm_key(KEY)
INSTALLATION = "inst_fake_01"
DIGEST = "a" * 64


def run(coro: object) -> object:
    return asyncio.run(coro)  # type: ignore[arg-type]


def row_change(dm_key: str = DM_KEY, digest: str = DIGEST, **overrides: object) -> ObservationIn:
    values: dict[str, object] = {
        "installation_id": INSTALLATION,
        "dm_key": dm_key,
        "slot_key": dm_key,
        "kind": "row-change",
        "event_type": "slot-row",
        "received_at_ms": START_MS,
        "payload": {"running": True},
        "fact_digest": digest,
    }
    values.update(overrides)
    return ObservationIn(**values)  # type: ignore[arg-type]


def event(dedup_key: str | None = "chat_done:k:aa:1", **overrides: object) -> ObservationIn:
    values: dict[str, object] = {
        "installation_id": INSTALLATION,
        "dm_key": DM_KEY,
        "slot_key": DM_KEY,
        "kind": "event",
        "event_type": "chat_done",
        "received_at_ms": START_MS,
        "payload": {"continuing": False},
        "dedup_key": dedup_key,
        "turn": 1,
        "turn_gen": "aa",
    }
    values.update(overrides)
    return ObservationIn(**values)  # type: ignore[arg-type]


def batch(
    *items: object, installation_id: str = INSTALLATION, run_id: str = "run-1"
) -> IngestBatch:
    return IngestBatch(run_id, installation_id, tuple(items))  # type: ignore[arg-type]


def started_store() -> FakeStore:
    store = FakeStore()
    store.start_run(run_id="run-1", now_ms=START_MS)
    store.ingest(batch(BindingSeen(KEY, START_MS)))
    return store


# --- clock, sleeper, random ------------------------------------------------------------


def test_the_clock_advances_wall_and_monotonic_time_together() -> None:
    clock = FakeClock()
    first = clock.monotonic()
    clock.advance(2.5)
    assert clock.now_ms() == START_MS + 2_500
    assert clock.monotonic() == first + 2.5


def test_the_sleeper_records_each_delay_and_moves_the_clock() -> None:
    clock = FakeClock()
    sleeper = FakeSleeper(clock)
    run(sleeper(1))
    run(sleeper(2.5))
    assert sleeper.delays == [1, 2.5]
    assert clock.now_ms() == START_MS + 3_500


def test_a_sleeper_without_a_clock_only_records() -> None:
    sleeper = FakeSleeper()
    run(sleeper(4))
    assert sleeper.delays == [4]


def test_the_random_source_plays_its_script_then_repeats_the_last_value() -> None:
    rng = FixedRandom(0.1, 0.9)
    assert [rng(), rng(), rng()] == [0.1, 0.9, 0.9]
    assert FixedRandom()() == 0.5


# --- gateway ---------------------------------------------------------------------------


def test_the_gateway_fake_satisfies_the_port_and_records_calls_in_order() -> None:
    clock = FakeClock()
    gateway = FakeGateway(
        feeds=[["frame-1", "frame-2"]], answers={"/api/agents": [[{"name": "bot"}]]}, clock=clock
    )
    port: GatewayPort = gateway

    async def scenario() -> list[str | bytes]:
        await port.exchange_token()
        assert await port.get_json("/api/agents") == [{"name": "bot"}]
        received: list[str | bytes] = []
        async with port.open_feed() as feed:
            received += [await feed.recv(), await feed.recv()]
            with pytest.raises(Transient) as ended:
                await feed.recv()
            assert ended.value.reason == SCRIPT_END
        return received

    assert run(scenario()) == ["frame-1", "frame-2"]
    assert [call.kind for call in gateway.calls] == ["exchange", "get", "feed"]
    assert [call.credential for call in gateway.calls] == [None, "token-1", "token-1"]
    assert gateway.calls_of("get")[0].target == "/api/agents"


def test_each_exchange_mints_a_new_credential_and_resets_the_token_age() -> None:
    clock = FakeClock()
    gateway = FakeGateway(clock=clock)
    assert gateway.token_age_s == float("inf")
    run(gateway.exchange_token())
    clock.advance(30)
    assert gateway.token_age_s == 30
    run(gateway.exchange_token())
    assert gateway.credential == "token-2"
    assert gateway.token_age_s == 0
    assert gateway.exchange_count == 2


def test_scripted_exchange_failures_are_raised_then_the_next_call_succeeds() -> None:
    gateway = FakeGateway(exchanges=[AuthRejected(403, exchange=True), None])
    with pytest.raises(AuthRejected):
        run(gateway.exchange_token())
    assert gateway.exchange_count == 0
    run(gateway.exchange_token())
    assert gateway.exchange_count == 1


def test_scripted_json_answers_are_consumed_in_order_and_the_last_repeats() -> None:
    gateway = FakeGateway(answers={"/api/agents": [AuthRejected(403), {"a": 1}, {"a": 2}]})

    async def scenario() -> list[object]:
        seen: list[object] = []
        with pytest.raises(AuthRejected):
            await gateway.get_json("/api/agents")
        for _ in range(3):
            seen.append(await gateway.get_json("/api/agents"))
        return seen

    assert run(scenario()) == [{"a": 1}, {"a": 2}, {"a": 2}]


def test_an_unscripted_path_is_a_malformed_answer() -> None:
    with pytest.raises(MalformedAnswer):
        run(FakeGateway().get_json("/api/agents"))


def test_a_feed_script_can_raise_mid_stream_and_open_can_itself_fail() -> None:
    gateway = FakeGateway(feeds=[["a", PolicyClose()], AuthRejected(403)])

    async def scenario() -> None:
        async with gateway.open_feed() as feed:
            assert await feed.recv() == "a"
            with pytest.raises(PolicyClose):
                await feed.recv()
        with pytest.raises(AuthRejected):
            async with gateway.open_feed():
                pass
        with pytest.raises(Transient):
            async with gateway.open_feed():
                pass

    run(scenario())


def test_feed_frames_may_be_bytes() -> None:
    gateway = FakeGateway(feeds=[[b"\x00"]])

    async def scenario() -> object:
        feed: Feed
        async with gateway.open_feed() as feed:
            return await feed.recv()

    assert run(scenario()) == b"\x00"


def test_a_two_step_scenario_drives_a_feed_through_one_reconnect() -> None:
    clock = FakeClock()
    sleeper = FakeSleeper(clock)
    gateway = FakeGateway(feeds=[["first", Transient("dropped")], ["second"]], clock=clock)

    async def scenario() -> list[str]:
        frames: list[str] = []
        for attempt in range(2):
            try:
                async with gateway.open_feed() as feed:
                    while True:
                        frame = await feed.recv()
                        assert isinstance(frame, str)
                        frames.append(frame)
            except Transient:
                await sleeper(1 * 2**attempt)
        return frames

    assert run(scenario()) == ["first", "second"]
    assert sleeper.delays == [1, 2]
    assert len(gateway.calls_of("feed")) == 2


# --- store: the SC3-2 signatures -------------------------------------------------------


def test_the_store_fake_uses_the_sc3_2_signatures() -> None:
    expected: dict[str, list[str]] = {
        "start_run": ["run_id", "now_ms"],
        "heartbeat": ["run_id", "now_ms"],
        "end_run": ["run_id", "now_ms", "reason"],
        "ingest": ["batch"],
        "set_paused": ["paused", "now_ms"],
        "roster_revision": [],
    }
    for name, parameters in expected.items():
        method: Callable[..., object] = getattr(FakeStore, name)
        assert list(inspect.signature(method).parameters)[1:] == parameters, name
    for name in ("start_run", "heartbeat", "end_run"):
        kinds = [
            p.kind
            for p in list(inspect.signature(getattr(FakeStore, name)).parameters.values())[1:]
        ]
        assert set(kinds) == {inspect.Parameter.KEYWORD_ONLY}


def test_start_run_returns_the_real_type_and_recovers_an_unfinished_run() -> None:
    store = FakeStore()
    first = store.start_run(run_id="run-1", now_ms=START_MS)
    assert isinstance(first, RunStart)
    assert (first.installation_id, first.recovered_runs, first.previous_ended_ms) == (
        INSTALLATION,
        0,
        None,
    )
    store.heartbeat(run_id="run-1", now_ms=START_MS + 5_000)
    second = store.start_run(run_id="run-2", now_ms=START_MS + 60_000)
    assert (second.recovered_runs, second.previous_ended_ms) == (1, START_MS + 5_000)
    assert store.runs["run-1"].end_reason == "restart"


def test_end_run_closes_a_run_and_an_unknown_run_raises() -> None:
    store = FakeStore()
    store.start_run(run_id="run-1", now_ms=START_MS)
    store.end_run(run_id="run-1", now_ms=START_MS + 1, reason="restart")
    assert store.runs["run-1"].ended_ms == START_MS + 1
    assert store.start_run(run_id="run-2", now_ms=START_MS + 2).recovered_runs == 0
    with pytest.raises(UnknownRun):
        store.heartbeat(run_id="nope", now_ms=1)
    with pytest.raises(UnknownRun):
        store.end_run(run_id="nope", now_ms=1, reason="restart")


def test_a_scripted_store_failure_raises_store_unavailable_then_recovers() -> None:
    store = FakeStore(fail_next=2)
    with pytest.raises(StoreUnavailable):
        store.start_run(run_id="run-1", now_ms=START_MS)
    with pytest.raises(StoreUnavailable):
        store.roster_revision()
    assert store.roster_revision() == 0


def test_pause_flag_is_reported_by_start_run() -> None:
    store = FakeStore()
    store.set_paused(True, START_MS)
    assert store.start_run(run_id="run-1", now_ms=START_MS).paused is True


# --- store: ingest ---------------------------------------------------------------------


def test_a_binding_is_created_once_and_known_afterwards() -> None:
    store = FakeStore()
    store.start_run(run_id="run-1", now_ms=START_MS)
    first = store.ingest(batch(BindingSeen(KEY, START_MS)))
    again = store.ingest(batch(BindingSeen(KEY, START_MS + 1)))
    assert isinstance(first, IngestResult)
    assert first.counts["binding"].persisted == 1 and first.bindings[0].created is True
    assert again.counts["binding"].deduplicated == 1 and again.bindings[0].created is False
    known = store.start_run(run_id="run-2", now_ms=START_MS + 9).bindings
    assert [(b.dm_key, b.memory_store) for b in known] == [(DM_KEY, KEY.memory_store)]


def test_a_store_less_binding_is_rejected_and_a_shared_store_is_ambiguous() -> None:
    store = FakeStore()
    result = store.ingest(batch(BindingSeen(DmKey("bot-c", ""), START_MS)))
    assert result.rejections[0].reason == "store-less-bot"
    store.ingest(batch(BindingSeen(KEY, START_MS)))
    clash = store.ingest(batch(BindingSeen(DmKey("bot-z", KEY.memory_store), START_MS)))
    assert clash.rejections[0].reason in {"ambiguous-store", "bad-dm-key"}


def test_a_wrong_installation_rejects_every_item_and_writes_nothing() -> None:
    store = started_store()
    result = store.ingest(batch(row_change(), event(), installation_id="inst_other"))
    assert [r.reason for r in result.rejections] == ["wrong-installation"] * 2
    assert store.observations == []


def test_an_observation_that_omits_the_installation_id_is_rejected() -> None:
    store = started_store()
    result = store.ingest(batch(row_change(installation_id="")))
    assert result.rejections[0].reason == "wrong-installation"


def test_an_observation_for_an_unknown_binding_is_rejected() -> None:
    store = started_store()
    result = store.ingest(batch(row_change(dm_key=build_dm_key(OTHER))))
    assert result.rejections[0].reason == "unknown-binding"


def test_an_item_after_its_binding_in_the_same_batch_is_accepted() -> None:
    store = FakeStore()
    result = store.ingest(batch(BindingSeen(KEY, START_MS), row_change()))
    assert result.counts["binding"].persisted == 1
    assert result.counts["observation"].persisted == 1


def test_row_changes_are_deduplicated_by_digest_per_slot() -> None:
    store = started_store()
    first = store.ingest(batch(row_change()))
    same = store.ingest(batch(row_change()))
    changed = store.ingest(batch(row_change(digest="b" * 64)))
    other_slot = store.ingest(batch(row_change(slot_key="chat-1")))
    assert first.counts["observation"].persisted == 1
    assert same.counts["observation"].deduplicated == 1
    assert changed.counts["observation"].persisted == 1
    assert other_slot.counts["observation"].persisted == 1
    assert len(store.observations) == 3


def test_events_are_deduplicated_by_key_and_a_null_key_is_never_a_duplicate() -> None:
    store = started_store()
    outcomes = [
        store.ingest(batch(event())).counts["observation"],
        store.ingest(batch(event())).counts["observation"],
        store.ingest(batch(event("chat_done:k:aa:2"))).counts["observation"],
        store.ingest(batch(event(None))).counts["observation"],
        store.ingest(batch(event(None))).counts["observation"],
    ]
    assert [(o.persisted, o.deduplicated) for o in outcomes] == [
        (1, 0),
        (0, 1),
        (1, 0),
        (1, 0),
        (1, 0),
    ]


def test_bad_dedup_shapes_are_rejected() -> None:
    store = started_store()
    with_key = store.ingest(batch(row_change(dedup_key="row:x")))
    without_digest = store.ingest(batch(row_change(fact_digest=None)))
    event_digest = store.ingest(batch(event(fact_digest=DIGEST)))
    for result in (with_key, without_digest, event_digest):
        assert result.rejections[0].reason == "bad-dedup"


def test_a_bad_item_does_not_stop_its_neighbours() -> None:
    store = started_store()
    result = store.ingest(batch(row_change(dm_key=build_dm_key(OTHER)), row_change()))
    assert result.counts["observation"].rejected == 1
    assert result.counts["observation"].persisted == 1
    assert [r.index for r in result.rejections] == [0]


def test_a_persisted_turn_updates_the_known_binding_for_the_next_run() -> None:
    store = started_store()
    store.ingest(batch(event(turn=4, turn_gen="bb")))
    [known] = store.start_run(run_id="run-2", now_ms=START_MS + 1).bindings
    assert (known.last_turn, known.last_turn_gen) == (4, "bb")


def test_coverage_marks_and_quarantine_are_recorded_and_counted_by_kind() -> None:
    store = started_store()
    mark = CoverageMark("gap", START_MS, reason="disconnect")
    quarantined = QuarantineIn(START_MS, "unknown-event-type", "brand_new", 10, count=7)
    result = store.ingest(batch(mark, quarantined))
    assert result.counts["coverage"].persisted == 1
    assert result.counts["quarantine"].quarantined == 1
    assert store.coverage == [mark] and store.quarantine == [quarantined]


def test_roster_polls_count_unmatched_rows_bump_the_revision_and_dedupe_repeats() -> None:
    store = started_store()
    rows = (
        RosterRowIn(KEY.memory_store, "bot-a", "Bot A", "image", "a.png"),
        RosterRowIn("member-unknown-store", "ghost", None, None, None),
    )
    poll = RosterPoll(True, START_MS, rows)
    first = store.ingest(batch(poll))
    repeat = store.ingest(batch(poll))
    assert (first.counts["roster"].persisted, first.roster_unmatched) == (1, 1)
    assert repeat.counts["roster"].deduplicated == 1
    assert store.roster_revision() == 1
    store.ingest(batch(RosterPoll(False, START_MS + 1, (), "roster-unavailable")))
    assert store.roster_revision() == 2


def test_a_roster_poll_for_an_unknown_run_is_rejected() -> None:
    store = FakeStore()
    result = store.ingest(batch(RosterPoll(True, START_MS), run_id="nope"))
    assert result.rejections[0].reason == "unknown-run"


def test_every_batch_is_kept_for_assertions() -> None:
    store = started_store()
    assert len(store.batches) == 1
    store.ingest(batch(row_change()))
    assert len(store.batches) == 2
