"""FP-22 automatic tasks: creation from attempts, the close-out rule, credit once, reopen,
backfill, idempotence, the 60 s bot-turn threshold and the guards that keep app-internal slots
out. The rules are PA-3 items 2 to 4; the bounty is `xp-policy-2`."""

import logging
import sqlite3
from pathlib import Path
from typing import Any

import pytest

from backend.specter_arena.store import (
    BindingSeen,
    CoverageMark,
    encode_cursor,
    open_store,
    rebuild_projection,
    set_paused,
    start_run,
)
from backend.specter_arena.store import tasks as task_module
from backend.specter_arena.store.migrate import load_migrations
from backend.specter_arena.store.tasks import (
    close_reason_for,
    entry_id_for,
    get_task,
    run_sweep,
    task_id_for,
    task_page,
)
from backend.specter_arena.store.xp_policy import size_class, task_bounty

from .task_fakes import (
    MIN,
    RUN,
    T0,
    award_total,
    beat,
    bot_turn_rows,
    covered_store,
    run_worker,
    tasks,
    worker_row,
)
from .work_fakes import dm_key_of, query, send, table_hash

PACKAGED = load_migrations()
START = T0 + 10


def only(store: Any) -> tuple[Any, ...]:
    found = tasks(store)
    assert len(found) == 1, found
    return found[0]


def hashes(store: Any) -> tuple[str, str]:
    return table_hash(store, "task"), table_hash(store, "task_xp_entry")


def page(store: Any, as_of: int, **kwargs: Any) -> Any:
    args: dict[str, Any] = {"state": None, "binding_id": None, "cursor": None, "limit": None}
    args.update(kwargs)
    return task_page(store, as_of_ms=as_of, **args)


# ---- policy ---------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("run_ms", "xp"),
    [
        (0, 10),
        (119_999, 10),
        (120_000, 11),
        (239_999, 11),
        (600_000, 15),
        (2_399_999, 29),
        (2_400_000, 30),
        (10**12, 30),
    ],
)
def test_the_bounty_is_ten_plus_one_per_full_two_minutes_capped_at_thirty(
    run_ms: int, xp: int
) -> None:
    assert task_bounty(run_ms) == xp


@pytest.mark.parametrize("bad", [-1, True, 1.5, "1"])
def test_the_bounty_refuses_a_bad_run_time(bad: Any) -> None:
    with pytest.raises(Exception, match="run time"):
        task_bounty(bad)


@pytest.mark.parametrize(
    ("run_ms", "label"),
    [
        (0, "small"),
        (119_999, "small"),
        (120_000, "medium"),
        (899_999, "medium"),
        (900_000, "large"),
        (10**9, "large"),
    ],
)
def test_the_size_class_thresholds(run_ms: int, label: str) -> None:
    assert size_class(run_ms) == label


def test_task_and_entry_ids_are_hashes_of_the_attempt_and_stable() -> None:
    attempt = "att_" + "a" * 24
    assert task_id_for(attempt) == task_id_for(attempt)
    assert task_id_for(attempt).startswith("tsk_") and len(task_id_for(attempt)) == 28
    assert task_id_for(attempt) != task_id_for("att_" + "b" * 24)
    assert entry_id_for(task_id_for(attempt)).startswith("txe_")


def test_the_close_out_rule_orders_its_reasons() -> None:
    assert close_reason_for("worker", "row-idle", False, False) == "clean-end"
    assert close_reason_for("bot-turn", "chat_done", False, False) == "clean-end"
    assert close_reason_for("worker", "chat_done", False, False) == "unknown-terminal"
    assert close_reason_for("worker", None, False, False) == "unknown-terminal"
    assert close_reason_for("worker", "row-idle", None, False) == "unknown-terminal"
    assert close_reason_for("worker", "row-idle", False, True) == "coverage-gap"
    assert close_reason_for("worker", "row-idle", True, False) == "waiting-at-end"
    assert close_reason_for("worker", "row-idle", True, True) == "coverage-gap"
    assert close_reason_for("worker", "other", True, True) == "unknown-terminal"


# ---- creation and close-out -----------------------------------------------------------------


def test_a_worker_that_ends_cleanly_becomes_a_credited_task_with_one_award(tmp_path: Path) -> None:
    store, bots = covered_store(tmp_path)
    run_worker(store, 0, 1, START, START + 30_000)
    task_id, kind, state, reason, running, started, ended, closed, amount = only(store)
    assert (kind, state, reason, running) == ("worker", "credited", "clean-end", 0)
    assert (started, ended, closed, amount) == (START, START + 30_000, START + 30_000, 10)
    award = query(store, "SELECT task_id, binding_id, amount, policy_version FROM task_xp_entry")
    assert award == [(task_id, bots[0], 10, "xp-policy-2")]
    assert query(store, "SELECT count(*) FROM xp_entry") == [(0,)]


def test_a_six_minute_worker_earns_thirteen(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    run_worker(store, 0, 1, START, START + 6 * MIN)
    assert only(store)[8] == 13


def test_a_ninety_minute_worker_is_capped_at_thirty(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    run_worker(store, 0, 1, START, START + 90 * MIN)
    assert only(store)[8] == 30


def test_a_running_worker_is_an_open_task_with_no_award(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    beat(store, START)
    worker_row(store, 0, 1, START, running=True)
    task_id, _, state, reason, running, _, ended, closed, amount = only(store)
    assert (state, reason, running, ended, closed, amount) == ("open", None, 1, None, None, None)
    assert award_total(store) == 0
    assert task_id == task_id_for(str(query(store, "SELECT attempt_id FROM attempt")[0][0]))


@pytest.mark.parametrize("flag", ["pendingApproval", "needsInput", "waitingForInput"])
def test_a_task_ending_with_an_approval_or_question_pending_is_not_credited(
    tmp_path: Path, flag: str
) -> None:
    store, _ = covered_store(tmp_path)
    run_worker(store, 0, 1, START, START + 30_000, **{flag: True})
    row = only(store)
    assert (row[2], row[3], row[7], row[8]) == (
        "not-credited",
        "waiting-at-end",
        START + 30_000,
        None,
    )
    assert award_total(store) == 0


def test_a_flag_set_earlier_but_clear_at_the_end_does_not_block_credit(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    beat(store, START)
    worker_row(store, 0, 1, START, running=True, pendingApproval=True)
    worker_row(store, 0, 1, START + 10, running=True)
    beat(store, START + 20)
    worker_row(store, 0, 1, START + 20, running=False)
    assert only(store)[2:4] == ("credited", "clean-end")


def test_a_gap_over_the_attempt_means_not_credited(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    beat(store, START)
    worker_row(store, 0, 1, START, running=True)
    send(store, CoverageMark("close", START + 10, "disconnect"))
    send(store, CoverageMark("open-covered", START + 20))
    beat(store, START + 30)
    worker_row(store, 0, 1, START + 30, running=False)
    assert only(store)[2:4] == ("not-credited", "coverage-gap")
    assert award_total(store) == 0


def test_an_attempt_the_collector_never_covered_is_not_credited(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path, covered=False)
    run_worker(store, 0, 1, START, START + 30)
    assert only(store)[2:4] == ("not-credited", "coverage-gap")


def test_a_gap_that_ends_before_the_attempt_starts_does_not_matter(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path, covered=False)
    send(store, CoverageMark("open-covered", T0 - 1))
    send(store, CoverageMark("close", T0 + 1, "disconnect"))
    send(store, CoverageMark("open-covered", T0 + 5))
    run_worker(store, 0, 1, START, START + 30)
    assert only(store)[2:4] == ("credited", "clean-end")


def test_an_unknown_terminal_state_is_not_credited(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    set_paused(store, True, T0)
    run_worker(store, 0, 1, START, START + 30)
    assert tasks(store) == []
    with store.write() as conn:
        conn.execute("UPDATE attempt SET end_signal = 'mystery'")
    set_paused(store, False, T0 + 1)
    assert run_sweep(store, START + 40) == 1
    assert only(store)[2:4] == ("not-credited", "unknown-terminal")


def test_an_ended_attempt_whose_closing_row_is_gone_is_unknown_terminal(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    set_paused(store, True, T0)
    bot_turn_rows(store, 1, 1, START - 5, START - 4)  # observation 1 belongs to another slot
    run_worker(store, 0, 1, START, START + 30)
    with store.write() as conn:
        conn.execute("UPDATE attempt SET ended_seq = 1 WHERE kind = 'worker'")
    set_paused(store, False, T0 + 1)
    run_sweep(store, START + 40)
    assert only(store)[2:4] == ("not-credited", "unknown-terminal")


# ---- bot turns ------------------------------------------------------------------------------


def test_a_bot_turn_under_sixty_seconds_is_not_a_task(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    bot_turn_rows(store, 0, 1, START, START + 59_999)
    assert tasks(store) == []
    assert len(query(store, "SELECT 1 FROM attempt WHERE kind = 'bot-turn'")) == 1


def test_a_bot_turn_of_exactly_sixty_seconds_is_a_credited_task(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    bot_turn_rows(store, 0, 1, START, START + 60_000)
    row = only(store)
    assert row[1:4] == ("bot-turn", "credited", "clean-end") and row[8] == 10


def test_a_bot_turn_closed_by_chat_done_is_credited(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    bot_turn_rows(store, 0, 1, START, START + 3 * MIN, end="chat-done")
    row = only(store)
    assert row[2:4] == ("credited", "clean-end") and row[8] == 11


def test_a_running_bot_turn_becomes_an_open_task_once_it_passes_sixty_seconds(
    tmp_path: Path,
) -> None:
    store, _ = covered_store(tmp_path)
    bot_turn_rows(store, 0, 1, START, None)
    assert tasks(store) == []
    beat(store, START + 59_999)
    assert tasks(store) == []
    beat(store, START + 60_000)
    assert only(store)[1:3] == ("bot-turn", "open")


def test_a_bot_turn_ending_with_a_question_pending_is_not_credited(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    bot_turn_rows(store, 0, 1, START, START + 2 * MIN, needsInput=True)
    assert only(store)[2:4] == ("not-credited", "waiting-at-end")


# ---- credit once, reopen --------------------------------------------------------------------


def test_a_credited_task_whose_worker_runs_again_earns_nothing_more(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    run_worker(store, 0, 1, START, START + 30_000)
    first = only(store)
    assert first[2] == "credited"
    beat(store, START + 40_000)
    worker_row(store, 0, 1, START + 40_000, running=True)
    again = only(store)
    assert again[2:4] == ("credited", "clean-end") and again[4] == 1 and again[6] is None
    assert again[7] == first[7]
    beat(store, START + 6 * MIN)
    worker_row(store, 0, 1, START + 6 * MIN, running=False)
    last = only(store)
    assert last[2:4] == ("credited", "clean-end") and last[4] == 0
    assert last[6] == START + 6 * MIN and last[7] == first[7] and last[8] == 10
    assert award_total(store) == 10
    assert query(store, "SELECT count(*) FROM task_xp_entry") == [(1,)]


def test_a_not_credited_task_is_judged_again_and_credited_once_at_its_next_end(
    tmp_path: Path,
) -> None:
    store, _ = covered_store(tmp_path)
    run_worker(store, 0, 1, START, START + 30_000, pendingApproval=True)
    assert only(store)[2:4] == ("not-credited", "waiting-at-end")
    beat(store, START + 40_000)
    worker_row(store, 0, 1, START + 40_000, running=True)
    assert only(store)[2:4] == ("open", None)
    beat(store, START + 5 * MIN)
    worker_row(store, 0, 1, START + 5 * MIN, running=False)
    row = only(store)
    assert row[2:4] == ("credited", "clean-end") and row[8] == 12
    assert row[7] == START + 5 * MIN
    assert award_total(store) == 12


def test_a_not_credited_task_that_ends_again_between_sweeps_is_still_judged(
    tmp_path: Path,
) -> None:
    store, _ = covered_store(tmp_path)
    run_worker(store, 0, 1, START, START + 30_000, pendingApproval=True)
    set_paused(store, True, START + 31_000)
    worker_row(store, 0, 1, START + 40_000, running=True)
    beat(store, START + 50_000)
    worker_row(store, 0, 1, START + 50_000, running=False)
    set_paused(store, False, START + 51_000)
    run_sweep(store, START + 52_000)
    assert only(store)[2:4] == ("credited", "clean-end")


def test_each_task_is_credited_to_its_own_bot(tmp_path: Path) -> None:
    store, bots = covered_store(tmp_path)
    run_worker(store, 0, 1, START, START + 1000)
    run_worker(store, 0, 2, START + 2000, START + 3000)
    run_worker(store, 1, 3, START + 4000, START + 5000)
    assert len(tasks(store)) == 3
    by_bot = query(
        store,
        "SELECT binding_id, count(*), sum(amount) FROM task_xp_entry GROUP BY binding_id"
        " ORDER BY binding_id",
    )
    assert by_bot == sorted([(bots[0], 2, 20), (bots[1], 1, 10)])


# ---- sweep behaviour ------------------------------------------------------------------------


def test_a_second_sweep_writes_nothing(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    run_worker(store, 0, 1, START, START + 30_000)
    before = hashes(store)
    assert run_sweep(store, START + 90_000) == 0
    assert hashes(store) == before


def test_the_sweep_does_nothing_while_the_collector_is_paused(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    set_paused(store, True, T0)
    run_worker(store, 0, 1, START, START + 30_000)
    assert run_sweep(store, START + 40_000) == 0
    assert tasks(store) == []
    set_paused(store, False, T0 + 1)
    assert run_sweep(store, START + 40_000) == 1
    assert only(store)[2] == "credited"


def test_rebuilding_the_projection_changes_no_task_and_no_award(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    run_worker(store, 0, 1, START, START + 30_000)
    run_worker(store, 0, 2, START + 40_000, START + 50_000, pendingApproval=True)
    bot_turn_rows(store, 1, 1, START, START + 2 * MIN)
    before = hashes(store)
    rebuild_projection(store, as_of_ms=START + 10 * MIN)
    assert run_sweep(store, START + 10 * MIN) == 0
    assert hashes(store) == before
    assert len(tasks(store)) == 3


def test_tasks_and_awards_survive_the_loss_of_their_attempts(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    run_worker(store, 0, 1, START, START + 30_000)
    before = hashes(store)
    with store.write() as conn:
        conn.execute("DELETE FROM attempt")
    assert run_sweep(store, START + 90_000) == 0
    assert hashes(store) == before
    assert [v.state for v in page(store, START + 90_000).items] == ["credited"]


def test_the_first_sweep_backfills_retained_attempts_with_the_same_rule(tmp_path: Path) -> None:
    data = tmp_path / "data"
    old = open_store(data, migrations=PACKAGED[:9])
    start_run(old, run_id=RUN, now_ms=T0 - 1)
    send(old, BindingSeen(dm_key_of(0), T0), CoverageMark("open-covered", T0 - 1))
    run_worker(old, 0, 1, START, START + 3 * MIN)
    run_worker(old, 0, 2, START + 4 * MIN, START + 5 * MIN, needsInput=True)
    bot_turn_rows(old, 0, 1, START + 6 * MIN, START + 6 * MIN + 10)
    assert len(query(old, "SELECT 1 FROM attempt")) == 3
    old.close()
    migrated = open_store(data)
    try:
        assert query(migrated, "SELECT count(*) FROM task") == [(0,)]
        assert run_sweep(migrated, START + 7 * MIN) == 2
        got = tasks(migrated)
        assert [(r[1], r[2], r[3], r[8]) for r in got] == [
            ("worker", "credited", "clean-end", 11),
            ("worker", "not-credited", "waiting-at-end", None),
        ]
        assert [r[7] for r in got] == [START + 3 * MIN, START + 5 * MIN]
        assert run_sweep(migrated, START + 8 * MIN) == 0
    finally:
        migrated.close()


# ---- what never becomes a task --------------------------------------------------------------


def test_slots_that_are_not_a_bots_own_turn_or_a_worker_never_become_tasks(tmp_path: Path) -> None:
    store, bots = covered_store(tmp_path)
    dm = str(query(store, "SELECT dm_key FROM bot_binding ORDER BY binding_seq")[0][0])
    rows = [
        ("att_" + "1" * 24, "bot-turn", "chat-9-1"),
        ("att_" + "2" * 24, "worker", dm),
        ("att_" + "3" * 24, "summoning", "chat-9-2"),
        ("att_" + "4" * 24, "chat", dm),
    ]
    with store.write() as conn:
        for number, (attempt_id, kind, slot) in enumerate(rows, start=1):
            conn.execute(
                "INSERT INTO attempt (attempt_id, binding_id, kind, slot_key, started_ms,"
                " started_seq, ended_ms, ended_seq, end_signal, running)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'row-idle', 0)",
                (attempt_id, bots[0], kind, slot, START, number, START + 5 * MIN, number),
            )
    assert run_sweep(store, START + 6 * MIN) == 0
    assert tasks(store) == []


# ---- clock-dependent reads ------------------------------------------------------------------


def test_a_running_task_grows_with_the_clock_and_never_shrinks(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    beat(store, START)
    worker_row(store, 0, 1, START, running=True)
    seen = []
    for at in (START + 1, START + 119_999, START + 120_000, START + 899_999, START + 900_000):
        view = page(store, at, state="open").items[0]
        seen.append((view.run_ms, view.size_class))
    assert seen == [
        (1, "small"),
        (119_999, "small"),
        (120_000, "medium"),
        (899_999, "medium"),
        (900_000, "large"),
    ]
    assert only(store)[6] is None


def test_an_ended_task_has_a_fixed_run_time_whatever_the_clock(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    run_worker(store, 0, 1, START, START + 3 * MIN)
    for at in (START + 4 * MIN, START + 100 * MIN):
        view = page(store, at).items[0]
        assert (view.run_ms, view.size_class, view.attempt_state) == (3 * MIN, "medium", "ended")
        assert view.xp_credited == 11 and view.closed_ms == START + 3 * MIN


def test_a_task_running_with_a_stale_feed_is_open_with_attempt_state_unknown(
    tmp_path: Path,
) -> None:
    store, _ = covered_store(tmp_path)
    beat(store, START)
    worker_row(store, 0, 1, START, running=True)
    fresh = page(store, START + 1000).items[0]
    stale = page(store, START + 5 * MIN).items[0]
    assert (fresh.state, fresh.attempt_state) == ("open", "working")
    assert (stale.state, stale.attempt_state) == ("open", "unknown")


def test_paging_orders_by_update_time_then_id_and_filters(tmp_path: Path) -> None:
    store, bots = covered_store(tmp_path)
    for number in range(1, 31):
        run_worker(store, number % 2, number, START + number * 100, START + number * 100 + 10)
    first = page(store, T0 + MIN)
    assert len(first.items) == 25 and first.next_cursor is not None
    second = page(store, T0 + MIN, cursor=first.next_cursor)
    assert len(second.items) == 5 and second.next_cursor is None
    every = [*first.items, *second.items]
    assert [v.updated_ms for v in every] == sorted((v.updated_ms for v in every), reverse=True)
    assert len({v.task_id for v in every}) == 30
    mine = page(store, T0 + MIN, state="credited", binding_id=bots[0], limit=100)
    assert len(mine.items) == 15 and {v.binding_id for v in mine.items} == {bots[0]}
    assert page(store, T0 + MIN, state="open").items == ()


def test_get_task_and_its_errors(tmp_path: Path) -> None:
    store, _ = covered_store(tmp_path)
    run_worker(store, 0, 1, START, START + 10)
    task_id = str(only(store)[0])
    assert get_task(store, task_id, as_of_ms=T0 + MIN).task_id == task_id
    for bad in ("tsk_" + "0" * 24, "nope", "tsk_" + "A" * 24):
        with pytest.raises(Exception, match="unknown-task"):
            get_task(store, bad, as_of_ms=T0 + MIN)
    with pytest.raises(Exception, match="as_of_ms"):
        get_task(store, task_id, as_of_ms=0)
    with pytest.raises(Exception, match="state"):
        page(store, 1, state="done")
    with pytest.raises(Exception, match="as_of_ms"):
        page(store, 0)
    with pytest.raises(Exception, match="cursor"):
        page(store, 1, cursor="zzz")
    for forged in (encode_cursor([-1, "tsk_" + "a" * 24]), encode_cursor([1, "nope"])):
        with pytest.raises(Exception, match="cursor"):
            page(store, 1, cursor=forged)


# ---- failure isolation ----------------------------------------------------------------------


def test_a_failing_sweep_loses_neither_the_batch_nor_the_heartbeat(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    store, _ = covered_store(tmp_path)

    def broken(conn: sqlite3.Connection, now_ms: int) -> int:
        conn.execute("UPDATE collector_setting SET revision = revision + 100")
        raise sqlite3.OperationalError("disk is on fire")

    monkeypatch.setattr(task_module, "sweep_tasks", broken)
    revision = query(store, "SELECT revision FROM collector_setting")[0][0]
    with caplog.at_level(logging.WARNING, logger="specter_arena.store.tasks"):
        worker_row(store, 0, 1, START, running=True)
        beat(store, START + 5)
    assert len(query(store, "SELECT 1 FROM observation WHERE slot_key LIKE 'chat-%'")) == 1
    assert len(query(store, "SELECT 1 FROM attempt")) == 1
    after = query(store, "SELECT revision FROM collector_setting")[0][0]
    assert 0 < after - revision < 100
    assert "OperationalError" in caplog.text and "disk is on fire" not in caplog.text
