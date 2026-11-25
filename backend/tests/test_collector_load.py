"""Bounded collector load against the real SQLite store (FP-03-AC02, AC03, AC06).

Each scenario reads a scripted feed through the real collector into a store under tmp_path, with
a fake clock and no network. Unit-level lane, backoff and 403 behaviour is covered in
test_collector_lanes.py, test_collector_supervisor.py and test_collector_auth.py; these tests
check the same promises end to end and at the sizes the design sets.
"""

import asyncio
import threading
import tracemalloc
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from backend.specter_arena.collector.gateway import PolicyClose, Transient
from backend.specter_arena.collector.supervisor import State
from backend.specter_arena.collector.vocabulary import LIMITS
from backend.specter_arena.store import Store, open_store
from backend.tests.collector_fakes import FakeClock
from backend.tests.collector_fixtures import event_frame, row, slots_frame
from backend.tests.collector_scenarios import (
    DM_A,
    SENTINEL,
    build,
    chat_done,
    slots,
    small,
    until,
)
from backend.tests.test_collector_store_contract import drive, real, run, table

END = Transient("scripted-end")
EVENT_QUEUE_MAX = LIMITS.event_queue_max
BURST_ITEMS = 10_000
MEMORY_BUDGET_BYTES = 50 * 1024 * 1024
RECONNECTS = 100
STEPS = LIMITS.backoff_s
FIRST_STEP_FLOOR = STEPS[0] * (1 - LIMITS.jitter)
LAST_STEP_CEILING = STEPS[-1] * (1 + LIMITS.jitter)


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    opened = open_store(tmp_path / "data")
    try:
        yield opened
    finally:
        opened.close()


async def until_stopped(harness: Any) -> None:
    await until(lambda: harness.collector.status().state is State.STOPPED)


def counts(harness: Any) -> dict[str, int]:
    body: dict[str, int] = harness.collector.diagnostics()["counts"]
    return body


def test_event_burst_stays_bounded_and_an_overflow_gap_marks_the_bot_uncovered(
    store: Store,
) -> None:
    clock = FakeClock()
    holder: list[Any] = []
    samples: list[int] = []

    def tick() -> None:
        samples.append(holder[0].collector.diagnostics()["event_lane"])
        clock.advance(0.01)

    events = [chat_done(turn, DM_A) for turn in range(2, BURST_ITEMS + 2)]
    script: list[Any] = [slots_frame("full")]
    for start in range(0, len(events), 500):
        script.extend([*events[start : start + 500], tick])
    harness = real(store, feeds=[[*script, END]], clock=clock)
    holder.append(harness)
    drive(harness)
    assert max(samples) == EVENT_QUEUE_MAX and len(samples) == BURST_ITEMS // 500
    assert counts(harness)["dropped_with_gap_record"] == BURST_ITEMS - EVENT_QUEUE_MAX
    assert harness.collector.diagnostics()["balanced"] is True
    overflow = table(
        store,
        "SELECT dropped_json, end_ms >= start_ms FROM coverage_interval"
        " WHERE reason = 'overflow' AND state = 'gap'",
    )
    assert len(overflow) == 1 and overflow[0][1] == 1
    assert f'"events":{BURST_ITEMS - EVENT_QUEUE_MAX}' in overflow[0][0].replace(" ", "")


def test_accounting_balances_on_a_mixed_stream_and_a_drop_never_reads_as_covered(
    store: Store,
) -> None:
    clock = FakeClock()
    oversize = (
        '{"type":"chat_done","data":{"slot":"x","pad":"' + "p" * LIMITS.raw_frame_max_chars + '"}}'
    )
    burst = [chat_done(turn, DM_A) for turn in range(2, EVENT_QUEUE_MAX + 40)]
    mixed: list[Any] = [
        slots_frame("full"),
        slots_frame("full"),
        *burst,
        lambda: clock.advance(0.05),
        '{"type":"heartbeat"}',
        '{"type":"chat_chunk","data":{}}',
        event_frame("tool_call", DM_A),
        event_frame("tool_call", DM_A),
        event_frame("tool_result", DM_A),
        oversize,
        '{"type":"brand_new","data":{}}',
        "{not json",
        slots(row("botA", running="yes")),
    ]
    harness = real(store, feeds=[[*mixed, END]], clock=clock)
    drive(harness)
    body = counts(harness)
    assert body["received"] == sum(v for k, v in body.items() if k != "received")
    assert body["ignored"] == 2 and body["coalesced"] >= 1
    assert body["quarantined"] >= 3 and body["rejected"] >= 1
    assert body["dropped_with_gap_record"] > 0
    assert harness.collector.diagnostics()["balanced"] is True
    gap = table(
        store,
        "SELECT g.start_ms, g.end_ms, (SELECT c.start_ms <= g.start_ms FROM coverage_interval c"
        " WHERE c.state = 'covered' ORDER BY c.interval_id LIMIT 1) FROM coverage_interval g"
        " WHERE g.reason = 'overflow'",
    )
    assert len(gap) == 1 and gap[0][2] == 1 and gap[0][0] == gap[0][1]


def test_a_ten_thousand_item_burst_stays_inside_the_memory_and_task_budget(store: Store) -> None:
    frames = [slots_frame("full")] + [chat_done(turn, DM_A) for turn in range(2, BURST_ITEMS + 2)]
    harness = real(store, feeds=[[*frames, END]])
    threads_before = threading.active_count()

    async def scenario() -> tuple[int, int]:
        tasks_before = len(asyncio.all_tasks())
        assert await harness.collector.begin()
        tracemalloc.start()
        try:
            await harness.collector.feed_once()
            await harness.collector.flush()
            peak = tracemalloc.get_traced_memory()[1]
        finally:
            tracemalloc.stop()
        await harness.collector.stop()
        return peak, len(asyncio.all_tasks()) - tasks_before

    peak, task_growth = run(scenario())
    assert peak < MEMORY_BUDGET_BYTES
    assert task_growth <= 0
    assert threading.active_count() <= threads_before


def test_a_thousand_large_snapshots_keep_one_frame_per_binding_resident() -> None:
    padding = [
        {"key": f"chat-{n}-17947", "origin": "user", "running": False, "title": "x" * 300}
        for n in range(400)
    ]
    big = slots(row("botA"), *padding)
    assert len(big) > 100_000
    holder: list[Any] = []
    resident: list[int] = []

    def sample() -> None:
        resident.append(holder[0].collector.diagnostics()["row_lane"])

    harness = build(feeds=[[*([big] * 1_000), sample, END]])
    holder.append(harness)

    async def scenario() -> None:
        assert await harness.collector.begin()
        await harness.collector.feed_once()

    run(scenario())
    assert resident == [1]
    assert counts(harness)["coalesced"] >= 999
    assert harness.collector.diagnostics()["balanced"] is True


def test_nine_hundred_ninety_identical_events_store_one_row_and_distinct_ids_store_two(
    store: Store,
) -> None:
    storm = [event_frame("tool_call", DM_A) for _ in range(990)]
    distinct = [event_frame("tool_call", DM_A, tool_call_id="tc_2")]
    harness = real(store, feeds=[[slots_frame("full"), *storm, *distinct, END]])
    drive(harness)
    stored = table(
        store, "SELECT dedup_key FROM observation WHERE event_type = 'tool_call' ORDER BY seq"
    )
    assert len(stored) == 2 and stored[0] != stored[1]
    body = counts(harness)
    assert body["deduplicated"] == 989 and body["dropped_with_gap_record"] == 0
    assert harness.collector.diagnostics()["balanced"] is True


def test_chat_done_dedupes_on_turn_and_never_collapses_events_without_one(store: Store) -> None:
    same = [event_frame("chat_done", DM_A) for _ in range(5)]
    no_turn = [
        '{"type":"chat_done","data":{"slot":"' + DM_A + '","continuing":true}}' for _ in range(2)
    ]
    harness = real(store, feeds=[[slots_frame("full"), *same, *no_turn, END]])
    drive(harness)
    stored = table(
        store, "SELECT dedup_key FROM observation WHERE event_type = 'chat_done' ORDER BY seq"
    )
    keys = [key for (key,) in stored]
    assert keys.count(None) == 2
    assert len([key for key in keys if key is not None]) == 1


def test_row_snapshots_that_differ_only_in_activity_time_store_one_row_and_a_changed_fact_a_second(
    store: Store,
) -> None:
    def snapshot(n: int, **facts: object) -> str:
        stamp = f"2026-11-16T12:{n // 60:02d}:{n % 60:02d}+00:00"
        return slots(row("botA", last_activity_ts=stamp, **facts))

    sessions = [[slots_frame("full"), END]] + [[snapshot(n), END] for n in range(1, 300)]
    sessions.append([snapshot(300, needs_input=True), END])
    harness = real(store, feeds=sessions)

    async def scenario() -> None:
        assert await harness.collector.begin()
        for _ in sessions:
            await harness.collector.feed_once()
            await harness.collector.flush()
        await harness.collector.stop()

    run(scenario())
    rows_stored = table(
        store,
        "SELECT json_extract(payload, '$.needsInput') FROM observation"
        " WHERE kind = 'row-change' AND slot_key = ? ORDER BY seq",
        (DM_A,),
    )
    assert rows_stored == [(None,), (1,)]
    assert counts(harness)["deduplicated"] >= 299
    assert harness.collector.diagnostics()["balanced"] is True


NO_SIDE_LOOPS = small(heartbeat_interval_s=1e9, roster_interval_s=1e9, flush_interval_s=1e9)


@pytest.mark.parametrize(("draw", "factor"), [(0.0, 1 - LIMITS.jitter), (1.0, 1 + LIMITS.jitter)])
def test_a_hundred_failed_dials_back_off_to_the_cap_with_jitter_and_never_spin(
    draw: float, factor: float
) -> None:
    harness = build(
        feeds=[[END] for _ in range(RECONNECTS)] + [[PolicyClose()]],
        limits=NO_SIDE_LOOPS,
        rng=draw,
    )

    async def scenario() -> None:
        await harness.collector.start()
        await until_stopped(harness)
        await harness.collector.wait_closed()

    run(scenario())
    delays = [d for d in harness.sleeper.delays if d < 1_000]
    assert len(delays) == RECONNECTS
    assert delays[:6] == [pytest.approx(step * factor) for step in STEPS]
    assert min(delays) >= FIRST_STEP_FLOOR and max(delays) <= LAST_STEP_CEILING
    assert delays == sorted(delays)
    assert harness.collector.status().reason_code == "app-disabled"


def test_every_reconnect_after_a_snapshot_records_a_gap_and_covers_again_only_on_a_new_snapshot(
    store: Store,
) -> None:
    sessions: list[Any] = [[slots_frame("full"), END] for _ in range(RECONNECTS)]
    harness = real(store, feeds=[*sessions, [PolicyClose()]], limits=NO_SIDE_LOOPS)

    async def scenario() -> None:
        await harness.collector.start()
        await until_stopped(harness)
        await harness.collector.wait_closed()

    run(scenario())
    states = table(store, "SELECT state, reason FROM coverage_interval ORDER BY interval_id")
    gaps = [reason for state, reason in states if state == "gap"]
    assert gaps.count("disconnect") == RECONNECTS
    assert sum(1 for state, _ in states if state == "covered") == RECONNECTS
    assert harness.collector.diagnostics()["balanced"] is True


def test_a_partial_snapshot_opens_no_covered_interval(store: Store) -> None:
    harness = real(store, feeds=[[slots_frame("partial", partial=True), END]])
    drive(harness)
    assert table(store, "SELECT COUNT(*) FROM coverage_interval WHERE state = 'covered'") == [(0,)]


def test_prose_in_a_row_never_reaches_the_store_under_load(store: Store) -> None:
    frames = [slots(row("botA", title=SENTINEL, last_message=SENTINEL, prompt_preview=SENTINEL))]
    harness = real(store, feeds=[[*frames, END]])
    drive(harness)
    dump = repr(table(store, "SELECT payload FROM observation"))
    assert SENTINEL not in dump
