from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from backend.specter_arena.store import (
    HEARTBEAT_STALE_MS,
    BindingSeen,
    CoverageMark,
    DmKey,
    IngestBatch,
    IngestItem,
    IngestResult,
    InvalidCursor,
    ObservationIn,
    QuarantineIn,
    RosterPoll,
    RosterRowIn,
    Store,
    StoreUsageError,
    end_run,
    get_binding,
    heartbeat,
    ingest,
    open_store,
    recent_quarantine,
    roster_page,
    roster_revision,
    row_fact_digest,
    start_run,
)
from backend.specter_arena.store.paging import encode_cursor

T0 = 1_800_000_000_000
RUN = "run-00000001"
RUN2 = "run-00000002"


def key_of(n: int) -> DmKey:
    return DmKey(f"bot{n}-0123456789ab", f"memory-bot{n}")


def dm_of(n: int) -> str:
    return f"member-bot{n}-0123456789ab.memory-memory-bot{n}"


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    opened = open_store(tmp_path / "data")
    try:
        yield opened
    finally:
        opened.close()


def installation(opened: Store) -> str:
    with opened.read() as conn:
        return str(conn.execute("SELECT store_id FROM store_meta").fetchone()[0])


def run(opened: Store, *items: IngestItem, run_id: str = RUN) -> IngestResult:
    return ingest(opened, IngestBatch(run_id, installation(opened), items))


def row(opened: Store, n: int, ms: int, slot: str | None = None, **facts: Any) -> ObservationIn:
    payload: dict[str, Any] = {"running": True, **facts}
    return ObservationIn(
        installation_id=installation(opened),
        dm_key=dm_of(n),
        slot_key=slot or dm_of(n),
        kind="row-change",
        event_type="slot-row",
        received_at_ms=ms,
        payload=payload,
        turn=payload.get("turn"),
        turn_gen=payload.get("turnGen"),
        fact_digest=row_fact_digest(payload),
    )


def poll(ms: int, *numbers: int) -> RosterPoll:
    rows = tuple(
        RosterRowIn(f"memory-bot{n}", f"Bot {n}", f"Bot {n} Name", "ghost", None) for n in numbers
    )
    return RosterPoll(True, ms, rows)


def page(opened: Store, as_of_ms: int, cursor: str | None = None, limit: int = 50) -> Any:
    return roster_page(opened, cursor=cursor, limit=limit, as_of_ms=as_of_ms)


def covered_feed(opened: Store, *numbers: int) -> None:
    start_run(opened, run_id=RUN, now_ms=T0)
    run(opened, *(BindingSeen(key_of(n), T0) for n in numbers), CoverageMark("open-covered", T0))


# Coverage read rules ---------------------------------------------------------------------------


def test_an_empty_store_has_an_empty_page_and_revision_zero(store: Store) -> None:
    assert roster_revision(store) == 0
    result = page(store, T0)
    assert (result.items, result.next_cursor) == ((), None)


def test_with_no_run_every_bot_is_unknown(store: Store) -> None:
    run_id = start_run(store, run_id=RUN, now_ms=T0).run_id
    run(store, BindingSeen(key_of(1), T0), run_id=run_id)
    (only,) = page(store, T0).items
    assert (only.coverage.state, only.coverage.reason, only.coverage.since_ms) == (
        "unknown",
        None,
        None,
    )
    assert only.coverage.open_gap_count == 0


def test_rule_1_a_covered_feed_with_a_fresh_heartbeat_is_covered(store: Store) -> None:
    covered_feed(store, 1)
    run(store, row(store, 1, T0 + 5, turn=1, turnGen="ab12"))
    (only,) = page(store, T0 + HEARTBEAT_STALE_MS).items
    assert (only.coverage.state, only.coverage.reason, only.coverage.since_ms) == (
        "covered",
        None,
        T0,
    )


def test_rule_1_a_stale_heartbeat_reads_unknown_and_the_next_heartbeat_restores_it(
    store: Store,
) -> None:
    covered_feed(store, 1)
    run(store, row(store, 1, T0 + 5))
    late = T0 + HEARTBEAT_STALE_MS + 1
    (stale,) = page(store, late).items
    assert (stale.coverage.state, stale.coverage.reason) == ("unknown", "heartbeat-stale")
    assert (stale.coverage.since_ms, stale.coverage.open_gap_count) == (T0, 0)
    heartbeat(store, run_id=RUN, now_ms=late)
    (fresh,) = page(store, late).items
    assert fresh.coverage.state == "covered"


def test_the_heartbeat_boundary_is_not_stale_at_exactly_the_limit(store: Store) -> None:
    covered_feed(store, 1)
    run(store, row(store, 1, T0 + 1))
    assert page(store, T0 + HEARTBEAT_STALE_MS).items[0].coverage.state == "covered"
    assert page(store, T0 + HEARTBEAT_STALE_MS + 1).items[0].coverage.state == "unknown"


def test_rule_1_an_open_gap_shows_its_reason_and_counts_one(store: Store) -> None:
    covered_feed(store, 1)
    run(store, CoverageMark("close", T0 + 10, "disconnect"))
    (only,) = page(store, T0 + 20).items
    assert (only.coverage.state, only.coverage.reason, only.coverage.since_ms) == (
        "gap",
        "disconnect",
        T0 + 10,
    )
    assert only.coverage.open_gap_count == 1


def test_rule_1_a_run_that_ended_cleanly_reads_as_its_gap(store: Store) -> None:
    covered_feed(store, 1)
    end_run(store, run_id=RUN, now_ms=T0 + 10, reason="restart")
    (only,) = page(store, T0 + 11).items
    assert (only.coverage.state, only.coverage.reason) == ("gap", "restart")


def test_rule_1_a_run_with_no_coverage_is_unknown_and_a_second_run_says_restart(
    store: Store,
) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    run(store, BindingSeen(key_of(1), T0))
    assert page(store, T0).items[0].coverage.reason is None
    start_run(store, run_id=RUN2, now_ms=T0 + 5)
    (only,) = page(store, T0 + 6).items
    assert (only.coverage.state, only.coverage.reason) == ("unknown", "restart")


def test_a_run_that_died_with_no_later_start_reads_stale(store: Store) -> None:
    covered_feed(store, 1)
    run(store, row(store, 1, T0 + 1))
    (only,) = page(store, T0 + 10 * HEARTBEAT_STALE_MS).items
    assert (only.coverage.state, only.coverage.reason) == ("unknown", "heartbeat-stale")


def test_rule_2_a_bot_whose_slot_was_never_seen_is_unknown_no_slot_yet(store: Store) -> None:
    covered_feed(store, 1, 2)
    run(store, row(store, 1, T0 + 5))
    first, second = page(store, T0 + 6).items
    assert first.coverage.state == "covered"
    assert (second.coverage.state, second.coverage.reason, second.coverage.since_ms) == (
        "unknown",
        "no-slot-yet",
        T0,
    )


def test_rule_2_a_slot_last_seen_before_the_covered_interval_is_feed_absent(store: Store) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    run(store, BindingSeen(key_of(1), T0), CoverageMark("open-covered", T0))
    run(store, row(store, 1, T0 + 1), CoverageMark("close", T0 + 2, "disconnect"))
    run(store, CoverageMark("open-covered", T0 + 100))
    (only,) = page(store, T0 + 101).items
    assert (only.coverage.state, only.coverage.reason, only.coverage.since_ms) == (
        "unknown",
        "feed-absent",
        T0 + 100,
    )
    run(store, row(store, 1, T0 + 100))
    assert page(store, T0 + 101).items[0].coverage.state == "covered"


def test_rule_3_a_feed_gap_shows_on_every_bot_whatever_its_slot_says(store: Store) -> None:
    covered_feed(store, 1, 2)
    run(store, row(store, 1, T0 + 1), CoverageMark("close", T0 + 5, "overflow"))
    items = page(store, T0 + 6).items
    assert [(i.coverage.state, i.coverage.reason) for i in items] == [("gap", "overflow")] * 2


def test_rule_5_workers_count_only_while_covered_and_seen_in_the_interval(store: Store) -> None:
    covered_feed(store, 1)
    worker = {"createdBy": dm_of(1), "createdMs": 3}
    run(store, row(store, 1, T0 + 1), row(store, 1, T0 + 2, slot="chat-1", **worker))
    run(store, row(store, 1, T0 + 3, slot="chat-2", **worker))
    run(store, row(store, 1, T0 + 4, slot="chat-2", running=False, **worker))
    (only,) = page(store, T0 + 5).items
    assert (only.workers_running, only.workers_seen, only.workers_unknown) == (1, 2, 0)
    run(store, CoverageMark("close", T0 + 6, "disconnect"))
    (gapped,) = page(store, T0 + 7).items
    assert (gapped.workers_running, gapped.workers_seen, gapped.workers_unknown) == (0, 2, 1)
    run(store, CoverageMark("open-covered", T0 + 100))
    (reopened,) = page(store, T0 + 101).items
    assert (reopened.workers_running, reopened.workers_unknown) == (0, 1)


# Row content -----------------------------------------------------------------------------------


def test_facts_are_none_until_a_dm_row_is_stored_and_events_do_not_create_them(
    store: Store,
) -> None:
    covered_feed(store, 1)
    assert page(store, T0).items[0].facts is None
    event = ObservationIn(
        installation_id=installation(store),
        dm_key=dm_of(1),
        slot_key=dm_of(1),
        kind="event",
        event_type="chat_status",
        received_at_ms=T0 + 4,
        payload={},
    )
    run(store, event)
    (only,) = page(store, T0 + 5).items
    assert only.facts is None and only.last_observed_ms == T0 + 4


def test_a_row_and_an_event_fill_the_facts_and_the_last_observed_time(store: Store) -> None:
    covered_feed(store, 1)
    run(
        store,
        row(
            store,
            1,
            T0 + 2,
            turn=4,
            turnGen="ab12",
            lastActivityMs=77,
            interrupted=False,
            hasOptions=True,
        ),
    )
    event = ObservationIn(
        installation_id=installation(store),
        dm_key=dm_of(1),
        slot_key=dm_of(1),
        kind="event",
        event_type="chat_done",
        received_at_ms=T0 + 9,
        payload={"continuing": False},
        turn=4,
        turn_gen="ab12",
        dedup_key="d1",
    )
    run(store, event)
    (only,) = page(store, T0 + 10).items
    facts = only.facts
    assert facts is not None
    assert (facts.running, facts.turn, facts.turn_gen, facts.last_activity_ms) == (
        True,
        4,
        "ab12",
        77,
    )
    assert (facts.interrupted, facts.has_options, facts.pending_approval) == (False, True, None)
    assert (facts.row_observed_ms, facts.event_observed_ms) == (T0 + 2, T0 + 9)
    assert only.last_observed_ms == T0 + 9


def test_identity_fields_come_from_the_newest_revision_and_presence(store: Store) -> None:
    covered_feed(store, 1)
    run(store, poll(T0 + 1, 1))
    run(
        store,
        RosterPoll(True, T0 + 2, (RosterRowIn("memory-bot1", "Renamed", None, "image", "a.png"),)),
    )
    (only,) = page(store, T0 + 3).items
    assert (only.name, only.display_name, only.avatar_kind, only.avatar_ref) == (
        "Renamed",
        None,
        "image",
        "a.png",
    )
    assert (only.presence, only.presence_since_ms) == ("present", T0 + 1)
    run(store, poll(T0 + 4))
    assert page(store, T0 + 5).items[0].presence == "absent"


def test_presence_is_unknown_before_the_first_successful_poll(store: Store) -> None:
    covered_feed(store, 1)
    (only,) = page(store, T0 + 1).items
    assert (only.presence, only.presence_since_ms, only.display_name, only.name) == (
        "unknown",
        None,
        None,
        None,
    )


# Paging and revision ---------------------------------------------------------------------------


def test_the_keyset_is_stable_across_a_rename_and_new_bindings(store: Store) -> None:
    covered_feed(store, 1, 2, 3, 4, 5)
    first = page(store, T0 + 1, limit=2)
    assert [i.binding_seq for i in first.items] == [1, 2] and first.next_cursor is not None
    run(store, poll(T0 + 2, 1, 2, 3))
    run(store, BindingSeen(key_of(6), T0 + 3))
    second = page(store, T0 + 4, cursor=first.next_cursor, limit=2)
    assert [i.binding_seq for i in second.items] == [3, 4]
    third = page(store, T0 + 4, cursor=second.next_cursor, limit=2)
    assert [i.binding_seq for i in third.items] == [5, 6] and third.next_cursor is None


def test_the_limit_is_clamped_to_the_paging_bounds(store: Store) -> None:
    covered_feed(store, 1, 2)
    assert len(page(store, T0, limit=0).items) == 1
    assert len(page(store, T0, limit=10_000).items) == 2


@pytest.mark.parametrize(
    "cursor", ["not a cursor", "AAAA", encode_cursor([1, 2]), encode_cursor(["x"])]
)
def test_an_invalid_cursor_is_rejected(store: Store, cursor: str) -> None:
    with pytest.raises(InvalidCursor):
        page(store, T0, cursor=cursor)


@pytest.mark.parametrize("as_of_ms", [-1, True, 2.5])
def test_a_bad_as_of_time_is_a_usage_error(store: Store, as_of_ms: Any) -> None:
    with pytest.raises(StoreUsageError):
        page(store, as_of_ms)


def test_the_revision_moves_only_on_a_persisted_change(store: Store) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    started = roster_revision(store)
    run(store, BindingSeen(key_of(1), T0))
    bound = roster_revision(store)
    assert bound == started + 1
    run(store, BindingSeen(key_of(1), T0 + 1))
    assert roster_revision(store) == bound
    page(store, T0 + 2)
    assert roster_revision(store) == bound
    run(store, CoverageMark("open-covered", T0 + 3))
    assert roster_revision(store) == bound + 1


def test_a_page_read_after_the_revision_is_at_least_as_new(store: Store) -> None:
    covered_feed(store, 1)
    revision = roster_revision(store)
    run(store, row(store, 1, T0 + 1, turn=1, turnGen="ab12"))
    assert page(store, T0 + 2).items[0].facts is not None
    assert roster_revision(store) > revision


# Binding and quarantine reads ----------------------------------------------------------------


def test_a_binding_record_carries_the_newest_slot_seen_time(store: Store) -> None:
    covered_feed(store, 1)
    binding_id = page(store, T0).items[0].binding_id
    record = get_binding(store, binding_id)
    assert record is not None and record.last_seen_ms is None
    run(store, row(store, 1, T0 + 8), row(store, 1, T0 + 3, slot="chat-1", createdBy=dm_of(1)))
    record = get_binding(store, binding_id)
    assert record is not None and record.last_seen_ms == T0 + 8


def test_recent_quarantine_is_newest_first_and_bounded(store: Store) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    items = tuple(
        QuarantineIn(T0 + i, "unknown-event-type", f"frame_{i}", i, count=i + 1) for i in range(5)
    )
    run(store, *items)
    newest = recent_quarantine(store, limit=3)
    assert [r.frame_type for r in newest] == ["frame_4", "frame_3", "frame_2"]
    assert newest[0].installation_id == installation(store)
    assert (newest[0].count, newest[0].first_received_at_ms, newest[0].received_at_ms) == (
        5,
        T0 + 4,
        T0 + 4,
    )
    assert len(recent_quarantine(store, limit=200)) == 5


@pytest.mark.parametrize("limit", [0, 201, -1, True, 1.5])
def test_recent_quarantine_limit_is_bounded(store: Store, limit: Any) -> None:
    with pytest.raises(StoreUsageError):
        recent_quarantine(store, limit=limit)


def test_recent_quarantine_of_an_empty_store_is_empty(store: Store) -> None:
    assert recent_quarantine(store, limit=10) == ()
