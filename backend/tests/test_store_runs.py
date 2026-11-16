import sqlite3
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path

import pytest

from backend.specter_arena.store import (
    BindingSeen,
    CoverageMark,
    DmKey,
    IngestBatch,
    IngestItem,
    IngestResult,
    QuarantineIn,
    RosterPoll,
    RosterRowIn,
    Store,
    StoreUsageError,
    UnknownRun,
    end_run,
    heartbeat,
    ingest,
    open_store,
    set_paused,
    start_run,
)
from backend.specter_arena.store.runs import is_paused

ALPHA = DmKey("alpha-0123456789ab", "memory-alpha")
T0 = 1_800_000_000_000
RUN = "run-00000001"
RUN2 = "run-00000002"


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    return tmp_path / "data"


@pytest.fixture
def store(data_dir: Path) -> Iterator[Store]:
    opened = open_store(data_dir)
    try:
        yield opened
    finally:
        opened.close()


def installation(opened: Store) -> str:
    with opened.read() as conn:
        return str(conn.execute("SELECT store_id FROM store_meta").fetchone()[0])


def run(opened: Store, *items: IngestItem, run_id: str = RUN) -> IngestResult:
    return ingest(opened, IngestBatch(run_id, installation(opened), items))


def rows(opened: Store, sql: str, *params: object) -> list[tuple[object, ...]]:
    with opened.read() as conn:
        return [tuple(r) for r in conn.execute(sql, params)]


def intervals(opened: Store, run_id: str = RUN) -> list[tuple[object, ...]]:
    return rows(
        opened,
        "SELECT state, start_ms, end_ms, reason, dropped_json FROM coverage_interval"
        " WHERE run_id = ? ORDER BY interval_id",
        run_id,
    )


def revision(opened: Store) -> int:
    value = rows(opened, "SELECT revision FROM collector_setting")[0][0]
    assert isinstance(value, int)
    return value


def reasons(result: IngestResult) -> list[str]:
    return [r.reason for r in result.rejections]


def mark(action: str, at_ms: int, reason: str | None = None, **fields: object) -> CoverageMark:
    return CoverageMark(action, at_ms, reason, **fields)  # type: ignore[arg-type]


# start_run -----------------------------------------------------------------------------------


def test_a_first_run_has_no_history_and_opens_no_coverage(store: Store) -> None:
    started = start_run(store, run_id=RUN, now_ms=T0)
    assert started.run_id == RUN
    assert started.installation_id == installation(store)
    assert (started.bindings, started.last_turn_gen, started.paused) == ((), None, False)
    assert (started.recovered_runs, started.previous_ended_ms) == (0, None)
    assert intervals(store) == []
    assert rows(store, "SELECT started_ms, last_heartbeat_ms, ended_ms FROM collector_run") == [
        (T0, T0, None)
    ]


@pytest.mark.parametrize("run_id", ["short", "x" * 65, "has space!", "has_underscore", ""])
def test_a_malformed_run_id_is_a_usage_error(store: Store, run_id: str) -> None:
    with pytest.raises(StoreUsageError):
        start_run(store, run_id=run_id, now_ms=T0)


def test_a_reused_run_id_and_a_negative_time_are_usage_errors(store: Store) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    with pytest.raises(StoreUsageError):
        start_run(store, run_id=RUN, now_ms=T0 + 1)
    with pytest.raises(StoreUsageError):
        start_run(store, run_id=RUN2, now_ms=-1)


def test_a_crash_closes_coverage_at_the_last_heartbeat_with_a_restart_gap(store: Store) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    run(store, mark("open-covered", T0 + 1))
    heartbeat(store, run_id=RUN, now_ms=T0 + 10_000)
    heartbeat(store, run_id=RUN, now_ms=T0 + 5_000)
    restarted = start_run(store, run_id=RUN2, now_ms=T0 + 60_000)
    assert restarted.recovered_runs == 1
    assert restarted.previous_ended_ms == T0 + 10_000
    assert intervals(store) == [
        ("covered", T0 + 1, T0 + 10_000, None, None),
        ("gap", T0 + 10_000, T0 + 60_000, "restart", None),
    ]
    assert rows(store, "SELECT ended_ms, end_reason FROM collector_run WHERE run_id = ?", RUN) == [
        (T0 + 10_000, "restart")
    ]
    assert intervals(store, RUN2) == []


def test_a_crash_with_an_open_gap_lets_the_gap_run_until_the_new_run(store: Store) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    run(store, mark("open-covered", T0), mark("close", T0 + 5, "disconnect"))
    start_run(store, run_id=RUN2, now_ms=T0 + 50)
    assert intervals(store) == [
        ("covered", T0, T0 + 5, None, None),
        ("gap", T0 + 5, T0 + 50, "disconnect", None),
    ]


def test_a_clean_end_then_start_closes_the_shutdown_gap_at_the_new_start(store: Store) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    run(store, mark("open-covered", T0))
    end_run(store, run_id=RUN, now_ms=T0 + 100, reason="restart")
    restarted = start_run(store, run_id=RUN2, now_ms=T0 + 400)
    assert (restarted.recovered_runs, restarted.previous_ended_ms) == (0, T0 + 100)
    assert intervals(store) == [
        ("covered", T0, T0 + 100, None, None),
        ("gap", T0 + 100, T0 + 400, "restart", None),
    ]


def test_a_run_that_never_opened_coverage_leaves_unknown_not_a_gap(store: Store) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    restarted = start_run(store, run_id=RUN2, now_ms=T0 + 10)
    assert restarted.recovered_runs == 1
    assert intervals(store) == []


def test_start_run_reports_known_bindings_with_their_newest_turns(store: Store) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    run(store, BindingSeen(ALPHA, T0), BindingSeen(DmKey("beta-0123456789ab", "memory-beta"), T0))
    with store.write() as conn:
        for turn, gen, binding in ((1, "aa", "alpha"), (2, "bb", "alpha"), (None, None, "beta")):
            conn.execute(
                "INSERT INTO observation (binding_id, kind, event_type, source, slot_key, turn,"
                " turn_gen, received_at_ms, origin, contract_version, payload)"
                " SELECT binding_id, 'event', 'chat_status', 'crew-ws', dm_key, ?, ?, 1, 'live',"
                " 1, '{}' FROM bot_binding WHERE member_id LIKE ?",
                (turn, gen, binding + "%"),
            )
    started = start_run(store, run_id=RUN2, now_ms=T0 + 1)
    by_member = {b.member_id: b for b in started.bindings}
    assert (
        by_member["alpha-0123456789ab"].last_turn,
        by_member["alpha-0123456789ab"].last_turn_gen,
    ) == (2, "bb")
    assert (
        by_member["beta-0123456789ab"].last_turn,
        by_member["beta-0123456789ab"].last_turn_gen,
    ) == (None, None)
    assert started.last_turn_gen == "bb"


def test_start_run_moves_the_revision(store: Store) -> None:
    before = revision(store)
    start_run(store, run_id=RUN, now_ms=T0)
    assert revision(store) == before + 1


# heartbeat and end_run -----------------------------------------------------------------------


def test_a_heartbeat_never_moves_backwards_and_needs_a_live_run(store: Store) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    heartbeat(store, run_id=RUN, now_ms=T0 + 9)
    heartbeat(store, run_id=RUN, now_ms=T0 + 3)
    assert rows(store, "SELECT last_heartbeat_ms FROM collector_run") == [(T0 + 9,)]
    with pytest.raises(UnknownRun):
        heartbeat(store, run_id="run-99999999", now_ms=T0)
    end_run(store, run_id=RUN, now_ms=T0 + 20, reason="restart")
    with pytest.raises(UnknownRun):
        heartbeat(store, run_id=RUN, now_ms=T0 + 30)
    with pytest.raises(StoreUsageError):
        heartbeat(store, run_id=RUN, now_ms=-1)


def test_end_run_closes_coverage_and_opens_a_gap_with_the_reason(store: Store) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    run(store, mark("open-covered", T0))
    before = revision(store)
    end_run(store, run_id=RUN, now_ms=T0 + 50, reason="auth-stopped")
    assert intervals(store) == [
        ("covered", T0, T0 + 50, None, None),
        ("gap", T0 + 50, None, "auth-stopped", None),
    ]
    assert rows(store, "SELECT ended_ms, end_reason FROM collector_run") == [
        (T0 + 50, "auth-stopped")
    ]
    assert revision(store) == before + 1


def test_end_run_keeps_an_existing_open_gap(store: Store) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    run(store, mark("open-covered", T0), mark("close", T0 + 5, "disconnect"))
    end_run(store, run_id=RUN, now_ms=T0 + 50, reason="restart")
    assert intervals(store) == [
        ("covered", T0, T0 + 5, None, None),
        ("gap", T0 + 5, None, "disconnect", None),
    ]


def test_end_run_is_idempotent_for_the_same_reason_only(store: Store) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    end_run(store, run_id=RUN, now_ms=T0 + 5, reason="restart")
    before = revision(store)
    end_run(store, run_id=RUN, now_ms=T0 + 9, reason="restart")
    assert revision(store) == before
    with pytest.raises(StoreUsageError):
        end_run(store, run_id=RUN, now_ms=T0 + 9, reason="disconnect")


@pytest.mark.parametrize("reason", ["heartbeat-stale", "nonsense", ""])
def test_end_run_refuses_reasons_outside_the_closed_set(store: Store, reason: str) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    with pytest.raises(StoreUsageError):
        end_run(store, run_id=RUN, now_ms=T0, reason=reason)


def test_end_run_of_an_unknown_run_is_unknown_run(store: Store) -> None:
    with pytest.raises(UnknownRun):
        end_run(store, run_id="run-99999999", now_ms=T0, reason="restart")


# Coverage marks ------------------------------------------------------------------------------


def test_open_covered_is_idempotent_and_closes_a_gap(store: Store) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    first = run(store, mark("open-covered", T0 + 1))
    again = run(store, mark("open-covered", T0 + 2))
    assert first.counts["coverage"].persisted == 1
    assert again.counts["coverage"].deduplicated == 1
    run(store, mark("close", T0 + 10, "disconnect"))
    run(store, mark("open-covered", T0 + 20))
    assert intervals(store) == [
        ("covered", T0 + 1, T0 + 10, None, None),
        ("gap", T0 + 10, T0 + 20, "disconnect", None),
        ("covered", T0 + 20, None, None, None),
    ]


def test_close_without_open_coverage_is_a_no_op(store: Store) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    result = run(store, mark("close", T0, "disconnect"), mark("gap", T0, "overflow"))
    assert result.counts["coverage"].deduplicated == 2
    assert intervals(store) == []


def test_a_gap_splits_coverage_and_keeps_what_was_dropped(store: Store) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    run(store, mark("open-covered", T0))
    gap = mark(
        "gap",
        T0 + 90,
        "overflow",
        from_ms=T0 + 40,
        dropped={"events": 9000},
        source_from_ms=5,
        source_to_ms=9,
    )
    assert run(store, gap).counts["coverage"].persisted == 1
    assert intervals(store) == [
        ("covered", T0, T0 + 40, None, None),
        ("gap", T0 + 40, T0 + 90, "overflow", '{"events":9000}'),
        ("covered", T0 + 90, None, None, None),
    ]
    assert rows(
        store, "SELECT source_from_ms, source_to_ms FROM coverage_interval WHERE state = 'gap'"
    ) == [(5, 9)]


def test_a_zero_length_note_is_a_closed_gap_that_leaves_coverage_open(store: Store) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    run(store, mark("open-covered", T0))
    note = mark("gap", T0 + 7, "unobserved-turns", dropped={"turns": 3})
    run(store, note, mark("gap", T0 + 8, "source-restart"))
    assert intervals(store) == [
        ("covered", T0, None, None, None),
        ("gap", T0 + 7, T0 + 7, "unobserved-turns", '{"turns":3}'),
        ("gap", T0 + 8, T0 + 8, "source-restart", None),
    ]


def test_a_gap_may_not_start_before_the_open_coverage_or_a_close_before_it_opened(
    store: Store,
) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    run(store, mark("open-covered", T0 + 10))
    early = mark("gap", T0 + 20, "overflow", from_ms=T0)
    late_close = mark("close", T0 + 5, "disconnect")
    assert reasons(run(store, early, late_close)) == ["bad-coverage-mark"] * 2
    assert intervals(store) == [("covered", T0 + 10, None, None, None)]


def test_open_covered_before_the_open_gap_started_is_rejected(store: Store) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    run(store, mark("open-covered", T0), mark("close", T0 + 10, "disconnect"))
    assert reasons(run(store, mark("open-covered", T0 + 5))) == ["bad-coverage-mark"]


@pytest.mark.parametrize(
    "item,reason",
    [
        (CoverageMark("sideways", T0), "bad-field"),  # type: ignore[arg-type]
        (CoverageMark("close", -1, "disconnect"), "bad-field"),
        (CoverageMark("close", T0, None), "bad-reason"),
        (CoverageMark("close", T0, "heartbeat-stale"), "bad-reason"),
        (CoverageMark("gap", T0, "made-up"), "bad-reason"),
        (CoverageMark("gap", T0, "overflow", from_ms=T0 + 1), "bad-coverage-mark"),
        (CoverageMark("close", T0, "disconnect", from_ms=T0), "bad-coverage-mark"),
        (CoverageMark("gap", T0, "overflow", from_ms=-1), "bad-coverage-mark"),
        (CoverageMark("gap", T0, "overflow", dropped={"A": 1}), "bad-coverage-mark"),
        (CoverageMark("gap", T0, "overflow", dropped={"a": -1}), "bad-coverage-mark"),
        (CoverageMark("gap", T0, "overflow", dropped={"a": True}), "bad-coverage-mark"),
        (CoverageMark("gap", T0, "overflow", dropped={"a": 2**31 + 1}), "bad-coverage-mark"),
        (
            CoverageMark("gap", T0, "overflow", dropped={f"k{i}": 1 for i in range(9)}),
            "bad-coverage-mark",
        ),
        (CoverageMark("gap", T0, "overflow", source_from_ms=-1), "bad-coverage-mark"),
        (
            CoverageMark("gap", T0, "overflow", source_from_ms=9, source_to_ms=1),
            "bad-coverage-mark",
        ),
    ],
)
def test_malformed_coverage_marks_are_rejected(
    store: Store, item: CoverageMark, reason: str
) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    run(store, mark("open-covered", T0))
    assert reasons(run(store, item)) == [reason]
    assert intervals(store) == [("covered", T0, None, None, None)]


def test_a_gap_may_carry_eight_drop_buckets(store: Store) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    run(store, mark("open-covered", T0))
    dropped = {f"k{i}": i for i in range(8)}
    assert (
        run(store, mark("gap", T0 + 5, "overflow", dropped=dropped)).counts["coverage"].persisted
        == 1
    )


# Run-scoped items ----------------------------------------------------------------------------


def test_items_that_need_a_run_are_rejected_without_a_live_one(store: Store) -> None:
    items = (
        mark("open-covered", T0),
        RosterPoll(True, T0),
        QuarantineIn(T0, "malformed-frame", "x", 1),
    )
    assert reasons(run(store, *items)) == ["unknown-run"] * 3
    start_run(store, run_id=RUN, now_ms=T0)
    end_run(store, run_id=RUN, now_ms=T0 + 1, reason="restart")
    assert reasons(run(store, *items)) == ["unknown-run"] * 3
    assert intervals(store) == [("gap", T0 + 1, None, "restart", None)]


def test_roster_polls_record_their_outcome_on_the_run(store: Store) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    run(store, BindingSeen(ALPHA, T0))
    good = RosterPoll(True, T0 + 1, (RosterRowIn("memory-alpha", "Alpha", None, None, None),))
    assert run(store, good).counts["roster"].persisted == 1
    check = "SELECT roster_checked_ms, roster_ok, roster_reason FROM collector_run"
    assert rows(store, check) == [(T0 + 1, 1, None)]
    before = revision(store)
    assert run(store, replace(good, polled_at_ms=T0 + 2)).counts["roster"].deduplicated == 1
    assert rows(store, check) == [(T0 + 2, 1, None)]
    assert revision(store) == before
    failed = run(store, RosterPoll(False, T0 + 3))
    assert failed.counts["roster"].persisted == 1
    assert rows(store, check) == [(T0 + 3, 0, "roster-unavailable")]
    run(store, RosterPoll(False, T0 + 4, reason="gateway-down"))
    assert rows(store, check) == [(T0 + 4, 0, "gateway-down")]
    assert rows(store, "SELECT state FROM bot_presence") == [("present",)]


def test_a_roster_poll_reason_is_bounded_by_the_column(store: Store) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    ok = run(store, RosterPoll(False, T0, reason="r" * 40))
    long = run(store, RosterPoll(False, T0, reason="r" * 41))
    assert ok.counts["roster"].persisted == 1
    assert reasons(long) == ["bad-field"]


def test_each_run_keeps_its_own_coverage(store: Store) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    start_run(store, run_id=RUN2, now_ms=T0 + 5)
    run(store, mark("open-covered", T0 + 6), run_id=RUN2)
    assert intervals(store, RUN) == []
    assert intervals(store, RUN2) == [("covered", T0 + 6, None, None, None)]
    assert reasons(run(store, mark("open-covered", T0 + 7), run_id=RUN)) == ["unknown-run"]


# Pause ---------------------------------------------------------------------------------------


def test_the_pause_flag_survives_a_restart_and_moves_the_revision_on_change(data_dir: Path) -> None:
    first = open_store(data_dir)
    try:
        assert is_paused(first) is False
        start_run(first, run_id=RUN, now_ms=T0)
        before = revision(first)
        set_paused(first, True, T0 + 1)
        set_paused(first, True, T0 + 2)
        assert revision(first) == before + 1
        assert rows(first, "SELECT paused, changed_at_ms FROM collector_setting") == [(1, T0 + 1)]
    finally:
        first.close()
    second = open_store(data_dir)
    try:
        assert is_paused(second) is True
        assert start_run(second, run_id=RUN2, now_ms=T0 + 9).paused is True
        set_paused(second, False, T0 + 10)
        assert is_paused(second) is False
    finally:
        second.close()


def test_the_pause_flag_does_not_touch_coverage(store: Store) -> None:
    start_run(store, run_id=RUN, now_ms=T0)
    run(store, mark("open-covered", T0))
    set_paused(store, True, T0 + 1)
    assert intervals(store) == [("covered", T0, None, None, None)]


@pytest.mark.parametrize("args", [(1, T0), (True, -1)])
def test_set_paused_validates_its_arguments(store: Store, args: tuple[object, int]) -> None:
    with pytest.raises(StoreUsageError):
        set_paused(store, args[0], args[1])  # type: ignore[arg-type]


# Crash recovery under a real kill ------------------------------------------------------------


def test_coverage_is_never_extended_past_a_heartbeat_across_a_reopen(data_dir: Path) -> None:
    first = open_store(data_dir)
    start_run(first, run_id=RUN, now_ms=T0)
    run(first, mark("open-covered", T0))
    heartbeat(first, run_id=RUN, now_ms=T0 + 10_000)
    first.close()
    second = open_store(data_dir)
    try:
        started = start_run(second, run_id=RUN2, now_ms=T0 + 3_600_000)
        assert started.recovered_runs == 1
        covered = rows(second, "SELECT end_ms FROM coverage_interval WHERE state = 'covered'")
        assert covered == [(T0 + 10_000,)]
        gap = rows(
            second, "SELECT start_ms, end_ms, reason FROM coverage_interval WHERE state = 'gap'"
        )
        assert gap == [(T0 + 10_000, T0 + 3_600_000, "restart")]
    finally:
        second.close()


def test_a_driver_failure_while_ending_a_run_leaves_it_unchanged(
    store: Store, monkeypatch: pytest.MonkeyPatch
) -> None:
    from backend.specter_arena.store import runs

    start_run(store, run_id=RUN, now_ms=T0)
    run(store, mark("open-covered", T0))

    def boom(_conn: sqlite3.Connection) -> None:
        raise sqlite3.OperationalError("disk full")

    monkeypatch.setattr(runs, "bump_revision", boom)
    with pytest.raises(Exception, match="unavailable"):
        end_run(store, run_id=RUN, now_ms=T0 + 5, reason="restart")
    monkeypatch.undo()
    assert intervals(store) == [("covered", T0, None, None, None)]
    assert rows(store, "SELECT ended_ms FROM collector_run") == [(None,)]
