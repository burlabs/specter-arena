"""The collector against the real SQLite store, so the in-memory fake cannot drift from it.

Every scenario writes through `SqliteStorePort` into a store under `tmp_path`; nothing opens the
resolved Crew data directory and nothing reaches a gateway beyond the scripted fake.
"""

import asyncio
import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from backend.specter_arena import wire
from backend.specter_arena.collector.gateway import Transient
from backend.specter_arena.collector.parse import (
    EVENT_PAYLOAD_KEYS as PARSE_EVENT_KEYS,
)
from backend.specter_arena.collector.parse import SLOT_ROW_KEYS
from backend.specter_arena.collector.supervisor import SqliteStorePort
from backend.specter_arena.store import (
    EVENT_PAYLOAD_KEYS,
    ROW_FACT_KEYS,
    Store,
    open_store,
)
from backend.tests.collector_fakes import FakeClock
from backend.tests.collector_scenarios import (
    DM_A,
    DM_B,
    KEY_A,
    KEY_B,
    SENTINEL,
    WORKER_1,
    agent_row,
    bot_row,
    build,
    chat_done,
    event,
    slots,
    worker_row,
)

END = Transient("scripted-end")


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    opened = open_store(tmp_path / "data")
    try:
        yield opened
    finally:
        opened.close()


def table(store: Store, sql: str, params: tuple[Any, ...] = ()) -> list[tuple[Any, ...]]:
    with store.read() as conn:
        return [tuple(row) for row in conn.execute(sql, params)]


def real(store: Store, run_id: str = "run-00000001", **options: Any) -> Any:
    return build(store=SqliteStorePort(store), run_id=run_id, **options)


def run(coro: Any) -> Any:
    return asyncio.run(coro)


def drive(harness: Any, *, polls: int = 0) -> None:
    async def scenario() -> None:
        assert await harness.collector.begin()
        await harness.collector.feed_once()
        for _ in range(polls):
            await harness.collector.poll_roster()
        await harness.collector.stop()

    run(scenario())


FRAMES = [
    slots(bot_row(), bot_row(DM_B, turn=3), worker_row(), bot_row("member-bot-c")),
    chat_done(1),
    event("tool_call", tool_call_id="tc_1", is_shell=False),
    event("tool_result", tool_call_id="tc_1"),
    event("context_usage", used_tokens=10, window_tokens=100, pct=0.1),
    event("chat_status"),
    chat_done(1),
]


def test_the_store_constants_the_wire_module_copies_have_not_drifted() -> None:
    assert set(ROW_FACT_KEYS) == wire.ROW_FACT_KEYS == SLOT_ROW_KEYS | {"running"}
    assert {kind: set(keys) for kind, keys in EVENT_PAYLOAD_KEYS.items()} == {
        kind: set(keys) for kind, keys in wire.EVENT_PAYLOAD_KEYS.items()
    }
    assert {kind: set(keys) for kind, keys in EVENT_PAYLOAD_KEYS.items()} == {
        kind: set(keys) for kind, keys in PARSE_EVENT_KEYS.items()
    }


def test_a_scripted_run_persists_every_item_kind_and_the_counts_match_the_accounting(
    store: Store,
) -> None:
    harness = real(store, feeds=[[*FRAMES, END]])
    drive(harness)
    assert table(store, "SELECT COUNT(*) FROM bot_binding") == [(2,)]
    kinds = dict(table(store, "SELECT kind, COUNT(*) FROM observation GROUP BY kind"))
    assert kinds == {"row-change": 3, "event": 5}
    events = dict(
        table(store, "SELECT event_type, COUNT(*) FROM observation WHERE kind='event' GROUP BY 1")
    )
    assert events == {
        "chat_done": 1,
        "tool_call": 1,
        "tool_result": 1,
        "context_usage": 1,
        "chat_status": 1,
    }
    diagnostics = harness.collector.diagnostics()
    counts = diagnostics["counts"]
    assert counts["persisted"] == 8 and counts["deduplicated"] == 1
    assert counts["rejected"] == 0 and diagnostics["balanced"] is True
    assert SENTINEL not in json.dumps(table(store, "SELECT payload FROM observation"))


def test_every_row_the_collector_writes_passes_the_stores_own_validators_and_digest(
    store: Store,
) -> None:
    harness = real(store, feeds=[[slots(bot_row(), worker_row()), END]])
    drive(harness)
    assert harness.collector.diagnostics()["counts"]["rejected"] == 0
    digests = table(store, "SELECT fact_digest FROM observation WHERE kind='row-change'")
    assert len(digests) == 2 and all(len(d[0]) == 64 for d in digests)


def test_coverage_opens_on_the_first_snapshot_and_a_dropped_socket_opens_a_disconnect_gap(
    store: Store,
) -> None:
    harness = real(store, feeds=[[slots(bot_row()), END]])
    drive(harness)
    rows = table(
        store, "SELECT state, reason, end_ms IS NULL FROM coverage_interval ORDER BY interval_id"
    )
    assert rows[0][:2] == ("covered", None) and rows[0][2] == 0
    assert rows[1][:2] == ("gap", "disconnect")


def test_a_clean_stop_ends_the_run_with_restart_and_closes_the_covered_interval(
    store: Store,
) -> None:
    harness = build(
        store=SqliteStorePort(store),
        run_id="run-00000001",
        feeds=[[slots(bot_row())]],
        holding=True,
    )

    async def scenario() -> None:
        await harness.collector.start()
        while not table(store, "SELECT 1 FROM observation"):
            await asyncio.sleep(0.001)
        await harness.collector.stop()

    run(scenario())
    assert table(store, "SELECT end_reason FROM collector_run") == [("restart",)]
    assert table(
        store, "SELECT COUNT(*) FROM coverage_interval WHERE end_ms IS NULL AND state='covered'"
    ) == [(0,)]


def test_reconnect_overlap_is_absorbed_by_the_real_digest_and_dedup_rules(store: Store) -> None:
    snapshot = slots(bot_row(), worker_row())
    harness = real(store, feeds=[[snapshot, chat_done(1), END], [snapshot, chat_done(1), END]])

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.feed_once()
        await harness.collector.feed_once()
        await harness.collector.stop()

    run(scenario())
    assert table(store, "SELECT COUNT(*) FROM observation") == [(3,)]
    counts = harness.collector.diagnostics()["counts"]
    assert (counts["persisted"], counts["deduplicated"]) == (3, 3)
    assert harness.collector.diagnostics()["balanced"] is True


def test_five_hundred_unknown_frames_are_one_quarantine_row_with_a_count(store: Store) -> None:
    unknown = [json.dumps({"type": "brand_new", "n": n}) for n in range(500)]
    harness = real(store, feeds=[[slots(bot_row()), *unknown, END]])
    drive(harness)
    assert table(store, "SELECT reason, frame_type, count, digest FROM quarantine") == [
        ("unknown-event-type", "brand_new", 500, None)
    ]
    assert harness.collector.diagnostics()["counts"]["quarantined"] == 500


def test_a_store_less_bot_never_reaches_the_store(store: Store) -> None:
    harness = real(store, feeds=[[slots(bot_row("member-bot-c")), END]])
    drive(harness)
    assert table(store, "SELECT COUNT(*) FROM bot_binding") == [(0,)]
    assert table(store, "SELECT COUNT(*) FROM quarantine") == [(0,)]
    assert harness.collector.status().notes == (("unsupported-store-less-bot", 1),)


def test_a_roster_poll_records_a_display_revision_and_a_rename_a_second_one(
    store: Store,
) -> None:
    old = [
        agent_row(KEY_A.memory_store, "bot-a", "Old"),
        agent_row(KEY_B.memory_store, "bot-b", "B"),
    ]
    new = [
        agent_row(KEY_A.memory_store, "bot-a", "New"),
        agent_row(KEY_B.memory_store, "bot-b", "B"),
    ]
    harness = real(
        store,
        feeds=[[slots(bot_row(), bot_row(DM_B)), END]],
        answers={"/api/agents": [old, new]},
    )
    drive(harness, polls=2)
    names = table(
        store,
        "SELECT b.dm_key, r.revision_no, r.display_name FROM bot_display_revision r"
        " JOIN bot_binding b USING (binding_id) ORDER BY b.dm_key, r.revision_no",
    )
    assert names == [(DM_A, 1, "Old"), (DM_A, 2, "New"), (DM_B, 1, "B")]
    assert table(store, "SELECT COUNT(*) FROM bot_binding") == [(2,)]
    assert table(store, "SELECT roster_ok FROM collector_run") == [(1,)]


def test_replacement_under_the_same_name_is_a_second_binding_never_merged(store: Store) -> None:
    first = [agent_row(KEY_A.memory_store, "bot", "Same")]
    second = [agent_row(KEY_B.memory_store, "bot", "Same")]
    harness = real(
        store,
        feeds=[[slots(bot_row()), END], [slots(bot_row(DM_B)), END]],
        answers={"/api/agents": [first, second]},
    )

    async def scenario() -> None:
        await harness.collector.begin()
        await harness.collector.feed_once()
        await harness.collector.poll_roster()
        await harness.collector.feed_once()
        await harness.collector.poll_roster()
        await harness.collector.stop()

    run(scenario())
    assert table(store, "SELECT dm_key FROM bot_binding ORDER BY binding_seq") == [(DM_A,), (DM_B,)]
    presence = table(
        store,
        "SELECT b.dm_key, p.state FROM bot_presence p JOIN bot_binding b USING (binding_id)"
        " ORDER BY p.presence_id",
    )
    assert (DM_A, "present") in presence and (DM_B, "present") in presence
    assert (DM_A, "absent") in presence


def test_a_failed_roster_poll_is_recorded_on_the_run(store: Store) -> None:
    harness = real(
        store, feeds=[[slots(bot_row()), END]], answers={"/api/agents": [Transient("down")]}
    )
    drive(harness, polls=1)
    assert table(store, "SELECT roster_ok, roster_reason FROM collector_run") == [
        (0, "roster-unavailable")
    ]


def test_a_second_run_after_a_crash_with_open_coverage_leaves_one_restart_gap(store: Store) -> None:
    clock = FakeClock()
    first = real(store, "run-00000001", feeds=[[slots(bot_row())]], holding=True, clock=clock)

    async def crash() -> None:
        await first.collector.start()
        while not table(store, "SELECT 1 FROM coverage_interval"):
            await asyncio.sleep(0.001)
        task = first.collector._main
        assert task is not None
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

    run(crash())
    clock.advance(120)
    second = real(store, "run-00000002", feeds=[[END]], clock=clock)

    async def restart() -> None:
        assert await second.collector.begin()

    run(restart())
    gaps = table(store, "SELECT run_id, reason FROM coverage_interval WHERE reason='restart'")
    assert gaps == [("run-00000001", "restart")]
    assert table(store, "SELECT end_reason FROM collector_run WHERE run_id='run-00000001'") == [
        ("restart",)
    ]


def test_a_crashed_run_that_never_opened_coverage_leaves_no_restart_gap(store: Store) -> None:
    clock = FakeClock()
    first = real(store, "run-00000001", clock=clock)
    run(first.collector.begin())
    clock.advance(120)
    second = real(store, "run-00000002", clock=clock)
    run(second.collector.begin())
    assert table(store, "SELECT COUNT(*) FROM coverage_interval") == [(0,)]
    assert table(store, "SELECT end_reason FROM collector_run ORDER BY started_ms") == [
        ("restart",),
        (None,),
    ]


def test_bindings_survive_a_restart_and_the_new_run_adopts_them_without_a_new_binding(
    store: Store,
) -> None:
    first = real(store, "run-00000001", feeds=[[slots(bot_row(turn=2)), END]])
    drive(first)
    second = real(store, "run-00000002", feeds=[[slots(bot_row(turn=3)), END]])
    drive(second)
    assert table(store, "SELECT COUNT(*) FROM bot_binding") == [(1,)]
    assert table(store, "SELECT turn FROM observation ORDER BY seq") == [(2,), (3,)]
    assert [m for m in second.collector.diagnostics()["counters"]] == []


def test_a_worker_row_is_attributed_to_its_creators_binding_in_the_real_store(
    store: Store,
) -> None:
    harness = real(store, feeds=[[slots(bot_row(), worker_row()), END]])
    drive(harness)
    assert table(
        store,
        "SELECT o.slot_key, b.dm_key FROM observation o JOIN bot_binding b USING (binding_id)"
        " ORDER BY o.seq",
    ) == [(DM_A, DM_A), (WORKER_1, DM_A)]


def test_pause_and_resume_write_the_real_flag_and_the_paused_close(store: Store) -> None:
    harness = build(
        store=SqliteStorePort(store),
        run_id="run-00000001",
        feeds=[[slots(bot_row())], [slots(bot_row(turn=2))]],
        holding=True,
    )

    async def wait_for(sql: str, expected: list[tuple[Any, ...]]) -> None:
        while table(store, sql) != expected:
            await asyncio.sleep(0.001)

    async def scenario() -> None:
        await harness.collector.start()
        await wait_for("SELECT COUNT(*) FROM observation", [(1,)])
        await harness.collector.pause()
        assert table(store, "SELECT paused FROM collector_setting") == [(1,)]
        assert table(store, "SELECT reason FROM coverage_interval WHERE state='gap'") == [
            ("paused",)
        ]
        await harness.collector.resume()
        await wait_for("SELECT COUNT(*) FROM observation", [(2,)])
        assert table(store, "SELECT paused FROM collector_setting") == [(0,)]
        await harness.collector.stop()

    run(scenario())
