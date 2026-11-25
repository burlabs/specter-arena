"""FP-30 PR 1: the recap read. Which tasks a period holds (FP30-REQ-03, -09), what the collector
covered in it (FP30-REQ-04), and the proof that it reads only and survives a purge."""

import time
from pathlib import Path

import pytest

from backend.specter_arena.store import (
    BindingSeen,
    CoverageMark,
    IngestBatch,
    Store,
    end_run,
    heartbeat,
    ingest,
    open_store,
    start_run,
)
from backend.specter_arena.store import lifecycle as lc
from backend.specter_arena.store import recap as recap_module
from backend.specter_arena.store.errors import StoreUsageError
from backend.specter_arena.store.migrate import load_migrations
from backend.specter_arena.store.recap import (
    RECAP_TASK_CAP,
    Span,
    gap_reason,
    partition_spans,
    recap_tasks,
)
from backend.specter_arena.store.tasks import run_sweep

from .task_fakes import MIN, T0, beat, covered_store, run_worker, worker_row
from .work_fakes import RUN, dm_key_of, installation, send, table_hash

HOUR = 60 * MIN


def spans_of(store: Store, from_ms: int, to_ms: int, as_of_ms: int | None = None) -> list[Span]:
    return recap_tasks(store, from_ms, to_ms, as_of_ms or to_ms).spans


# ---- the pure partition ---------------------------------------------------------------------


def test_with_nothing_known_the_whole_period_is_no_collector() -> None:
    spans = partition_spans(10, 50, first_run_ms=None, horizon_ms=None, covered=[], gaps=[])
    assert spans == [("not-collected", "no-collector", 10, 50)]


def test_spans_partition_the_period_with_no_gap_and_no_overlap() -> None:
    spans = partition_spans(
        0,
        100,
        first_run_ms=10,
        horizon_ms=None,
        covered=[(10, 40), (60, 100)],
        gaps=[(40, 60, "collector-gap")],
    )
    assert spans == [
        ("not-collected", "before-first-run", 0, 10),
        ("covered", "collecting", 10, 40),
        ("not-collected", "collector-gap", 40, 60),
        ("covered", "collecting", 60, 100),
    ]
    assert [s[2] for s in spans[1:]] == [s[3] for s in spans[:-1]]


def test_precedence_is_purged_then_first_run_then_pause_then_gap_then_covered() -> None:
    spans = partition_spans(
        0,
        100,
        first_run_ms=20,
        horizon_ms=10,
        covered=[(0, 100)],
        gaps=[(0, 100, "collector-gap"), (50, 70, "paused")],
    )
    assert spans == [
        ("not-collected", "purged", 0, 10),
        ("not-collected", "before-first-run", 10, 20),
        ("not-collected", "collector-gap", 20, 50),
        ("not-collected", "paused", 50, 70),
        ("not-collected", "collector-gap", 70, 100),
    ]


def test_a_gap_beats_covered_where_they_overlap_and_neighbours_merge() -> None:
    spans = partition_spans(
        0,
        90,
        first_run_ms=None,
        horizon_ms=None,
        covered=[(0, 30), (30, 90)],
        gaps=[(40, 50, "paused"), (45, 60, "paused")],
    )
    assert spans == [
        ("covered", "collecting", 0, 40),
        ("not-collected", "paused", 40, 60),
        ("covered", "collecting", 60, 90),
    ]


def test_intervals_outside_the_period_are_clipped() -> None:
    spans = partition_spans(
        50,
        60,
        first_run_ms=0,
        horizon_ms=None,
        covered=[(0, 55), (58, 200)],
        gaps=[(55, 58, "paused")],
    )
    assert spans == [
        ("covered", "collecting", 50, 55),
        ("not-collected", "paused", 55, 58),
        ("covered", "collecting", 58, 60),
    ]


def test_stored_gap_text_never_reaches_the_wire() -> None:
    assert gap_reason("paused") == "paused"
    for stored in ("restart", "disconnect", "scope-lost-or-silent", None, "free text <b>"):
        assert gap_reason(stored) == "collector-gap"


# ---- which tasks a period holds -------------------------------------------------------------


def test_period_edges_decide_which_tasks_belong(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path, bots=3)
    start, stop = T0 + 10 * MIN, T0 + 30 * MIN
    beat(store, T0 + MIN)
    worker_row(store, 0, 1, T0 + MIN, running=True)  # ends exactly at `start`
    beat(store, T0 + 5 * MIN)
    worker_row(store, 1, 2, T0 + 5 * MIN, running=True)  # still running
    beat(store, start)
    worker_row(store, 0, 1, start, running=False)
    run_worker(store, 2, 3, T0 + 12 * MIN, T0 + 14 * MIN)  # inside
    beat(store, stop)
    worker_row(store, 2, 4, stop, running=True)  # starts exactly at `stop`
    beat(store, stop + MIN)
    got = recap_tasks(store, start, stop, stop + MIN)
    started = [task.started_ms for task in got.tasks]
    assert started == [T0 + 5 * MIN, T0 + 12 * MIN]
    assert [task.state for task in got.tasks] == ["open", "credited"]
    assert not got.truncated and got.omitted == 0
    store.close()


def test_a_task_that_ended_before_the_period_is_not_in_it(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    run_worker(store, 0, 1, T0 + MIN, T0 + 3 * MIN)
    assert recap_tasks(store, T0 + 4 * MIN, T0 + 9 * MIN, T0 + 9 * MIN).tasks == []
    assert len(recap_tasks(store, T0, T0 + 9 * MIN, T0 + 9 * MIN).tasks) == 1
    store.close()


def test_a_task_spanning_the_whole_period_is_in_it(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    run_worker(store, 0, 1, T0 + MIN, T0 + 50 * MIN)
    got = recap_tasks(store, T0 + 10 * MIN, T0 + 20 * MIN, T0 + 20 * MIN)
    assert [task.run_ms for task in got.tasks] == [49 * MIN]
    store.close()


def test_a_task_of_zero_length_on_the_boundary_belongs_to_the_later_period(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    run_worker(store, 0, 1, T0 + 10 * MIN, T0 + 10 * MIN)
    earlier = recap_tasks(store, T0, T0 + 10 * MIN, T0 + 20 * MIN)
    later = recap_tasks(store, T0 + 10 * MIN, T0 + 20 * MIN, T0 + 20 * MIN)
    assert (len(earlier.tasks), len(later.tasks)) == (0, 1)
    store.close()


def test_tasks_are_in_start_order_and_carry_their_recorded_xp(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path, bots=2)
    run_worker(store, 1, 1, T0 + 20 * MIN, T0 + 23 * MIN)
    run_worker(store, 0, 2, T0 + 30 * MIN, T0 + 31 * MIN)
    got = recap_tasks(store, T0, T0 + HOUR, T0 + HOUR)
    assert [t.started_ms for t in got.tasks] == [T0 + 20 * MIN, T0 + 30 * MIN]
    assert [t.xp_credited for t in got.tasks] == [11, 10]
    store.close()


def insert_tasks(store: Store, count: int, binding_id: str, first_ms: int, step_ms: int) -> None:
    rows = [
        (
            f"tsk_{i:024x}",
            f"att_{i:024x}",
            binding_id,
            "worker",
            first_ms + i * step_ms,
            first_ms + i * step_ms + 1000,
            first_ms + i * step_ms + 1000,
            first_ms + i * step_ms + 1000,
        )
        for i in range(count)
    ]
    with store.write() as conn:
        conn.executemany(
            "INSERT INTO task (task_id, attempt_id, binding_id, kind, started_ms, ended_ms,"
            " running, end_signal, state, created_ms, updated_ms)"
            " VALUES (?, ?, ?, ?, ?, ?, 0, 'row-idle', 'open', ?, ?)",
            rows,
        )


def test_the_cap_truncates_and_counts_what_was_left_out(tmp_path: Path) -> None:
    store, bots = covered_store(tmp_path, bots=1)
    insert_tasks(store, RECAP_TASK_CAP + 37, bots[0], T0 + MIN, 2000)
    got = recap_tasks(store, T0, T0 + HOUR * 24, T0 + HOUR * 24)
    assert len(got.tasks) == RECAP_TASK_CAP
    assert got.truncated and got.omitted == 37
    assert got.tasks[0].started_ms == T0 + MIN
    store.close()


def test_exactly_the_cap_is_not_truncated(tmp_path: Path) -> None:
    store, bots = covered_store(tmp_path, bots=1)
    insert_tasks(store, RECAP_TASK_CAP, bots[0], T0 + MIN, 2000)
    got = recap_tasks(store, T0, T0 + HOUR * 24, T0 + HOUR * 24)
    assert len(got.tasks) == RECAP_TASK_CAP and not got.truncated and got.omitted == 0
    store.close()


def test_bad_periods_are_refused(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    periods = ((5, 5, 9), (6, 5, 9), (1, 10, 9), (-1, 5, 9), (1, 5, -1), (1.5, 5, 9))
    for args in periods:
        with pytest.raises(StoreUsageError):
            recap_tasks(store, *args)
    store.close()


# ---- coverage spans -------------------------------------------------------------------------


def test_a_store_with_no_run_is_not_collected(tmp_path: Path) -> None:
    store = open_store(tmp_path / "data")
    got = recap_tasks(store, T0, T0 + HOUR, T0 + HOUR)
    assert got.spans == [("not-collected", "no-collector", T0, T0 + HOUR)]
    assert got.first_run_ms is None and got.purge_horizon_ms is None and got.tasks == []
    store.close()


def test_before_the_first_run_then_covered(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    beat(store, T0 + HOUR)
    got = recap_tasks(store, T0 - HOUR, T0 + HOUR, T0 + HOUR)
    assert got.first_run_ms == T0 - 1
    assert got.spans == [
        ("not-collected", "before-first-run", T0 - HOUR, T0 - 1),
        ("covered", "collecting", T0 - 1, T0 + HOUR),
    ]
    store.close()


def test_a_pause_is_a_paused_span_and_resuming_covers_again(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    beat(store, T0 + 10 * MIN)
    send(store, CoverageMark("close", T0 + 10 * MIN, "paused"))
    beat(store, T0 + 20 * MIN)
    send(store, CoverageMark("open-covered", T0 + 20 * MIN))
    beat(store, T0 + 30 * MIN)
    assert spans_of(store, T0, T0 + 30 * MIN) == [
        ("covered", "collecting", T0, T0 + 10 * MIN),
        ("not-collected", "paused", T0 + 10 * MIN, T0 + 20 * MIN),
        ("covered", "collecting", T0 + 20 * MIN, T0 + 30 * MIN),
    ]
    store.close()


def test_a_gap_with_a_stored_reason_other_than_pause_is_a_collector_gap(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    beat(store, T0 + 10 * MIN)
    send(store, CoverageMark("close", T0 + 10 * MIN, "disconnect"))
    beat(store, T0 + 15 * MIN)
    send(store, CoverageMark("open-covered", T0 + 15 * MIN))
    beat(store, T0 + 20 * MIN)
    assert ("not-collected", "collector-gap", T0 + 10 * MIN, T0 + 15 * MIN) in spans_of(
        store, T0, T0 + 20 * MIN
    )
    store.close()


def test_a_restart_gap_spans_the_silence_between_two_runs(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    beat(store, T0 + 10 * MIN)
    start_run(store, run_id="run-00000002", now_ms=T0 + 25 * MIN)
    second = IngestBatch(
        "run-00000002", installation(store), (CoverageMark("open-covered", T0 + 25 * MIN),)
    )
    ingest(store, second)
    heartbeat(store, run_id="run-00000002", now_ms=T0 + 40 * MIN)
    assert spans_of(store, T0, T0 + 40 * MIN) == [
        ("covered", "collecting", T0, T0 + 10 * MIN),
        ("not-collected", "collector-gap", T0 + 10 * MIN, T0 + 25 * MIN),
        ("covered", "collecting", T0 + 25 * MIN, T0 + 40 * MIN),
    ]
    store.close()


def test_an_open_interval_with_a_stale_heartbeat_stops_at_the_heartbeat(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    beat(store, T0 + 10 * MIN)
    assert spans_of(store, T0, T0 + HOUR) == [
        ("covered", "collecting", T0, T0 + 10 * MIN),
        ("not-collected", "no-collector", T0 + 10 * MIN, T0 + HOUR),
    ]
    store.close()


def test_a_run_that_ended_leaves_the_rest_not_collected(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    beat(store, T0 + 10 * MIN)
    end_run(store, run_id=RUN, now_ms=T0 + 10 * MIN, reason="app-disabled")
    spans = spans_of(store, T0, T0 + HOUR)
    assert spans[0] == ("covered", "collecting", T0, T0 + 10 * MIN)
    assert spans[1][:2] == ("not-collected", "collector-gap")
    store.close()


def test_spans_always_tile_the_period(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    beat(store, T0 + 10 * MIN)
    send(store, CoverageMark("close", T0 + 10 * MIN, "paused"))
    send(store, CoverageMark("open-covered", T0 + 20 * MIN))
    beat(store, T0 + 25 * MIN)
    spans = spans_of(store, T0 - 5 * MIN, T0 + HOUR)
    assert spans[0][2] == T0 - 5 * MIN and spans[-1][3] == T0 + HOUR
    assert all(a[3] == b[2] for a, b in zip(spans, spans[1:], strict=False))
    assert all(a[:2] != b[:2] for a, b in zip(spans, spans[1:], strict=False))
    store.close()


# ---- purge, migration, reads only -----------------------------------------------------------


def test_a_purge_leaves_the_tasks_and_marks_the_old_history_purged(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    run_worker(store, 0, 1, T0 + 10, T0 + 3 * MIN)
    run_worker(store, 0, 2, T0 + 5 * MIN, T0 + 6 * MIN)
    before = recap_tasks(store, T0, T0 + HOUR, T0 + HOUR)
    cutoff = T0 + 10 * MIN
    record = lc.run_purge(store, cutoff, lambda: cutoff)
    assert record.attempts == 2
    after = recap_tasks(store, T0, T0 + HOUR, T0 + HOUR)
    assert after.tasks == before.tasks and len(after.tasks) == 2
    assert after.purge_horizon_ms == cutoff
    assert after.spans[0] == ("not-collected", "purged", T0, cutoff)
    store.close()


def test_a_task_backfilled_from_a_migrated_store_is_in_the_recap(tmp_path: Path) -> None:
    data = tmp_path / "data"
    old = open_store(data, migrations=load_migrations()[:9])
    start_run(old, run_id=RUN, now_ms=T0 - 1)
    send(old, BindingSeen(dm_key_of(0), T0), CoverageMark("open-covered", T0 - 1))
    run_worker(old, 0, 1, T0 + MIN, T0 + 4 * MIN)
    old.close()
    migrated = open_store(data)
    try:
        assert recap_tasks(migrated, T0, T0 + HOUR, T0 + HOUR).tasks == []
        assert run_sweep(migrated, T0 + HOUR) == 1
        got = recap_tasks(migrated, T0, T0 + HOUR, T0 + HOUR)
        assert [(t.started_ms, t.state) for t in got.tasks] == [(T0 + MIN, "credited")]
    finally:
        migrated.close()


def test_a_recap_writes_nothing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store, _ = covered_store(tmp_path)
    run_worker(store, 0, 1, T0 + MIN, T0 + 4 * MIN)
    tables = ("task", "task_xp_entry", "coverage_interval", "collector_run", "observation")
    before = {name: table_hash(store, name) for name in tables}

    def no_write() -> None:
        raise AssertionError("a recap must not open a write transaction")

    monkeypatch.setattr(store, "write", no_write)
    recap_tasks(store, T0, T0 + HOUR, T0 + HOUR)
    monkeypatch.undo()
    assert {name: table_hash(store, name) for name in tables} == before
    store.close()


def test_every_reader_statement_is_a_select(tmp_path: Path) -> None:
    for sql in (recap_module._TASKS_SQL, recap_module._COUNT_SQL, recap_module._INTERVALS):
        assert sql.lstrip().upper().startswith("SELECT")


# ---- timing (NFR-1) -------------------------------------------------------------------------


def test_a_recap_over_twenty_thousand_tasks_reads_in_under_150_ms(tmp_path: Path) -> None:
    store, bots = covered_store(tmp_path, bots=1)
    insert_tasks(store, 20_000, bots[0], T0 + MIN, 3000)
    window = (T0, T0 + 8 * 24 * HOUR)
    timings = []
    for _ in range(5):
        began = time.perf_counter()
        got = recap_tasks(store, *window, window[1])
        timings.append((time.perf_counter() - began) * 1000)
    best = min(timings)
    print(
        f"RECAP-TIMING rows=20000 returned={len(got.tasks)} omitted={got.omitted}"
        f" best_ms={best:.1f} all_ms={[round(t, 1) for t in timings]}"
    )
    assert len(got.tasks) == RECAP_TASK_CAP and got.omitted == 19_000
    assert best < 150
    store.close()
