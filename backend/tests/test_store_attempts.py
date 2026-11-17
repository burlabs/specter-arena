from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest

from backend.specter_arena.store import (
    HEARTBEAT_STALE_MS,
    NO_CUT,
    BindingSeen,
    CoverageMark,
    DmKey,
    Feed,
    IngestBatch,
    IngestItem,
    IngestResult,
    InvalidCursor,
    ObservationIn,
    Store,
    StoreUsageError,
    UnknownBinding,
    attempt_state,
    attempts_page,
    end_run,
    heartbeat,
    ingest,
    open_store,
    rebuild_projection,
    roster_page,
    row_fact_digest,
    start_run,
)
from backend.specter_arena.store.attempts import covered_ms, gap_count
from backend.specter_arena.store.paging import encode_cursor

T0 = 1_800_000_000_000
HOUR = 3_600_000
DAY = 24 * HOUR
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


def worker(opened: Store, n: int, ms: int, slot: str, created: int, **facts: Any) -> ObservationIn:
    return row(opened, n, ms, slot=slot, createdBy=dm_of(n), createdMs=created, **facts)


def chat_done(opened: Store, n: int, ms: int, turn: int, gen: str = "ab12") -> ObservationIn:
    return ObservationIn(
        installation_id=installation(opened),
        dm_key=dm_of(n),
        slot_key=dm_of(n),
        kind="event",
        event_type="chat_done",
        received_at_ms=ms,
        payload={},
        turn=turn,
        turn_gen=gen,
        dedup_key=f"chat_done:{gen}:{turn}",
    )


def covered_feed(opened: Store, *numbers: int, at: int = T0) -> None:
    start_run(opened, run_id=RUN, now_ms=at)
    run(opened, *(BindingSeen(key_of(n), at) for n in numbers), CoverageMark("open-covered", at))


def binding_id(opened: Store, n: int = 1) -> str:
    with opened.read() as conn:
        return str(
            conn.execute(
                "SELECT binding_id FROM bot_binding WHERE member_id = ?", (f"bot{n}-0123456789ab",)
            ).fetchone()[0]
        )


def attempts(opened: Store, n: int, as_of_ms: int, **kwargs: Any) -> Any:
    kwargs.setdefault("cursor", None)
    kwargs.setdefault("limit", 50)
    return attempts_page(opened, binding_id(opened, n), as_of_ms=as_of_ms, **kwargs)


def window(result: Any, key: str) -> Any:
    return next(w for w in result.activity if w.key == key)


# attempt_state: the SC4-2 table ----------------------------------------------------------------


def feed(state: str, reason: str | None = None, since: int | None = None) -> Feed:
    return Feed(state, reason, since, 0, since if state == "covered" else None)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("running", "end_signal", "seen", "the_feed", "expected"),
    [
        (False, "row-idle", None, feed("covered", None, 10), ("ended", "ended-row-idle")),
        (False, "chat_done", 5, feed("gap", "overflow"), ("ended", "ended-chat-done")),
        (False, "mystery", None, feed("unknown"), ("ended", "ended-other")),
        (False, None, None, feed("unknown"), ("ended", "ended-other")),
        (True, None, 50, feed("gap", "overflow"), ("unknown", "overflow")),
        (True, None, 50, feed("unknown", "heartbeat-stale"), ("unknown", "heartbeat-stale")),
        (True, None, 50, feed("unknown"), ("unknown", "no-coverage")),
        (True, None, None, feed("covered", None, 10), ("unknown", "no-slot-yet")),
        (True, None, 9, feed("covered", None, 10), ("unknown", "feed-absent")),
        (True, None, 10, feed("covered", None, 10), ("working", "running")),
        (True, None, 11, feed("covered", None, 10), ("working", "running")),
    ],
)
def test_attempt_state_follows_the_ordered_rule_table(
    running: bool, end_signal: str | None, seen: int | None, the_feed: Feed, expected: Any
) -> None:
    assert attempt_state(running, end_signal, seen, the_feed) == expected


# covered_ms and gap_count: the coveredMs edge-case table ---------------------------------------


@pytest.mark.parametrize(
    ("spans", "lo", "hi", "expected"),
    [
        ([], 0, 100, 0),
        ([(10, 20)], 0, 100, 10),
        ([(0, 100)], 0, 100, 100),
        ([(-50, 30)], 0, 100, 30),  # straddles the start edge
        ([(80, 500)], 0, 100, 20),  # straddles the end edge
        ([(100, 120)], 0, 100, 0),  # touches the end edge only
        ([(-10, 0)], 0, 100, 0),  # touches the start edge only
        ([(10, 40), (30, 60)], 0, 100, 50),  # overlap counts once
        ([(10, 40), (10, 40)], 0, 100, 30),  # identical spans count once
        ([(10, 90), (20, 30)], 0, 100, 80),  # nested
        ([(50, 50)], 0, 100, 0),  # a zero-length span adds nothing
        ([(10, 20), (30, 40)], 25, 100, 10),  # observed-from after the first span
        ([(0, 50)], 60, 100, 0),  # observed-from after every span
    ],
)
def test_covered_ms_is_the_clipped_union(
    spans: list[tuple[int, int]], lo: int, hi: int, expected: int
) -> None:
    assert covered_ms(spans, lo, hi) == expected


@pytest.mark.parametrize(
    ("spans", "expected"),
    [
        ([], 0),
        ([(10, 20)], 1),
        ([(-5, 0)], 0),  # ends exactly at the window start
        ([(100, 130)], 0),  # starts exactly at the window end, with length
        ([(0, 0)], 1),  # a point gap at the start edge
        ([(100, 100)], 1),  # a point gap at the end edge
        ([(-1, -1)], 0),
        ([(101, 101)], 0),
        ([(10, 20), (15, 25)], 2),  # overlapping gaps are counted as two rows
    ],
)
def test_gap_count_includes_point_gaps_on_the_edges(
    spans: list[tuple[int, int]], expected: int
) -> None:
    assert gap_count(spans, 0, 100) == expected


# attempts_page: shape, order, paging -----------------------------------------------------------


def test_an_unknown_or_malformed_binding_id_raises_unknown_binding(store: Store) -> None:
    covered_feed(store, 1)
    for bad in ("bnd_nope", "", "..", "x" * 300):
        with pytest.raises(UnknownBinding):
            attempts_page(store, bad, cursor=None, limit=50, as_of_ms=T0 + 1)


def test_bad_arguments_are_usage_errors(store: Store) -> None:
    covered_feed(store, 1)
    with pytest.raises(StoreUsageError):
        attempts_page(store, 7, cursor=None, limit=50, as_of_ms=T0)  # type: ignore[arg-type]
    for bad in (-1, 0, True, 1.5):
        with pytest.raises(StoreUsageError):
            attempts_page(store, binding_id(store), cursor=None, limit=50, as_of_ms=bad)  # type: ignore[arg-type]


def test_a_bot_with_no_attempts_has_an_empty_page_and_zero_counts(store: Store) -> None:
    covered_feed(store, 1)
    heartbeat(store, run_id=RUN, now_ms=T0 + HOUR)
    result = attempts(store, 1, T0 + HOUR)
    assert (result.page.items, result.page.next_cursor) == ((), None)
    day = window(result, "last24h")
    assert (day.sample_size, day.ended, day.still_open, day.unknown) == (0, 0, 0, 0)
    assert day.covered_ms == HOUR  # covered since T0, bot first seen at T0


def test_items_are_newest_first_with_attempt_id_as_the_tiebreak(store: Store) -> None:
    covered_feed(store, 1)
    run(
        store,
        worker(store, 1, T0 + 10, "chat-a", 1),
        worker(store, 1, T0 + 10, "chat-b", 2),
        worker(store, 1, T0 + 10, "chat-c", 3),
        worker(store, 1, T0 + 20, "chat-d", 4),
    )
    items = attempts(store, 1, T0 + 30).page.items
    keys = [(i.started_ms, i.attempt_id) for i in items]
    assert keys == sorted(keys, reverse=True)
    assert [i.started_ms for i in items] == [T0 + 20, T0 + 10, T0 + 10, T0 + 10]


def test_paging_walks_every_attempt_once_across_cursors_and_ties(store: Store) -> None:
    covered_feed(store, 1)
    run(store, *(worker(store, 1, T0 + 10 + i // 3, f"chat-{i}", i) for i in range(11)))
    seen: list[str] = []
    cursor = None
    for _ in range(20):
        result = attempts(store, 1, T0 + 100, cursor=cursor, limit=4)
        assert len(result.page.items) <= 4
        seen.extend(i.attempt_id for i in result.page.items)
        cursor = result.page.next_cursor
        if cursor is None:
            break
    assert len(seen) == len(set(seen)) == 11


def test_the_limit_is_clamped_to_fifty(store: Store) -> None:
    covered_feed(store, 1)
    run(store, *(worker(store, 1, T0 + 10 + i, f"chat-{i}", i) for i in range(55)))
    big = attempts(store, 1, T0 + 100, limit=500)
    assert len(big.page.items) == 50
    assert big.page.next_cursor is not None
    assert len(attempts(store, 1, T0 + 100, limit=0).page.items) == 1


def test_a_cursor_stays_valid_while_attempts_close(store: Store) -> None:
    covered_feed(store, 1)
    run(store, *(worker(store, 1, T0 + 10 + i, f"chat-{i}", i) for i in range(4)))
    first = attempts(store, 1, T0 + 100, limit=2)
    run(store, worker(store, 1, T0 + 50, "chat-3", 3, running=False))
    second = attempts(store, 1, T0 + 100, limit=2, cursor=first.page.next_cursor)
    assert [i.started_ms for i in second.page.items] == [T0 + 11, T0 + 10]


@pytest.mark.parametrize(
    "cursor",
    [
        "",
        "!!",
        encode_cursor([1]),
        encode_cursor([1, 2]),
        encode_cursor(["x", "att_" + "a" * 24]),
        encode_cursor([-1, "att_" + "a" * 24]),
        encode_cursor([1, "att_" + "A" * 24]),
        encode_cursor([1, "att_" + "a" * 23]),
        encode_cursor([1, "att_" + "a" * 24 + "0"]),
        encode_cursor([1, "x" * 28]),
        encode_cursor([1, "att_" + "a" * 24, 3]),
    ],
)
def test_a_malformed_cursor_is_invalid(store: Store, cursor: str) -> None:
    covered_feed(store, 1)
    with pytest.raises(InvalidCursor):
        attempts(store, 1, T0 + 1, cursor=cursor)


def test_no_slot_key_or_crew_id_is_returned(store: Store) -> None:
    covered_feed(store, 1)
    run(store, row(store, 1, T0 + 1), worker(store, 1, T0 + 2, "chat-secret-slot", 1))
    result = attempts(store, 1, T0 + 5)
    text = repr(result)
    assert "chat-secret-slot" not in text and "member-" not in text and ".memory-" not in text
    assert all(len(i.attempt_id) == 28 for i in result.page.items)


# Per-attempt condition through the store -------------------------------------------------------


def test_each_state_and_reason_comes_from_the_store(store: Store) -> None:
    covered_feed(store, 1)
    run(
        store,
        row(store, 1, T0 + 1, turn=1, turnGen="ab12"),
        worker(store, 1, T0 + 2, "chat-live", 1),
        worker(store, 1, T0 + 3, "chat-done", 2),
        worker(store, 1, T0 + 4, "chat-done", 2, running=False),
    )
    run(store, chat_done(store, 1, T0 + 5, 1))
    by_kind = {
        (i.kind, i.started_ms): (i.state, i.reason, i.end_signal)
        for i in attempts(store, 1, T0 + 10).page.items
    }
    assert by_kind == {
        ("bot-turn", T0 + 1): ("ended", "ended-chat-done", "chat_done"),
        ("worker", T0 + 2): ("working", "running", None),
        ("worker", T0 + 3): ("ended", "ended-row-idle", "row-idle"),
    }


def test_open_attempts_read_unknown_with_the_feed_reason_when_the_feed_is_not_covered(
    store: Store,
) -> None:
    covered_feed(store, 1)
    run(store, worker(store, 1, T0 + 2, "chat-1", 1), CoverageMark("close", T0 + 3, "disconnect"))
    (only,) = attempts(store, 1, T0 + 4).page.items
    assert (only.state, only.reason) == ("unknown", "disconnect")
    after_stale = attempts(store, 1, T0 + 3 + HEARTBEAT_STALE_MS + 1)
    assert after_stale.page.items[0].reason == "disconnect"  # the gap is still open


def test_a_stale_heartbeat_reads_unknown_heartbeat_stale(store: Store) -> None:
    covered_feed(store, 1)
    run(store, worker(store, 1, T0 + 2, "chat-1", 1))
    (fresh,) = attempts(store, 1, T0 + HEARTBEAT_STALE_MS).page.items
    assert fresh.state == "working"
    (stale,) = attempts(store, 1, T0 + HEARTBEAT_STALE_MS + 1).page.items
    assert (stale.state, stale.reason) == ("unknown", "heartbeat-stale")


def test_a_slot_last_seen_before_the_interval_is_feed_absent(store: Store) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    run(store, BindingSeen(key_of(1), T0), CoverageMark("open-covered", T0))
    run(store, worker(store, 1, T0 + 1, "chat-1", 1), CoverageMark("close", T0 + 2, "disconnect"))
    run(store, CoverageMark("open-covered", T0 + 100))
    (only,) = attempts(store, 1, T0 + 101).page.items
    assert (only.state, only.reason) == ("unknown", "feed-absent")
    run(store, worker(store, 1, T0 + 100, "chat-1", 1))
    assert attempts(store, 1, T0 + 101).page.items[0].state == "working"


# SC4-3 parity: roster counts and attempts agree ------------------------------------------------


def parity_store(store: Store) -> list[int]:
    """Bots 1-2 with fresh, stale, closed and gap-era workers; returns the as-of times to check."""
    covered_feed(store, 1, 2)
    run(
        store,
        row(store, 1, T0 + 1),
        row(store, 2, T0 + 1),
        worker(store, 1, T0 + 2, "chat-fresh", 1),
        worker(store, 1, T0 + 3, "chat-closed", 2),
        worker(store, 1, T0 + 4, "chat-closed", 2, running=False),
        worker(store, 2, T0 + 5, "chat-old", 3),
        CoverageMark("close", T0 + 10, "disconnect"),
    )
    run(store, CoverageMark("open-covered", T0 + 100))
    run(
        store,
        worker(store, 1, T0 + 101, "chat-fresh", 1),
        worker(store, 1, T0 + 102, "chat-new", 4),
    )
    heartbeat(store, run_id=RUN, now_ms=T0 + 200)
    return [
        T0 + 6,  # before the gap: bot 2's old worker is fresh
        T0 + 50,  # inside the gap: nothing is fresh
        T0 + 150,  # new interval: old workers are feed-absent
        T0 + 200 + HEARTBEAT_STALE_MS,
        T0 + 200 + HEARTBEAT_STALE_MS + 1,  # stale heartbeat
    ]


def test_roster_worker_counts_equal_attempts_page_counts_for_every_case(store: Store) -> None:
    times = parity_store(store)
    for as_of in times:
        roster = {
            r.binding_id: r for r in roster_page(store, cursor=None, limit=50, as_of_ms=as_of).items
        }
        assert len(roster) == 2
        for n in (1, 2):
            row_ = roster[binding_id(store, n)]
            items = attempts(store, n, as_of).page.items
            workers = [i for i in items if i.kind == "worker"]
            running = sum(1 for i in workers if i.state == "working")
            unknown = sum(1 for i in workers if i.state == "unknown")
            assert row_.workers_running == running, (as_of, n)
            assert row_.workers_unknown == unknown, (as_of, n)
            assert row_.workers_seen == len(workers), (as_of, n)


def test_the_roster_unknown_count_is_every_open_worker_when_the_feed_is_not_covered(
    store: Store,
) -> None:
    covered_feed(store, 1)
    run(
        store,
        worker(store, 1, T0 + 1, "chat-a", 1),
        worker(store, 1, T0 + 2, "chat-b", 2),
        worker(store, 1, T0 + 3, "chat-b", 2, running=False),
        CoverageMark("close", T0 + 4, "paused"),
    )
    (only,) = roster_page(store, cursor=None, limit=50, as_of_ms=T0 + 5).items
    assert (only.workers_running, only.workers_unknown, only.workers_seen) == (0, 1, 2)


def test_two_concurrent_workers_keep_their_own_states(store: Store) -> None:
    covered_feed(store, 1)
    run(store, worker(store, 1, T0 + 1, "chat-a", 1), worker(store, 1, T0 + 2, "chat-b", 2))
    # a second collector interval starts; only chat-b is seen again
    run(store, CoverageMark("close", T0 + 3, "disconnect"))
    run(store, CoverageMark("open-covered", T0 + 10), worker(store, 1, T0 + 11, "chat-b", 2))
    states = {i.started_ms: i.state for i in attempts(store, 1, T0 + 12).page.items}
    assert states == {T0 + 1: "unknown", T0 + 2: "working"}
    (row_,) = roster_page(store, cursor=None, limit=50, as_of_ms=T0 + 12).items
    assert (row_.workers_running, row_.workers_unknown) == (1, 1)


# Activity: counts, windows, denominators -------------------------------------------------------


def test_window_bounds_and_the_started_filter(store: Store) -> None:
    covered_feed(store, 1, at=T0)
    as_of = T0 + 10 * DAY
    heartbeat(store, run_id=RUN, now_ms=as_of)
    run(
        store,
        worker(store, 1, as_of - 8 * DAY, "chat-old", 1),  # outside both
        worker(store, 1, as_of - 3 * DAY, "chat-week", 2),  # 7 d only
        worker(store, 1, as_of - HOUR, "chat-day", 3),  # both
        worker(store, 1, as_of - DAY, "chat-edge", 4),  # exactly on the 24 h edge
    )
    result = attempts(store, 1, as_of)
    day, week = window(result, "last24h"), window(result, "last7d")
    assert (day.from_ms, day.to_ms, day.window_ms) == (as_of - DAY, as_of, DAY)
    assert (week.from_ms, week.to_ms, week.window_ms) == (as_of - 7 * DAY, as_of, 7 * DAY)
    assert (day.workers_started, day.sample_size) == (2, 2)
    assert (week.workers_started, week.sample_size) == (3, 3)
    assert len(result.page.items) == 4


def test_counts_split_into_ended_still_open_and_unknown_and_sum_to_the_sample(
    store: Store,
) -> None:
    covered_feed(store, 1)
    run(
        store,
        row(store, 1, T0 + 1, turn=1, turnGen="ab12"),
        worker(store, 1, T0 + 2, "chat-live", 1),
        worker(store, 1, T0 + 3, "chat-done", 2),
        worker(store, 1, T0 + 4, "chat-done", 2, running=False),
    )
    run(store, chat_done(store, 1, T0 + 5, 1))
    as_of = T0 + HEARTBEAT_STALE_MS
    day = window(attempts(store, 1, as_of), "last24h")
    assert (day.bot_turns_started, day.workers_started) == (1, 2)
    assert (day.ended, day.still_open, day.unknown) == (2, 1, 0)
    assert day.sample_size == day.ended + day.still_open + day.unknown == 3
    stale = window(attempts(store, 1, as_of + 1), "last24h")
    assert (stale.ended, stale.still_open, stale.unknown) == (2, 0, 1)
    assert stale.sample_size == 3


def test_window_counts_equal_the_items_for_every_case(store: Store) -> None:
    times = parity_store(store)
    for as_of in times:
        for n in (1, 2):
            result = attempts(store, n, as_of)
            items = [i for i in result.page.items if i.started_ms <= as_of]
            day = window(result, "last24h")
            assert day.sample_size == len(items)
            for state, field_ in (
                ("ended", "ended"),
                ("working", "still_open"),
                ("unknown", "unknown"),
            ):
                assert getattr(day, field_) == sum(1 for i in items if i.state == state)


def reconnect_batch(opened: Store) -> tuple[ObservationIn, ...]:
    return (
        row(opened, 1, T0 + 1, turn=1, turnGen="ab12"),
        worker(opened, 1, T0 + 2, "chat-live", 1),
        worker(opened, 1, T0 + 3, "chat-done", 2),
        worker(opened, 1, T0 + 4, "chat-done", 2, running=False),
        chat_done(opened, 1, T0 + 5, 1),
    )


def test_a_reconnect_snapshot_replay_persists_nothing_and_changes_no_count(store: Store) -> None:
    covered_feed(store, 1)
    batch = reconnect_batch(store)
    run(store, *batch)
    as_of = T0 + 1000
    before = attempts(store, 1, as_of)
    # A reconnect re-sends each slot's current row and the events again, with later times.
    newest = (batch[0], batch[1], batch[3], batch[4])
    for shift in (100, 200):
        replayed = run(
            store, *(replace(o, received_at_ms=o.received_at_ms + shift) for o in newest)
        )
        assert replayed.counts["observation"].persisted == 0
        assert replayed.counts["observation"].deduplicated == len(newest)
    after = attempts(store, 1, as_of)
    assert after.activity == before.activity
    assert after.page == before.page
    assert (after.page.items[0].attempt_id, len(after.page.items)) == (
        before.page.items[0].attempt_id,
        3,
    )


def test_a_full_history_replay_mints_no_new_attempt(store: Store) -> None:
    covered_feed(store, 1)
    batch = reconnect_batch(store)
    run(store, *batch)
    as_of = T0 + 1000
    before = attempts(store, 1, as_of)
    for shift in (100, 200):
        run(store, *(replace(o, received_at_ms=o.received_at_ms + shift) for o in batch))
    after = attempts(store, 1, as_of)
    assert after.activity == before.activity
    assert [(i.attempt_id, i.started_ms, i.state) for i in after.page.items] == [
        (i.attempt_id, i.started_ms, i.state) for i in before.page.items
    ]
    rebuild_projection(store, as_of_ms=as_of)
    assert attempts(store, 1, as_of).activity == before.activity


# Activity: coverage ----------------------------------------------------------------------------


def test_an_open_interval_with_a_fresh_heartbeat_runs_to_as_of(store: Store) -> None:
    covered_feed(store, 1)
    as_of = T0 + 5 * HOUR
    heartbeat(store, run_id=RUN, now_ms=as_of - 1_000)
    day = window(attempts(store, 1, as_of), "last24h")
    assert day.covered_ms == 5 * HOUR
    assert (day.window_ms, day.gap_count) == (DAY, 0)


def test_an_open_interval_with_a_stale_heartbeat_stops_at_the_last_heartbeat(
    store: Store,
) -> None:
    covered_feed(store, 1)
    heartbeat(store, run_id=RUN, now_ms=T0 + 2 * HOUR)
    as_of = T0 + 5 * HOUR
    day = window(attempts(store, 1, as_of), "last24h")
    assert day.covered_ms == 2 * HOUR
    assert window(attempts(store, 1, T0 + 2 * HOUR + HEARTBEAT_STALE_MS), "last24h").covered_ms == (
        2 * HOUR + HEARTBEAT_STALE_MS
    )


def test_a_closed_gap_removes_its_time_and_counts_once(store: Store) -> None:
    covered_feed(store, 1)
    run(store, CoverageMark("close", T0 + HOUR, "disconnect"))
    run(store, CoverageMark("open-covered", T0 + 2 * HOUR))
    as_of = T0 + 3 * HOUR
    heartbeat(store, run_id=RUN, now_ms=as_of)
    day = window(attempts(store, 1, as_of), "last24h")
    assert (day.covered_ms, day.gap_count) == (2 * HOUR, 1)


def test_an_open_gap_counts_and_adds_no_covered_time(store: Store) -> None:
    covered_feed(store, 1)
    run(store, CoverageMark("close", T0 + HOUR, "disconnect"))
    day = window(attempts(store, 1, T0 + 3 * HOUR), "last24h")
    assert (day.covered_ms, day.gap_count) == (HOUR, 1)


def test_an_interval_straddling_the_window_edge_is_clipped(store: Store) -> None:
    covered_feed(store, 1, at=T0)
    as_of = T0 + 30 * HOUR
    heartbeat(store, run_id=RUN, now_ms=as_of)
    result = attempts(store, 1, as_of)
    day, week = window(result, "last24h"), window(result, "last7d")
    assert day.covered_ms == DAY  # the covered interval began before the 24 h window
    assert week.covered_ms == 30 * HOUR
    assert week.observed_from_ms == T0  # first seen after the 7 d start


def test_overlapping_covered_intervals_from_two_runs_count_once(store: Store) -> None:
    covered_feed(store, 1)
    with store.write() as conn:
        # An overlap the collector never writes but the schema allows (read rule: merge first).
        conn.execute(
            "INSERT INTO collector_run (run_id, started_ms, last_heartbeat_ms, ended_ms)"
            " VALUES ('run-00000009', ?, ?, ?)",
            (T0 + HOUR, T0 + 3 * HOUR, T0 + 3 * HOUR),
        )
        conn.execute(
            "INSERT INTO coverage_interval (run_id, state, start_ms, end_ms)"
            " VALUES ('run-00000009', 'covered', ?, ?)",
            (T0 + HOUR, T0 + 3 * HOUR),
        )
    as_of = T0 + 4 * HOUR
    heartbeat(store, run_id=RUN, now_ms=as_of)
    day = window(attempts(store, 1, as_of), "last24h")
    assert day.covered_ms == 4 * HOUR


def test_a_point_gap_counts_and_removes_no_time(store: Store) -> None:
    covered_feed(store, 1)
    run(store, CoverageMark("gap", T0 + HOUR, "overflow", from_ms=T0 + HOUR))
    as_of = T0 + 2 * HOUR
    heartbeat(store, run_id=RUN, now_ms=as_of)
    day = window(attempts(store, 1, as_of), "last24h")
    assert (day.covered_ms, day.gap_count) == (2 * HOUR, 1)


def test_observed_from_is_the_first_seen_time_when_it_is_after_the_window_start(
    store: Store,
) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    first_seen = T0 + 10 * HOUR
    run(store, CoverageMark("open-covered", T0), BindingSeen(key_of(1), first_seen))
    as_of = T0 + 15 * HOUR
    heartbeat(store, run_id=RUN, now_ms=as_of)
    result = attempts(store, 1, as_of)
    day, week = window(result, "last24h"), window(result, "last7d")
    assert day.from_ms == max(0, as_of - DAY)
    assert day.observed_from_ms == first_seen
    assert day.covered_ms == 5 * HOUR  # only the time since this bot was first seen
    assert day.window_ms == DAY  # the full window length stays
    assert (week.observed_from_ms, week.covered_ms) == (first_seen, 5 * HOUR)
    for w in (day, week):
        assert w.from_ms <= w.observed_from_ms <= w.to_ms
        assert 0 <= w.covered_ms <= w.to_ms - w.observed_from_ms
        assert w.to_ms - w.from_ms == w.window_ms


def test_gap_count_ignores_gaps_that_end_before_the_bot_was_first_seen(store: Store) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    run(store, CoverageMark("open-covered", T0))
    run(store, CoverageMark("close", T0 + HOUR, "disconnect"))
    run(store, CoverageMark("open-covered", T0 + 2 * HOUR))
    first_seen = T0 + 10 * HOUR
    run(store, BindingSeen(key_of(1), first_seen))
    as_of = T0 + 12 * HOUR
    heartbeat(store, run_id=RUN, now_ms=as_of)
    day = window(attempts(store, 1, as_of), "last24h")
    assert day.observed_from_ms == first_seen
    assert (day.covered_ms, day.gap_count) == (2 * HOUR, 0)


def test_a_bot_first_seen_in_the_future_clamps_observed_from_to_as_of(store: Store) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    run(store, CoverageMark("open-covered", T0), BindingSeen(key_of(1), T0 + HOUR))
    day = window(attempts(store, 1, T0 + 10), "last24h")
    assert (day.observed_from_ms, day.covered_ms) == (T0 + 10, 0)


def test_no_run_means_nothing_was_collected(store: Store) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    run(store, BindingSeen(key_of(1), T0))
    day = window(attempts(store, 1, T0 + HOUR), "last24h")
    assert (day.covered_ms, day.gap_count) == (0, 0)


def test_early_clock_values_keep_from_at_zero(store: Store) -> None:
    covered_feed(store, 1, at=5)
    result = attempts(store, 1, 100)
    day = window(result, "last24h")
    assert (day.from_ms, day.window_ms, day.observed_from_ms) == (0, 100, 5)


def test_an_ended_run_does_not_accrue_after_its_end(store: Store) -> None:
    covered_feed(store, 1)
    end_run(store, run_id=RUN, now_ms=T0 + HOUR, reason="app-disabled")
    day = window(attempts(store, 1, T0 + 5 * HOUR), "last24h")
    assert (day.covered_ms, day.gap_count) == (HOUR, 1)


def test_the_revision_is_read_in_the_same_snapshot(store: Store) -> None:
    covered_feed(store, 1)
    first = attempts(store, 1, T0 + 1).revision
    run(store, worker(store, 1, T0 + 2, "chat-1", 1))
    assert attempts(store, 1, T0 + 3).revision > first


def test_no_cut_is_larger_than_any_time() -> None:
    assert NO_CUT > 2**53
