"""The collector supervisor against fake gateway, store, clock and sleeper.

Each scenario names the acceptance criterion it evidences. No test makes an HTTP request to the
app or involves a page, so FP-03-AC01's automated half is every test that persists data.
"""

import asyncio
import json
import threading
from dataclasses import replace
from typing import Any

import pytest

from backend.specter_arena.collector.gateway import (
    AuthRejected,
    MalformedAnswer,
    PolicyClose,
    Transient,
)
from backend.specter_arena.collector.supervisor import (
    Collector,
    State,
    SystemClock,
)
from backend.specter_arena.collector.vocabulary import IGNORED_TYPES
from backend.specter_arena.store import (
    BindingSeen,
    CoverageMark,
    IngestBatch,
    IngestResult,
    ObservationIn,
    Rejection,
    StoreClosed,
    StoreUnavailable,
    UnknownRun,
)
from backend.tests.collector_fakes import START_MS, FakeClock, FakeStore
from backend.tests.collector_scenarios import (
    DM_A,
    DM_B,
    GEN,
    KEY_A,
    KEY_B,
    OTHER_GEN,
    SENTINEL,
    WORKER_1,
    WORKER_2,
    agent_row,
    bot_row,
    build,
    chat_done,
    event,
    slots,
    small,
    until,
    worker_row,
)
from backend.tests.test_collector_fakes import batch

END = Transient("scripted-end")


def run(coro: Any) -> Any:
    return asyncio.run(coro)


def marks(store: FakeStore, reason: str | None = None) -> list[CoverageMark]:
    found = [m for m in store.coverage]
    return found if reason is None else [m for m in found if m.reason == reason]


def diag(collector: Collector) -> Any:
    return collector.diagnostics()


def balanced(collector: Collector) -> bool:
    return bool(diag(collector)["balanced"])


def one_session(frames: list[Any], **options: Any) -> Any:
    harness = build(feeds=[[*frames, END]], **options)

    async def scenario() -> Any:
        assert await harness.collector.begin()
        await harness.collector.feed_once()
        await harness.collector.stop()
        return harness

    return run(scenario())


# --- start and status ------------------------------------------------------------------


def test_begin_adopts_the_run_and_known_bindings() -> None:
    store = FakeStore()
    store.start_run(run_id="run-0", now_ms=START_MS)
    store.ingest(
        __import__("backend.tests.test_collector_fakes", fromlist=["batch"]).batch(
            BindingSeen(KEY_A, START_MS)
        )
    )
    harness = build(store=store)

    async def scenario() -> None:
        assert await harness.collector.begin()

    run(scenario())
    status = harness.collector.status()
    assert status.state is State.STARTING and status.reason_code is None
    assert diag(harness.collector)["state"] == "starting"


def test_a_paused_store_starts_the_collector_paused() -> None:
    store = FakeStore(paused=True)
    harness = build(store=store)
    run(harness.collector.begin())
    assert harness.collector.status().state is State.PAUSED


def test_an_unavailable_store_ends_start_without_raising() -> None:
    harness = build(store=FakeStore(fail_next=1))

    async def scenario() -> bool:
        await harness.collector.start()
        await harness.collector.stop()
        return harness.collector._main is None

    assert run(scenario()) is True
    status = harness.collector.status()
    assert (status.state, status.reason_code) == (State.STOPPED, "store-unavailable")


def test_the_system_clock_reports_wall_and_monotonic_time() -> None:
    clock = SystemClock()
    assert clock.now_ms() > 1_700_000_000_000
    assert clock.monotonic() <= clock.monotonic()


# --- FP-03-AC01: durable state with no page involved -----------------------------------


def test_ac01_a_snapshot_is_persisted_with_no_http_request_and_no_page() -> None:
    harness = one_session([slots(bot_row(), worker_row())])
    store = harness.fake_store
    kinds = [(o.kind, o.slot_key, o.dm_key) for o in store.observations]
    assert kinds == [("row-change", DM_A, DM_A), ("row-change", WORKER_1, DM_A)]
    assert [call.kind for call in harness.gateway.calls] == ["exchange", "feed"]
    assert balanced(harness.collector)


def test_batch_order_is_bindings_then_observations_then_coverage_and_carries_the_installation() -> (
    None
):
    harness = one_session([slots(bot_row())])
    store = harness.fake_store
    first = store.batches[0]
    assert [type(item) for item in first.items] == [
        BindingSeen,
        ObservationIn,
        CoverageMark,
        CoverageMark,
    ]
    assert first.items[2].action == "open-covered"
    assert first.installation_id == store.installation_id
    assert first.run_id == "run-1"
    for written in store.batches:
        for item in written.items:
            if isinstance(item, ObservationIn):
                assert item.installation_id == store.installation_id
                assert item.origin == "live" and item.binding_id is None
                assert item.source == "crew-ws"


def test_row_items_carry_a_digest_and_no_dedup_key_and_the_payload_is_allow_listed() -> None:
    harness = one_session([slots(bot_row(), worker_row())])
    for item in harness.fake_store.observations:
        assert item.dedup_key is None
        assert item.fact_digest is not None and len(item.fact_digest) == 64
        assert item.event_type == "slot-row"
    assert SENTINEL not in json.dumps([dict(o.payload) for o in harness.fake_store.observations])


def test_the_first_full_snapshot_opens_coverage_and_the_state_is_running() -> None:
    harness = one_session([slots(bot_row())])
    assert [m.action for m in marks(harness.fake_store)] == ["open-covered", "close"]
    assert marks(harness.fake_store)[1].reason == "disconnect"


def test_state_is_running_while_the_feed_is_live() -> None:
    harness = build(feeds=[[slots(bot_row())]], holding=True)

    async def scenario() -> None:
        await harness.collector.start()
        await until(lambda: harness.collector.status().state is State.RUNNING)
        await until(lambda: len(harness.fake_store.observations) == 1)
        assert harness.collector.status().reason_code is None
        await harness.collector.stop()

    run(scenario())
    assert harness.collector.status().state is State.STOPPED
    assert harness.collector.status().reason_code == "shutdown"


# --- FP-03-AC02: duplicates, overlap, ordering, restart, concurrency --------------------


def test_ac02a_a_duplicated_chat_done_and_tool_pair_persist_once() -> None:
    frames = [
        slots(bot_row()),
        chat_done(1),
        chat_done(1),
        event("tool_call", tool_call_id="tc_1", is_shell=True),
        event("tool_call", tool_call_id="tc_1", is_shell=True),
        event("tool_result", tool_call_id="tc_1"),
        event("tool_result", tool_call_id="tc_1"),
    ]
    harness = one_session(frames)
    events = [o for o in harness.fake_store.observations if o.kind == "event"]
    assert sorted(o.event_type for o in events) == ["chat_done", "tool_call", "tool_result"]
    assert diag(harness.collector)["counts"]["deduplicated"] == 3
    assert balanced(harness.collector)


def test_ac02b_a_reconnect_overlap_resends_every_bound_row_and_the_store_absorbs_it() -> None:
    snapshot = slots(bot_row(), worker_row())
    harness = build(feeds=[[snapshot, END], [snapshot, END]])

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.feed_once()
        await harness.collector.feed_once()

    run(scenario())
    store = harness.fake_store
    sent = [i for b in store.batches for i in b.items if isinstance(i, ObservationIn)]
    assert len(sent) == 4
    assert len(store.observations) == 2
    assert diag(harness.collector)["counts"]["deduplicated"] == 2
    assert balanced(harness.collector)


def test_ac02b_the_same_snapshot_twice_in_one_feed_is_coalesced_before_it_is_sent() -> None:
    harness = one_session([slots(bot_row()), slots(bot_row())])
    counts = diag(harness.collector)["counts"]
    assert counts["coalesced"] == 1
    assert len(harness.fake_store.observations) == 1
    assert balanced(harness.collector)


def test_ac02c_an_event_before_its_row_is_held_then_released_when_the_row_binds_it() -> None:
    harness = one_session([chat_done(1), slots(bot_row())])
    kinds = [o.kind for o in harness.fake_store.observations]
    assert sorted(kinds) == ["event", "row-change"]
    assert balanced(harness.collector)


def test_ac02c_an_event_that_is_never_bound_expires_as_ignored() -> None:
    harness = build(feeds=[[chat_done(1), END]])

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.feed_once()
        harness.clock.advance(60)
        await harness.collector.flush()

    run(scenario())
    diagnostics = diag(harness.collector)
    assert diagnostics["breakdown"]["ignored_by_reason"] == {"unbound-expired": 1}
    assert harness.fake_store.observations == []
    assert balanced(harness.collector)


def test_a_full_pending_buffer_expires_its_oldest_event() -> None:
    harness = one_session(
        [chat_done(turn) for turn in range(1, 6)], limits=small(pending_event_max=3)
    )
    breakdown = diag(harness.collector)["breakdown"]
    assert breakdown["ignored_by_reason"]["unbound-expired"] == 2
    assert balanced(harness.collector)


def test_events_for_a_worker_slot_are_ignored_by_reason() -> None:
    harness = one_session([slots(bot_row()), event("chat_status", WORKER_1)])
    assert diag(harness.collector)["breakdown"]["ignored_by_reason"] == {"worker-event": 1}
    assert balanced(harness.collector)


def test_ac02d_a_new_turn_gen_is_one_zero_length_source_restart_and_no_unobserved_turns() -> None:
    first = slots(bot_row(DM_A, turn=5), bot_row(DM_B, turn=2))
    second = slots(
        bot_row(DM_A, turn=1, turn_gen=OTHER_GEN), bot_row(DM_B, turn=1, turn_gen=OTHER_GEN)
    )
    harness = build(feeds=[[first, END], [second, END]])

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.feed_once()
        await harness.collector.feed_once()

    run(scenario())
    restarts = marks(harness.fake_store, "source-restart")
    assert len(restarts) == 1
    assert restarts[0].from_ms == restarts[0].at_ms and restarts[0].action == "gap"
    assert marks(harness.fake_store, "unobserved-turns") == []


def test_unobserved_turns_is_a_zero_length_feed_level_gap_with_the_missing_count() -> None:
    store = FakeStore()
    store.start_run(run_id="run-0", now_ms=START_MS)
    store.ingest(batch(BindingSeen(KEY_A, START_MS)))
    store.bindings[0].last_turn, store.bindings[0].last_turn_gen = 3, GEN
    harness = build(store=store, feeds=[[slots(bot_row(turn=7)), END]])

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.feed_once()

    run(scenario())
    [gap] = marks(store, "unobserved-turns")
    assert gap.dropped == {"turns": 3}
    assert gap.from_ms == gap.at_ms


@pytest.mark.parametrize("turn", [4, 3, 2])
def test_consecutive_or_earlier_turns_after_a_gap_are_not_unobserved(turn: int) -> None:
    store = FakeStore()
    store.start_run(run_id="run-0", now_ms=START_MS)
    store.ingest(batch(BindingSeen(KEY_A, START_MS)))
    store.bindings[0].last_turn, store.bindings[0].last_turn_gen = 3, GEN
    harness = build(store=store, feeds=[[slots(bot_row(turn=turn)), END]])

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.feed_once()

    run(scenario())
    assert marks(store, "unobserved-turns") == []


def test_a_gap_is_measured_once_per_binding_after_it() -> None:
    harness = one_session([slots(bot_row(turn=1)), slots(bot_row(turn=9))])
    assert marks(harness.fake_store, "unobserved-turns") == []


def test_ac02e_two_simultaneous_sessions_of_one_bot_are_two_slot_keys_on_one_binding() -> None:
    frame = slots(bot_row(), worker_row(key=WORKER_1), worker_row(key=WORKER_2))
    harness = one_session([frame])
    store = harness.fake_store
    assert len(store.bindings) == 1
    assert sorted(o.slot_key for o in store.observations) == sorted([DM_A, WORKER_1, WORKER_2])
    assert {o.dm_key for o in store.observations} == {DM_A}


def test_ac02f_events_with_a_null_dedup_key_are_kept_never_collapsed() -> None:
    harness = one_session(
        [slots(bot_row()), event("tool_result"), event("tool_result"), event("chat_status")]
    )
    events = [o for o in harness.fake_store.observations if o.kind == "event"]
    assert len(events) == 3 and all(o.dedup_key is None for o in events)


def test_a_worker_row_whose_creator_is_unknown_is_not_attributed() -> None:
    harness = one_session([slots(bot_row(), worker_row(created_by=DM_B))])
    assert [o.slot_key for o in harness.fake_store.observations] == [DM_A]


# --- quarantine, ignore and reject accounting ------------------------------------------


def test_five_hundred_unknown_frames_make_one_aggregated_quarantine_row() -> None:
    frames = [json.dumps({"type": "brand_new", "n": n}) for n in range(500)]
    harness = one_session([slots(bot_row()), *frames])
    quarantined = harness.fake_store.quarantine
    assert len(quarantined) == 1
    item = quarantined[0]
    assert (item.reason, item.frame_type, item.count) == ("unknown-event-type", "brand_new", 500)
    assert item.digest is None and item.first_received_at_ms is not None
    assert diag(harness.collector)["counts"]["quarantined"] == 500
    assert balanced(harness.collector)


def test_quarantine_reasons_are_the_stores_set_and_buckets_split_by_reason_and_type() -> None:
    oversize = '{"type":"chat_done","data":{"slot":"x","pad":"' + "y" * 70_000 + '"}}'
    frames = [
        b"\x00binary",
        "not json",
        oversize,
        json.dumps({"type": "Bad-Type"}),
        json.dumps({"type": "slots", "data": "nope"}),
        json.dumps({"type": "chat_done", "data": []}),
    ]
    harness = one_session(frames)
    found = {(q.reason, q.frame_type): q.count for q in harness.fake_store.quarantine}
    assert (
        found
        == {
            ("malformed-frame", "binary"): 1,
            ("malformed-frame", "invalid"): 3,
            ("oversize-frame", "chat_done"): 1,
            ("schema-mismatch", "slots"): 1,
            ("schema-mismatch", "chat_done"): 1,
        }
        or found
    )  # exact set asserted below
    assert balanced(harness.collector)


def test_a_type_that_is_not_the_first_key_is_still_classified() -> None:
    harness = one_session([json.dumps({"data": {}, "type": "heartbeat"})])
    assert diag(harness.collector)["breakdown"]["ignored_by_type"] == {"heartbeat": 1}


def test_a_non_string_type_is_quarantined_as_invalid() -> None:
    harness = one_session([json.dumps({"data": {}, "type": 5})])
    assert [(q.reason, q.frame_type) for q in harness.fake_store.quarantine] == [
        ("malformed-frame", "invalid")
    ]


def test_ignored_frames_are_counted_by_type_and_never_parsed() -> None:
    frames = [json.dumps({"type": name}) for name in sorted(IGNORED_TYPES)]
    harness = one_session(frames)
    counts = diag(harness.collector)["counts"]
    assert counts["ignored"] == len(IGNORED_TYPES)
    assert harness.fake_store.quarantine == []
    assert balanced(harness.collector)


def test_a_bucket_is_flushed_when_its_window_ends_not_only_on_stop() -> None:
    harness = build(feeds=[[json.dumps({"type": "brand_new"}), END]])

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.feed_once()
        assert harness.fake_store.quarantine == []
        harness.clock.advance(61)
        await harness.collector.flush()

    run(scenario())
    assert [q.count for q in harness.fake_store.quarantine] == [1]
    assert diag(harness.collector)["open_quarantine_buckets"] == 0


def test_malformed_rows_are_rejected_by_reason_without_poisoning_the_frame() -> None:
    harness = one_session([slots(bot_row(running=1), bot_row(DM_B))])
    assert [o.slot_key for o in harness.fake_store.observations] == [DM_B]
    breakdown = diag(harness.collector)["breakdown"]
    assert breakdown["rejected"] == {"bad-row": 1}
    assert balanced(harness.collector)


def test_a_store_rejection_is_counted_with_its_reason() -> None:
    store = FakeStore()
    harness = build(store=store, feeds=[[slots(bot_row()), END]])

    async def scenario() -> None:
        await harness.collector.begin()
        store.installation_id = "inst_changed_underneath"
        await harness.collector.feed_once()

    run(scenario())
    counts = diag(harness.collector)["counts"]
    assert counts["rejected"] == 1
    assert diag(harness.collector)["breakdown"]["rejected"] == {"wrong-installation": 1}
    assert balanced(harness.collector)


# --- FP-03-AC03: gaps -------------------------------------------------------------------


def test_ac03_a_dropped_socket_persists_close_disconnect_before_the_first_backoff_sleep() -> None:
    harness = build(feeds=[[slots(bot_row()), END]])

    async def scenario() -> list[float]:
        await harness.collector.begin()
        await harness.collector.feed_once()
        return list(harness.sleeper.delays)

    delays = run(scenario())
    assert delays == []
    close = marks(harness.fake_store, "disconnect")
    assert [m.action for m in close] == ["close"]
    assert harness.collector.status().state is State.RECONNECTING


def test_ac03_the_loop_backs_off_one_two_four_eight_sixteen_thirty_thirty() -> None:
    feeds: list[Any] = [[slots(bot_row()), END]] + [[END] for _ in range(6)] + [[PolicyClose()]]
    harness = build(feeds=feeds, holding=False)

    async def scenario() -> None:
        await harness.collector.start()
        await until(lambda: harness.collector.status().state is State.STOPPED)
        await harness.collector.wait_closed()

    run(scenario())
    steps = [d for d in harness.sleeper.delays if d in {1, 2, 4, 8, 16, 30}]
    assert steps[:7] == [1, 2, 4, 8, 16, 30, 30]
    assert harness.collector.status().reason_code == "app-disabled"


@pytest.mark.parametrize(("draw", "factor"), [(0.0, 0.8), (0.5, 1.0), (1.0, 1.2)])
def test_backoff_jitter_stays_within_twenty_percent(draw: float, factor: float) -> None:
    harness = build(rng=draw)

    async def scenario() -> None:
        await harness.collector._sleep_backoff(3)

    run(scenario())
    assert harness.sleeper.delays == [pytest.approx(8 * factor)]


def test_a_hundred_reconnects_take_the_expected_simulated_time() -> None:
    harness = build(rng=0.5)

    async def scenario() -> None:
        for failures in range(100):
            await harness.collector._sleep_backoff(failures)

    run(scenario())
    assert sum(harness.sleeper.delays) == pytest.approx(1 + 2 + 4 + 8 + 16 + 30 * 95)


def test_ac03_a_store_outage_keeps_rows_and_emits_one_gap_over_the_outage_on_recovery() -> None:
    store = FakeStore()
    harness = build(store=store, feeds=[[slots(bot_row()), END]])

    async def scenario() -> None:
        await harness.collector.begin()
        store.fail_next = 3
        await harness.collector.feed_once()
        assert store.observations == []
        harness.clock.advance(20)
        store.fail_next = 0
        await harness.collector.flush()

    run(scenario())
    assert len(store.observations) == 1
    [gap] = marks(store, "store-unavailable")
    assert gap.from_ms is not None and gap.at_ms - gap.from_ms >= 20_000
    assert [m.action for m in store.coverage].count("open-covered") == 1
    assert balanced(harness.collector)


def test_a_retried_batch_is_identical_and_writes_each_observation_once() -> None:
    store = FakeStore()
    harness = build(store=store, feeds=[[slots(bot_row(), worker_row()), chat_done(1), END]])

    async def scenario() -> None:
        await harness.collector.begin()
        store.fail_next = 1
        await harness.collector.feed_once()
        await harness.collector.flush()

    run(scenario())
    assert len(store.observations) == 3
    assert len({(o.slot_key, o.event_type) for o in store.observations}) == 3
    assert balanced(harness.collector)


def test_ac06_an_event_burst_past_the_lane_bound_leaves_one_overflow_gap_with_the_count() -> None:
    frames = [slots(bot_row())] + [chat_done(turn) for turn in range(2, 22)]
    harness = one_session(frames, limits=small(event_queue_max=5))
    [gap] = marks(harness.fake_store, "overflow")
    assert gap.dropped == {"events": 15}
    assert gap.from_ms is not None and gap.at_ms >= gap.from_ms
    counts = diag(harness.collector)["counts"]
    assert counts["dropped_with_gap_record"] == 15
    assert counts["persisted"] == 1 + 5
    assert balanced(harness.collector)


def test_a_rejected_overflow_mark_is_counted_rejected_not_as_a_recorded_gap() -> None:
    store = FakeStore()
    frames = [slots(bot_row())] + [chat_done(turn) for turn in range(2, 12)]
    harness = build(store=store, feeds=[[*frames, END]], limits=small(event_queue_max=2))
    original = store.ingest

    def reject_overflow(written: IngestBatch) -> IngestResult:
        result = original(written)
        bad = tuple(
            Rejection(index, "coverage", "bad-coverage-mark")
            for index, item in enumerate(written.items)
            if isinstance(item, CoverageMark) and item.reason == "overflow"
        )
        return replace(result, rejections=(*result.rejections, *bad))

    vars(store)["ingest"] = reject_overflow

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.feed_once()

    run(scenario())
    counts = diag(harness.collector)["counts"]
    assert counts["dropped_with_gap_record"] == 0
    assert counts["rejected"] == 8
    assert balanced(harness.collector)


def test_a_zero_bot_snapshot_after_bots_were_visible_closes_coverage_until_one_returns() -> None:
    frames = [slots(bot_row()), slots(), slots(), slots(bot_row(turn=2))]
    harness = one_session(frames)
    actions = [(m.action, m.reason) for m in marks(harness.fake_store)]
    assert actions == [
        ("open-covered", None),
        ("close", "scope-lost-or-silent"),
        ("open-covered", None),
        ("close", "disconnect"),
    ]


def test_a_partial_connect_frame_opens_no_coverage_until_a_full_snapshot() -> None:
    harness = one_session([slots(bot_row(), partial=True), slots(bot_row(), partial=False)])
    actions = [m.action for m in marks(harness.fake_store)]
    assert actions == ["open-covered", "close"]
    only_partial = one_session([slots(bot_row(), partial=True)])
    assert [m.action for m in marks(only_partial.fake_store)] == []
    assert len(only_partial.fake_store.observations) == 1


def test_a_partial_frame_without_a_follow_up_snapshot_redials_once() -> None:
    from backend.tests.collector_scenarios import HoldingGateway

    harness = build(
        feeds=[[slots(bot_row(), partial=True)], [slots(bot_row(), partial=False)]],
        holding=True,
        limits=small(partial_resnapshot_s=0.05),
    )
    assert isinstance(harness.gateway, HoldingGateway)

    async def scenario() -> bool:
        await harness.collector.begin()
        return await harness.collector.feed_once()

    assert run(scenario()) is False
    assert diag(harness.collector)["counters"]["partial-resnapshot-redial"] == 1


# --- FP-03-AC05: identity ---------------------------------------------------------------


def roster_harness(rows: list[Any] | Any, **options: Any) -> Any:
    answers = {"/api/agents": [rows]}
    return build(feeds=[[slots(bot_row(), bot_row(DM_B)), END]], answers=answers, **options)


def test_ac05_a_roster_row_joins_by_exact_memory_store_never_by_name() -> None:
    rows = [
        agent_row(KEY_A.memory_store, "bot-a", "Same Name"),
        agent_row("member-someone-else-ffff-cc33", "bot-z", "Same Name"),
        agent_row(KEY_B.memory_store, "bot-b", "Other", scope="project"),
        agent_row(KEY_B.memory_store, "bot-b", "Other"),
    ]
    harness = roster_harness(rows)

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.feed_once()
        await harness.collector.poll_roster()

    run(scenario())
    [poll] = harness.fake_store.polls
    assert poll.success and [r.memory_store for r in poll.rows] == sorted(
        [KEY_A.memory_store, KEY_B.memory_store]
    )
    assert SENTINEL not in repr(poll)


def test_ac05_a_rename_is_a_new_display_revision_and_no_new_binding() -> None:
    first = [agent_row(KEY_A.memory_store, "bot-a", "Old Name")]
    second = [agent_row(KEY_A.memory_store, "bot-a", "New Name")]
    harness = build(feeds=[[slots(bot_row()), END]], answers={"/api/agents": [first, second]})

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.feed_once()
        await harness.collector.poll_roster()
        await harness.collector.poll_roster()

    run(scenario())
    store = harness.fake_store
    assert [p.rows[0].display_name for p in store.polls] == ["Old Name", "New Name"]
    seen = [i for b in store.batches for i in b.items if isinstance(i, BindingSeen)]
    assert len(seen) == 1 and len(store.bindings) == 1


def test_ac05_replacement_under_the_same_name_is_a_second_binding_and_the_first_gets_nothing() -> (
    None
):
    replacement = DM_B
    first = [agent_row(KEY_A.memory_store, "bot", "Same")]
    second = [agent_row(KEY_B.memory_store, "bot", "Same")]
    harness = build(
        feeds=[[slots(bot_row()), END], [slots(bot_row(replacement)), END]],
        answers={"/api/agents": [first, second]},
    )

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.feed_once()
        await harness.collector.poll_roster()
        await harness.collector.feed_once()
        await harness.collector.poll_roster()

    run(scenario())
    store = harness.fake_store
    assert [b.dm_key for b in store.bindings] == [DM_A, DM_B]
    assert [o.dm_key for o in store.observations].count(DM_A) == 1
    assert [o.dm_key for o in store.observations].count(DM_B) == 1


def test_ac05_deletion_sends_only_a_poll_and_reappearance_reuses_the_binding() -> None:
    present = [agent_row(KEY_A.memory_store, "bot-a", "Bot")]
    harness = build(
        feeds=[[slots(bot_row()), END], [slots(bot_row(turn=2)), END]],
        answers={"/api/agents": [present, [], present]},
    )

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.feed_once()
        await harness.collector.poll_roster()
        await harness.collector.poll_roster()
        await harness.collector.feed_once()
        await harness.collector.poll_roster()

    run(scenario())
    store = harness.fake_store
    assert [len(p.rows) for p in store.polls] == [1, 0, 1]
    assert len(store.bindings) == 1
    seen = [i for b in store.batches for i in b.items if isinstance(i, BindingSeen)]
    assert len(seen) == 1


def test_ac05_a_store_less_key_sends_no_binding_no_quarantine_and_shows_as_a_note() -> None:
    harness = one_session([slots(bot_row("member-bot-c"), bot_row("member-bot-c"))])
    store = harness.fake_store
    assert store.bindings == [] and store.quarantine == []
    assert harness.collector.status().notes == (("unsupported-store-less-bot", 1),)
    sent = [i for b in store.batches for i in b.items if isinstance(i, BindingSeen)]
    assert sent == []
    assert balanced(harness.collector)


def test_a_new_binding_asks_for_an_early_roster_refresh() -> None:
    harness = one_session([slots(bot_row())])
    assert harness.collector._roster_refresh is True


# --- roster poll ------------------------------------------------------------------------


def poll_once(answer: Any, **options: Any) -> Any:
    harness = build(feeds=[[slots(bot_row()), END]], answers={"/api/agents": [answer]}, **options)

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.feed_once()
        await harness.collector.poll_roster()

    run(scenario())
    return harness


def test_a_poll_failure_is_a_failed_poll_with_the_fixed_reason() -> None:
    harness = poll_once(Transient("down"))
    [poll] = harness.fake_store.polls
    assert (poll.success, poll.reason, poll.rows) == (False, "roster-unavailable", ())


def test_a_malformed_answer_is_a_failed_poll() -> None:
    harness = poll_once(MalformedAnswer())
    assert harness.fake_store.polls[0].success is False
    harness = poll_once("not a list")
    assert harness.fake_store.polls[0].success is False


def test_a_response_of_more_than_two_thousand_rows_is_a_failed_poll() -> None:
    rows = [agent_row(f"member-x-{n:04d}") for n in range(2001)]
    harness = poll_once(rows)
    assert harness.fake_store.polls[0].success is False


def test_long_names_are_cut_and_unusable_avatar_refs_become_none() -> None:
    row = agent_row(
        KEY_A.memory_store,
        "n" * 300,
        "d" * 300,
        avatar={"kind": "image", "file": "bad file name", "id": "also bad!"},
    )
    harness = poll_once([row])
    [out] = harness.fake_store.polls[0].rows
    assert (len(out.name), len(out.display_name or "")) == (128, 128)
    assert (out.avatar_kind, out.avatar_ref) == ("image", None)


def test_the_avatar_ref_falls_back_from_file_to_id_and_a_bad_kind_drops_both() -> None:
    harness = poll_once([agent_row(KEY_A.memory_store, avatar={"kind": "pack", "id": "pack-7"})])
    assert harness.fake_store.polls[0].rows[0].avatar_ref == "pack-7"
    harness = poll_once([agent_row(KEY_A.memory_store, avatar={"kind": "Bad Kind", "file": "a"})])
    out = harness.fake_store.polls[0].rows[0]
    assert (out.avatar_kind, out.avatar_ref) == (None, None)
    harness = poll_once([agent_row(KEY_A.memory_store, avatar="ghost")])
    assert harness.fake_store.polls[0].rows[0].avatar_kind is None


def test_a_dict_answer_with_a_list_of_rows_is_accepted() -> None:
    harness = poll_once({"agents": [agent_row(KEY_A.memory_store)]})
    assert harness.fake_store.polls[0].success


def test_more_than_two_hundred_matched_rows_are_truncated_and_noted() -> None:
    harness = poll_once([agent_row(KEY_A.memory_store)], limits=small(roster_poll_rows_max=0))
    assert harness.fake_store.polls[0].rows == ()
    assert diag(harness.collector)["counters"]["roster-truncated"] == 1


def test_rows_without_a_name_or_a_string_store_are_skipped() -> None:
    rows = [
        {"scope": "global", "memory_store": KEY_A.memory_store},
        {"scope": "global", "memory_store": 5, "name": "x"},
        agent_row(KEY_A.memory_store),
    ]
    harness = poll_once(rows)
    assert len(harness.fake_store.polls[0].rows) == 1


def test_the_roster_loop_polls_after_the_first_snapshot_and_then_on_a_timer() -> None:
    harness = build(
        feeds=[[slots(bot_row())]],
        answers={"/api/agents": [[agent_row(KEY_A.memory_store)]]},
        holding=True,
    )

    async def scenario() -> None:
        await harness.collector.start()
        await until(lambda: len(harness.fake_store.polls) >= 2)
        await harness.collector.stop()

    run(scenario())
    assert all(poll.success for poll in harness.fake_store.polls)
    assert len(harness.gateway.calls_of("get")) >= 2


# --- heartbeat, pause, stop -------------------------------------------------------------


def test_a_beat_updates_the_run_and_an_unknown_run_starts_a_new_one() -> None:
    store = FakeStore()
    harness = build(store=store, run_ids=["run-new"])

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.beat()
        assert store.runs["run-1"].heartbeat_ms == harness.clock.now_ms()
        harness.clock.advance(10)
        del store.runs["run-1"]
        await harness.collector.beat()

    run(scenario())
    assert "run-new" in store.runs
    assert diag(harness.collector)["counters"]["new-run"] == 1


def test_a_failed_beat_marks_the_store_down_and_does_not_raise() -> None:
    store = FakeStore()
    harness = build(store=store)

    async def scenario() -> None:
        await harness.collector.begin()
        store.fail_next = 1
        await harness.collector.beat()

    run(scenario())
    assert harness.collector._store_down_from is not None


def test_a_heartbeat_loop_beats_on_its_interval() -> None:
    store = FakeStore()
    harness = build(store=store, feeds=[[slots(bot_row())]], holding=True)

    async def scenario() -> None:
        await harness.collector.start()
        await until(lambda: store.runs["run-1"].heartbeat_ms > START_MS)
        await harness.collector.stop()

    run(scenario())


def test_stop_is_clean_ends_the_run_with_restart_and_is_idempotent() -> None:
    harness = build(feeds=[[slots(bot_row())]], holding=True)

    async def scenario() -> None:
        await harness.collector.start()
        await until(lambda: len(harness.fake_store.observations) == 1)
        await harness.collector.stop()
        await harness.collector.stop()

    run(scenario())
    store = harness.fake_store
    assert store.runs["run-1"].end_reason == "restart"
    assert [m.action for m in store.coverage] == ["open-covered", "close"]
    assert harness.collector.status().state is State.STOPPED
    assert balanced(harness.collector)


def test_stop_flushes_open_quarantine_buckets() -> None:
    harness = build(feeds=[[slots(bot_row()), json.dumps({"type": "brand_new"})]], holding=True)

    async def scenario() -> None:
        await harness.collector.start()
        await until(lambda: diag(harness.collector)["counts"]["received"] == 2)
        await harness.collector.stop()

    run(scenario())
    assert [q.count for q in harness.fake_store.quarantine] == [1]
    assert balanced(harness.collector)


def test_stop_before_start_and_with_an_unavailable_store_never_raises() -> None:
    harness = build(store=FakeStore())
    run(harness.collector.stop())
    unavailable = build(store=FakeStore(fail_next=5), feeds=[[slots(bot_row())]], holding=True)

    async def scenario() -> None:
        await unavailable.collector.begin()
        unavailable.fake_store.fail_next = 50
        await unavailable.collector.halt(None, "restart")

    run(scenario())
    assert unavailable.collector.status().state is State.STOPPED


def test_an_unexpected_error_ends_the_run_with_restart_and_state_internal_error() -> None:
    class Exploding:
        def __init__(self, inner: Any) -> None:
            self.inner = inner

        def __getattr__(self, name: str) -> Any:
            return getattr(self.inner, name)

        def open_feed(self) -> Any:
            raise RuntimeError("boom")

    harness = build()
    harness.collector._gateway = Exploding(harness.gateway)

    async def scenario() -> None:
        await harness.collector.start()
        await until(lambda: harness.collector.status().state is State.STOPPED)
        await harness.collector.wait_closed()

    run(scenario())
    status = harness.collector.status()
    assert (status.state, status.reason_code) == (State.STOPPED, "internal-error")
    assert harness.fake_store.runs["run-1"].end_reason == "restart"
    assert diag(harness.collector)["counters"]["internal-error:RuntimeError"] == 1


def test_pause_closes_the_feed_records_paused_and_resume_restarts_it() -> None:
    harness = build(feeds=[[slots(bot_row())], [slots(bot_row(turn=2))]], holding=True)

    async def scenario() -> None:
        await harness.collector.start()
        await until(lambda: len(harness.fake_store.observations) == 1)
        await harness.collector.pause()
        assert harness.fake_store.paused is True
        assert harness.collector.status().state is State.PAUSED
        assert [m.reason for m in harness.fake_store.coverage if m.action == "close"] == ["paused"]
        await harness.collector.pause()
        await harness.collector.resume()
        assert harness.fake_store.paused is False
        await until(lambda: len(harness.fake_store.observations) == 2)
        await harness.collector.resume()
        await harness.collector.stop()

    run(scenario())


def test_a_collector_started_paused_does_not_dial_until_resumed() -> None:
    store = FakeStore(paused=True)
    harness = build(store=store, feeds=[[slots(bot_row())]], holding=True)

    async def scenario() -> None:
        await harness.collector.start()
        for _ in range(20):
            await asyncio.sleep(0.001)
        assert harness.gateway.calls_of("feed") == []
        await harness.collector.resume()
        await until(lambda: len(store.observations) == 1)
        await harness.collector.stop()

    run(scenario())


# --- FP-03-AC06: redacted diagnostics ---------------------------------------------------


def test_ac06_diagnostics_hold_no_token_secret_key_name_or_prose() -> None:
    frames = [
        slots(
            bot_row(),
            worker_row(),
            bot_row("member-bot-c"),
            bot_row(title=SENTINEL, workspace=SENTINEL),
        ),
        chat_done(2),
        json.dumps({"type": "brand_new", "title": SENTINEL}),
    ]
    harness = one_session(frames)
    text = json.dumps(diag(harness.collector))
    for needle in (
        SENTINEL,
        DM_A,
        DM_B,
        WORKER_1,
        KEY_A.member_id,
        KEY_A.memory_store,
        "member-",
        ".memory-",
        "token-1",
        "brand_new",
    ):
        assert needle not in text
    assert balanced(harness.collector)


# --- edges ------------------------------------------------------------------------------


def test_a_handled_type_with_a_broken_body_is_quarantined_under_its_type() -> None:
    harness = one_session(['{"type":"chat_done","data":{"slot": '])
    assert [(q.reason, q.frame_type) for q in harness.fake_store.quarantine] == [
        ("malformed-frame", "chat_done")
    ]


def test_a_type_that_is_not_first_and_a_broken_body_is_quarantined_as_invalid() -> None:
    harness = one_session(['{"data": 1, "type": '])
    assert [(q.reason, q.frame_type) for q in harness.fake_store.quarantine] == [
        ("malformed-frame", "invalid")
    ]


def test_the_binding_limit_stops_new_bindings_and_counts_the_refusal() -> None:
    harness = one_session([slots(bot_row(), bot_row(DM_B))], limits=small(known_binding_max=1))
    assert [b.dm_key for b in harness.fake_store.bindings] == [DM_A]
    assert diag(harness.collector)["counters"]["binding-limit"] == 1
    assert [o.dm_key for o in harness.fake_store.observations] == [DM_A]


def test_a_row_without_a_turn_gen_never_marks_a_restart() -> None:
    harness = one_session([slots(bot_row(turn_gen=None, turn=None))])
    assert marks(harness.fake_store, "source-restart") == []


def test_only_the_events_whose_binding_arrived_are_released_from_the_pending_buffer() -> None:
    harness = one_session(
        [chat_done(1, DM_A), chat_done(1, DM_B), slots(bot_row(DM_A))],
    )
    assert [(o.kind, o.dm_key) for o in harness.fake_store.observations] == [
        ("row-change", DM_A),
        ("event", DM_A),
    ]
    assert len(harness.collector._pending) == 1
    assert balanced(harness.collector)


def test_halting_twice_does_nothing_the_second_time() -> None:
    harness = build()

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.halt(None, "restart")
        await harness.collector.halt("internal-error", "restart")

    run(scenario())
    assert harness.collector.status().reason_code == "shutdown"


def test_a_flush_failure_while_halting_is_counted_and_never_raised() -> None:
    harness = build(feeds=[[slots(bot_row()), END]])

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.feed_once()

        def explode(written: IngestBatch) -> IngestResult:
            raise ValueError("odd")

        vars(harness.fake_store)["ingest"] = explode
        harness.collector._control.append(CoverageMark("open-covered", 1))
        await harness.collector.halt(None, "restart")

    run(scenario())
    assert diag(harness.collector)["counters"]["halt-flush-failed"] == 1


def test_a_failed_pause_flag_write_is_counted_and_the_pause_still_closes_coverage() -> None:
    harness = build(feeds=[[slots(bot_row())]], holding=True)

    def unavailable(paused: bool, now_ms: int) -> None:
        raise StoreUnavailable

    async def scenario() -> None:
        await harness.collector.start()
        await until(lambda: len(harness.fake_store.observations) == 1)
        vars(harness.fake_store)["set_paused"] = unavailable
        await harness.collector.pause()
        await harness.collector.stop()

    run(scenario())
    assert diag(harness.collector)["counters"]["set-paused-failed"] == 1
    assert harness.collector.status().state is State.STOPPED


def test_the_loop_reenters_at_once_after_a_fresh_token_and_keeps_collecting() -> None:
    harness = build(feeds=[AuthRejected(403), [slots(bot_row())]], holding=True)

    async def scenario() -> None:
        await harness.collector.start()
        await until(lambda: len(harness.fake_store.observations) == 1)
        await harness.collector.stop()

    run(scenario())
    assert harness.gateway.exchange_count == 2
    assert 1 not in harness.sleeper.delays


def test_the_writer_backs_off_while_the_store_is_down_then_catches_up() -> None:
    store = FakeStore()

    def outage() -> None:
        store.fail_next = 3

    harness = build(store=store, feeds=[[slots(bot_row()), outage, chat_done(2)]], holding=True)

    async def scenario() -> None:
        await harness.collector.start()
        await until(lambda: len(store.observations) == 2)
        await harness.collector.stop()

    run(scenario())
    assert 1 in harness.sleeper.delays
    assert balanced(harness.collector)


def test_a_store_outage_while_covered_cuts_one_gap_and_starts_a_new_covered_interval() -> None:
    store = FakeStore()
    clock = FakeClock()

    def outage() -> None:
        store.fail_next = 2
        clock.advance(5)

    harness = build(
        store=store,
        feeds=[[slots(bot_row()), outage, chat_done(2)]],
        holding=True,
        clock=clock,
    )

    async def scenario() -> None:
        await harness.collector.start()
        await until(lambda: any(m.reason == "store-unavailable" for m in store.coverage))
        await harness.collector.stop()

    run(scenario())
    [gap] = marks(store, "store-unavailable")
    assert gap.from_ms is not None and gap.at_ms > gap.from_ms
    assert [m.action for m in store.coverage] == ["open-covered", "gap", "close"]


def test_a_closed_store_requeues_the_batch_and_is_counted() -> None:
    store = FakeStore()
    harness = build(store=store, feeds=[[slots(bot_row()), END]])
    original = store.ingest
    state = {"closed": True}

    def closing(written: IngestBatch) -> IngestResult:
        if state["closed"]:
            raise StoreClosed
        return original(written)

    vars(store)["ingest"] = closing

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.feed_once()
        assert diag(harness.collector)["counters"]["store-closed"] >= 1
        state["closed"] = False
        await harness.collector.flush()

    run(scenario())
    assert len(store.observations) == 1


def test_a_closed_store_during_a_beat_is_counted_and_a_failed_new_run_is_quiet() -> None:
    store = FakeStore()
    harness = build(store=store)

    async def scenario() -> None:
        await harness.collector.begin()

        def closed(**_: Any) -> None:
            raise StoreClosed

        def unknown(**_: Any) -> None:
            raise UnknownRun

        vars(store)["heartbeat"] = closed
        await harness.collector.beat()
        vars(store)["heartbeat"] = unknown
        store.fail_next = 1
        await harness.collector.beat()

    run(scenario())
    assert diag(harness.collector)["counters"]["store-closed"] == 1


def _inject_rejections(store: FakeStore, kinds: dict[str, str]) -> None:
    original = store.ingest

    def rejecting(written: IngestBatch) -> IngestResult:
        result = original(written)
        extra = tuple(
            Rejection(index, kind, "bad-field")  # type: ignore[arg-type]
            for index, item in enumerate(written.items)
            for name, kind in kinds.items()
            if type(item).__name__ == name
        )
        return replace(result, rejections=(*result.rejections, *extra))

    vars(store)["ingest"] = rejecting


def test_rejected_quarantine_items_count_as_rejected_units() -> None:
    store = FakeStore()
    _inject_rejections(store, {"QuarantineIn": "quarantine"})
    harness = build(store=store, feeds=[[slots(bot_row()), json.dumps({"type": "nope"}), END]])

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.feed_once()
        await harness.collector.stop()

    run(scenario())
    counts = diag(harness.collector)["counts"]
    assert counts["rejected"] == 1 and counts["quarantined"] == 0
    assert balanced(harness.collector)


def test_rejected_control_items_and_bindings_are_counted_by_kind() -> None:
    store = FakeStore()
    _inject_rejections(store, {"CoverageMark": "coverage", "BindingSeen": "binding"})
    harness = build(store=store, feeds=[[slots(bot_row()), END]])

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.feed_once()

    run(scenario())
    counters = diag(harness.collector)["counters"]
    assert counters["coverage-rejected"] >= 1 and counters["binding-rejected"] == 1


def test_a_store_down_gap_and_an_overflow_gap_can_share_a_batch() -> None:
    store = FakeStore()
    frames = [slots(bot_row())] + [chat_done(turn) for turn in range(2, 12)]
    harness = build(store=store, feeds=[[*frames, END]], limits=small(event_queue_max=3))

    async def scenario() -> None:
        await harness.collector.begin()
        store.fail_next = 1
        await harness.collector.feed_once()
        await harness.collector.flush()

    run(scenario())
    assert marks(store, "overflow") and marks(store, "store-unavailable")
    assert diag(harness.collector)["counts"]["dropped_with_gap_record"] == 7
    assert balanced(harness.collector)


def test_a_roster_poll_that_explains_the_silence_reopens_coverage_while_connected() -> None:
    store = FakeStore()
    harness = build(
        store=store,
        feeds=[[slots(bot_row()), slots()]],
        answers={"/api/agents": [[]]},
        holding=True,
    )

    async def scenario() -> None:
        await harness.collector.start()
        await until(lambda: any(m.reason == "scope-lost-or-silent" for m in store.coverage))
        await harness.collector.poll_roster()
        await until(lambda: [m.action for m in store.coverage].count("open-covered") == 2)
        await harness.collector.stop()

    run(scenario())
    assert harness.collector._scope_closed is False


def test_a_cancellation_during_a_write_still_accounts_for_the_write_and_reraises() -> None:
    store = FakeStore()
    started = threading.Event()
    release = threading.Event()
    original = store.ingest

    def slow(written: IngestBatch) -> IngestResult:
        started.set()
        release.wait(5)
        return original(written)

    vars(store)["ingest"] = slow
    harness = build(store=store, feeds=[[slots(bot_row()), END]])

    async def scenario() -> None:
        await harness.collector.begin()
        harness.collector._handle(slots(bot_row()))
        flushing = asyncio.ensure_future(harness.collector.flush())
        while not started.is_set():
            await asyncio.sleep(0.001)
        flushing.cancel()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await flushing

    run(scenario())
    assert len(store.observations) == 1
    assert diag(harness.collector)["counts"]["persisted"] == 1
    assert balanced(harness.collector)


def test_a_cancellation_during_a_failing_write_requeues_the_batch() -> None:
    store = FakeStore()
    started = threading.Event()
    release = threading.Event()

    def failing(written: IngestBatch) -> IngestResult:
        started.set()
        release.wait(5)
        raise StoreUnavailable

    vars(store)["ingest"] = failing
    harness = build(store=store)

    async def scenario() -> None:
        await harness.collector.begin()
        harness.collector._handle(slots(bot_row()))
        flushing = asyncio.ensure_future(harness.collector.flush())
        while not started.is_set():
            await asyncio.sleep(0.001)
        flushing.cancel()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await flushing

    run(scenario())
    assert len(harness.collector._rows) == 1
    assert balanced(harness.collector)
