"""FP-03-AC02: out-of-order delivery, duplicate delivery and the order items reach the store."""

import asyncio
from typing import Any

from backend.specter_arena.collector.gateway import Transient
from backend.specter_arena.store import CoverageMark, ObservationIn
from backend.tests.collector_scenarios import (
    DM_A,
    GEN,
    OTHER_GEN,
    WORKER_1,
    bot_row,
    build,
    chat_done,
    slots,
    small,
    worker_row,
)

END = Transient("scripted-end")
LATER = "2026-11-16T12:00:30+00:00"
EARLIER = "2026-11-16T11:59:00+00:00"


def run(coro: Any) -> Any:
    return asyncio.run(coro)


def session(frames: list[Any], **options: Any) -> Any:
    harness = build(feeds=[[*frames, END]], **options)

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.feed_once()

    run(scenario())
    return harness


def rows_for(harness: Any, slot: str = DM_A) -> list[ObservationIn]:
    return [
        o for o in harness.fake_store.observations if o.kind == "row-change" and o.slot_key == slot
    ]


def test_an_older_turn_never_replaces_a_newer_one_for_the_same_slot() -> None:
    harness = session([slots(bot_row(turn=5)), slots(bot_row(turn=4))])
    [persisted] = rows_for(harness)
    assert persisted.turn == 5


def test_a_higher_turn_replaces_a_lower_one_before_the_write() -> None:
    harness = session([slots(bot_row(turn=4)), slots(bot_row(turn=5))])
    [persisted] = rows_for(harness)
    assert persisted.turn == 5


def test_on_the_same_turn_the_later_source_time_wins() -> None:
    harness = session(
        [
            slots(bot_row(turn=5, last_activity_ts=LATER, running=True)),
            slots(bot_row(turn=5, last_activity_ts=EARLIER, running=False)),
        ]
    )
    [persisted] = rows_for(harness)
    assert persisted.payload["running"] is True
    assert persisted.source_time_ms is not None


def test_without_ordering_evidence_the_later_receipt_wins() -> None:
    harness = session(
        [
            slots(bot_row(turn=9, running=True)),
            slots(bot_row(turn=1, turn_gen=OTHER_GEN, running=False)),
        ]
    )
    [persisted] = rows_for(harness)
    assert persisted.turn_gen == OTHER_GEN and persisted.payload["running"] is False


def test_each_slot_is_ordered_on_its_own() -> None:
    harness = session(
        [
            slots(bot_row(turn=5), worker_row(running=True)),
            slots(bot_row(turn=4), worker_row(running=False)),
        ]
    )
    assert [o.turn for o in rows_for(harness)] == [5]
    [worker] = rows_for(harness, WORKER_1)
    assert worker.payload["running"] is False


def test_observations_precede_the_coverage_marks_that_follow_them_in_each_batch() -> None:
    harness = session([slots(bot_row(), worker_row()), chat_done(1)])
    for written in harness.fake_store.batches:
        kinds = [type(item) for item in written.items]
        if CoverageMark in kinds:
            first_mark = kinds.index(CoverageMark)
            assert ObservationIn not in kinds[first_mark:]


def test_bindings_precede_the_observations_that_name_them() -> None:
    harness = session([slots(bot_row(), worker_row())])
    names = [type(item).__name__ for item in harness.fake_store.batches[0].items]
    assert names.index("BindingSeen") < names.index("ObservationIn")


def test_every_mark_the_collector_sends_names_no_binding_slot_or_key() -> None:
    frames = [slots(bot_row(), worker_row()), slots(bot_row(turn=9)), chat_done(10)]
    harness = session(frames, limits=small(event_queue_max=1))
    sent = [m for b in harness.fake_store.batches for m in b.items if isinstance(m, CoverageMark)]
    assert sent
    for mark in sent:
        assert mark.action in {"open-covered", "close", "gap"}
        assert DM_A not in repr(mark) and WORKER_1 not in repr(mark)


def test_a_large_snapshot_is_written_in_batches_of_at_most_one_hundred_items() -> None:
    rows = [worker_row(key=f"chat-{n}-1794779966") for n in range(250)]
    harness = session([slots(bot_row(), *rows)])
    sizes = [len(written.items) for written in harness.fake_store.batches]
    assert max(sizes) <= 100 and sum(sizes) >= 251
    assert len(harness.fake_store.observations) == 251


def test_a_gap_mark_never_starts_before_the_covered_interval_it_cuts() -> None:
    frames = [slots(bot_row())] + [chat_done(turn) for turn in range(2, 12)]
    harness = session(frames, limits=small(event_queue_max=3))
    opened = next(m for m in harness.fake_store.coverage if m.action == "open-covered")
    for mark in harness.fake_store.coverage:
        if mark.action == "gap":
            assert mark.from_ms is not None and mark.from_ms >= opened.at_ms
            assert mark.at_ms >= mark.from_ms


def test_a_retried_write_keeps_the_order_of_what_was_queued() -> None:
    harness = build(feeds=[[slots(bot_row()), chat_done(1), chat_done(2), END]])

    async def scenario() -> None:
        await harness.collector.begin()
        harness.fake_store.fail_next = 1
        await harness.collector.feed_once()
        await harness.collector.flush()

    run(scenario())
    events = [o for o in harness.fake_store.observations if o.kind == "event"]
    assert [o.turn for o in events] == [1, 2]


def test_a_second_connect_after_a_gap_marks_the_first_row_for_turn_accounting() -> None:
    harness = build(feeds=[[slots(bot_row(turn=2)), END], [slots(bot_row(turn=3)), END]])

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.feed_once()
        await harness.collector.feed_once()

    run(scenario())
    assert [m.reason for m in harness.fake_store.coverage if m.action == "gap"] == []
    assert [o.turn for o in rows_for(harness)] == [2, 3]


def test_a_restart_gen_change_between_connects_is_one_mark_and_the_stream_continues() -> None:
    harness = build(
        feeds=[[slots(bot_row(turn=8)), END], [slots(bot_row(turn=1, turn_gen=OTHER_GEN)), END]]
    )

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.feed_once()
        await harness.collector.feed_once()

    run(scenario())
    reasons = [m.reason for m in harness.fake_store.coverage if m.action == "gap"]
    assert reasons == ["source-restart"]
    assert [o.turn_gen for o in rows_for(harness)] == [GEN, OTHER_GEN]
