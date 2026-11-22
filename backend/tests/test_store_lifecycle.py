"""FP-19 work-ledger: migration 0009, the SQL delete guards, retention, purge, the purge horizon,
export, the startup sweep and asset cleanup against the real store. Test-time only."""

from __future__ import annotations

import importlib
import os
import re
import sqlite3
import time
from pathlib import Path
from typing import Any, Literal

import pytest

from backend.specter_arena.store import (
    BackupError,
    CoverageMark,
    LifecycleBusy,
    StoreStatus,
    StoreUsageError,
    UploadLimitReached,
    attempts_page,
    cutoff_for,
    export_database,
    get_retention,
    heartbeat,
    insert_asset,
    list_exports,
    open_store,
    pre_lifecycle_backup,
    purge_preview,
    read_horizon,
    read_runs,
    rebuild_projection,
    run_asset_cleanup,
    run_purge,
    set_avatar,
    set_retention,
    unused_upload_count,
)
from backend.specter_arena.store import lifecycle as lc
from backend.specter_arena.store.backup import prune_pre_lifecycle
from backend.specter_arena.store.housekeeping import (
    close_interrupted_runs,
    is_orphan_name,
    sweep_temp_files,
)
from backend.specter_arena.store.migrate import load_migrations, validate

from .lifecycle_fakes import CUT, DAY_MS, NEW, NOW_FOR_30_DAYS, OLD, attempt_ids, build
from .png_support import png
from .work_fakes import RUN, T0, installation, query, send

PACKAGED = load_migrations()
CLOCK_AT_CUT = lambda: NOW_FOR_30_DAYS  # noqa: E731 - a fixed clock


def counts(store: Any) -> dict[str, int]:
    names = ("observation", "quarantine", "attempt", "asset", "work_item", "xp_entry")
    return {n: int(query(store, f"SELECT count(*) FROM {n}")[0][0]) for n in names}


def refuses(store: Any, sql: str, *params: object) -> None:
    with pytest.raises(sqlite3.DatabaseError), store.write() as conn:
        conn.execute(sql, params)


# ---- migration 0009 (FP19-WL-01) -------------------------------------------------------------


def test_migration_nine_is_the_data_lifecycle_migration() -> None:
    assert len(PACKAGED) >= 9
    assert PACKAGED[8].name == "data_lifecycle"
    assert validate(PACKAGED[8])


def test_a_v8_store_migrates_to_v9_with_one_pre_migrate_backup(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    old = open_store(data_dir, migrations=PACKAGED[:8])
    try:
        assert old.status() == StoreStatus("ready", 8, 8)
    finally:
        old.close()
    conn = sqlite3.connect(data_dir / "store" / "specter-arena.db")
    before = {
        name: sorted(map(tuple, conn.execute(f"SELECT * FROM {name}")))
        for (name,) in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
            " AND name <> 'schema_migrations'"
        ).fetchall()
    }
    conn.close()
    opened = open_store(data_dir, migrations=PACKAGED[:9])
    try:
        assert opened.status() == StoreStatus("ready", 9, 9)
        with opened.read() as live:
            assert live.execute("PRAGMA integrity_check").fetchone() == ("ok",)
            assert live.execute("PRAGMA foreign_key_check").fetchall() == []
            for name, rows in before.items():
                assert sorted(map(tuple, live.execute(f"SELECT * FROM {name}"))) == rows
            assert live.execute(
                "SELECT retention_days, changed_at_ms, revision FROM retention_setting"
            ).fetchone() == (None, None, 0)
            assert live.execute("SELECT count(*) FROM lifecycle_run").fetchone() == (0,)
    finally:
        opened.close()
    backups = list((data_dir / "store" / "backups").glob("pre-migrate-v8-to-v9-*.db"))
    assert len(backups) == 1
    older = sqlite3.connect(backups[0])
    try:
        assert older.execute("PRAGMA user_version").fetchone() == (8,)
        assert older.execute(
            "SELECT count(*) FROM sqlite_master WHERE name = 'lifecycle_run'"
        ).fetchone() == (0,)
    finally:
        older.close()


# ---- the SQL guards (FP19-WL-05) -------------------------------------------------------------


def test_nothing_deletes_outside_a_running_lifecycle_run(tmp_path: Path) -> None:
    seeded = build(tmp_path)
    store = seeded.store
    origins: tuple[tuple[Literal["bundled", "uploaded"], int], ...] = (
        ("bundled", 2),
        ("uploaded", 3),
    )
    for origin, side in origins:
        insert_asset(
            store,
            data=png(side, side),
            width=side,
            height=side,
            origin=origin,
            label="a",
            now_ms=OLD,
        )
    lc.end_run(store, lc.begin_run(store, "purge", 0, 1), "completed", 2)  # a row to protect
    before = counts(store)
    refuses(store, "DELETE FROM observation")
    refuses(store, "DELETE FROM observation WHERE received_at_ms < 9000000000000")
    refuses(store, "DELETE FROM quarantine")
    refuses(store, "DELETE FROM asset")
    refuses(store, "DELETE FROM lifecycle_run")
    refuses(store, "DELETE FROM retention_setting")
    assert counts(store) == before


@pytest.mark.parametrize(
    "table",
    [
        "bot_binding",
        "bot_display_revision",
        "bot_presence",
        "binding_rebind",
        "hero_assignment",
        "avatar_revision",
        "work_item",
        "work_attempt",
        "work_milestone",
        "work_decision",
        "xp_entry",
    ],
)
def test_a_running_purge_still_cannot_delete_identity_heroes_work_or_xp(
    tmp_path: Path, table: str
) -> None:
    seeded = build(tmp_path)
    store = seeded.store
    insert_asset(store, data=png(2, 2), width=2, height=2, origin="uploaded", label="a", now_ms=OLD)
    lc.begin_run(store, "purge", 9_000_000_000_000, 1)
    trigger = query(
        store,
        "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?"
        " AND sql LIKE '%BEFORE DELETE%'",
        table,
    )
    assert len(trigger) == 1 and "RAISE(ABORT" in trigger[0][0] and " WHEN " not in trigger[0][0]
    rows = query(store, f"SELECT count(*) FROM {table}")[0][0]
    if rows:
        refuses(store, f"DELETE FROM {table}")
        assert query(store, f"SELECT count(*) FROM {table}")[0][0] == rows
    refuses(store, "DELETE FROM asset")  # a purge run does not open the asset guard


def test_every_other_delete_guard_is_byte_for_byte_what_it_was_at_v8(tmp_path: Path) -> None:
    """Migration 0009 replaces three guards; no other trigger and no table definition changes."""
    old = open_store(tmp_path / "old", migrations=PACKAGED[:8])
    new = open_store(tmp_path / "new", migrations=PACKAGED[:9])
    try:
        sql = "SELECT name, sql FROM sqlite_master WHERE type IN ('trigger', 'table') ORDER BY name"
        before = {name: text for name, text in query(old, sql)}
        after = {name: text for name, text in query(new, sql)}
    finally:
        old.close()
        new.close()
    changed = {name for name in before if before[name] != after.get(name)}
    assert changed == {"observation_keep", "quarantine_keep", "asset_keep"}
    assert set(after) - set(before) == {
        "lifecycle_run",
        "lifecycle_run_guard",
        "lifecycle_run_keep",
        "retention_setting",
        "retention_setting_guard",
        "retention_setting_keep",
    }


def test_the_observation_guard_respects_the_cutoff_of_the_open_run(tmp_path: Path) -> None:
    seeded = build(tmp_path)
    store = seeded.store
    run_id = lc.begin_run(store, "purge", CUT, 1)
    with store.write() as conn:
        conn.execute("DELETE FROM observation WHERE seq = (SELECT min(seq) FROM observation)")
    refuses(store, "DELETE FROM observation WHERE received_at_ms >= ?", NEW)
    lc.end_run(store, run_id, "completed", 2)
    refuses(store, "DELETE FROM observation WHERE seq = (SELECT min(seq) FROM observation)")


def test_a_run_cannot_be_widened_reopened_or_doubled(tmp_path: Path) -> None:
    store = build(tmp_path).store
    run_id = lc.begin_run(store, "purge", CUT, 1)
    with pytest.raises(LifecycleBusy):
        lc.begin_run(store, "asset-cleanup", CUT, 2)
    refuses(store, "UPDATE lifecycle_run SET cutoff_ms = ? WHERE run_id = ?", NEW * 10, run_id)
    with store.write() as conn:
        conn.execute(
            "UPDATE lifecycle_run SET deleted_observations = 5 WHERE run_id = ?", (run_id,)
        )
    refuses(store, "UPDATE lifecycle_run SET deleted_observations = 4 WHERE run_id = ?", run_id)
    lc.end_run(store, run_id, "completed", 3)
    refuses(
        store,
        "UPDATE lifecycle_run SET state = 'running', ended_ms = NULL WHERE run_id = ?",
        run_id,
    )
    assert lc.end_run(store, run_id, "failed", 4).state == "completed"  # a closed run stays closed


def test_the_asset_guard_refuses_bundled_referenced_and_young_assets(tmp_path: Path) -> None:
    seeded = build(tmp_path)
    store = seeded.store
    bundled = insert_asset(
        store, data=png(2, 2), width=2, height=2, origin="bundled", label="b", now_ms=OLD
    )
    used = insert_asset(
        store, data=png(3, 3), width=3, height=3, origin="uploaded", label="used", now_ms=OLD
    )
    young = insert_asset(
        store, data=png(4, 4), width=4, height=4, origin="uploaded", label="young", now_ms=NEW
    )
    spare = insert_asset(
        store, data=png(5, 5), width=5, height=5, origin="uploaded", label="spare", now_ms=OLD
    )
    set_avatar(store, seeded.bindings[0], 0, used.record.asset_id, OLD + 5)
    run_id = lc.begin_run(store, "asset-cleanup", CUT, NEW)
    for asset in (bundled, used, young):
        refuses(store, "DELETE FROM asset WHERE asset_id = ?", asset.record.asset_id)
    with store.write() as conn:
        conn.execute("DELETE FROM asset WHERE asset_id = ?", (spare.record.asset_id,))
    lc.end_run(store, run_id, "completed", NEW)
    refuses(store, "DELETE FROM asset WHERE asset_id = ?", used.record.asset_id)
    assert {r[0] for r in query(store, "SELECT asset_id FROM asset")} >= {
        bundled.record.asset_id,
        used.record.asset_id,
        young.record.asset_id,
    }


# ---- retention (FP19-WL-02) ------------------------------------------------------------------


def test_retention_defaults_to_keep_everything_and_only_takes_the_four_windows(
    tmp_path: Path,
) -> None:
    store = open_store(tmp_path / "data")
    try:
        assert get_retention(store) == lc.Retention(None, None, 0)
        assert set_retention(store, None, T0) == lc.Retention(
            None, None, 0
        )  # unchanged: no revision
        for days in (30, 90, 180, 365):
            assert set_retention(store, days, T0 + days).retention_days == days
        saved = set_retention(store, 90, T0 + 1000)
        assert set_retention(store, 90, T0 + 2000) == saved  # idempotent: same revision and time
        assert saved.revision == 5
        for bad in (0, 1, 29, 31, 366, True, "30", 30.5):
            with pytest.raises(StoreUsageError):
                set_retention(store, bad, T0)  # type: ignore[arg-type]
        assert get_retention(store) == saved
        assert set_retention(store, None, T0 + 3000) == lc.Retention(None, T0 + 3000, 6)
        refuses(store, "UPDATE retention_setting SET retention_days = 45")
        refuses(store, "UPDATE retention_setting SET retention_days = 30")  # revision must move
    finally:
        store.close()


def test_the_cutoff_is_now_minus_the_window_and_never_negative() -> None:
    assert cutoff_for(30, 40 * DAY_MS) == 10 * DAY_MS
    assert cutoff_for(365, DAY_MS) == 0


# ---- purge: what goes and what stays (FP19-WL-03) ---------------------------------------------


def test_the_preview_counts_exactly_what_the_purge_deletes(tmp_path: Path) -> None:
    store = build(tmp_path).store
    before = counts(store)
    found = purge_preview(store, CUT)
    assert counts(store) == before  # a preview deletes nothing
    run = run_purge(store, CUT, CLOCK_AT_CUT)
    after = counts(store)
    assert (found.observations, found.quarantine, found.attempts) == (
        run.observations,
        run.quarantine,
        run.attempts,
    )
    assert before["observation"] - after["observation"] == found.observations > 0
    assert before["quarantine"] - after["quarantine"] == found.quarantine == 3
    assert before["attempt"] - after["attempt"] == found.attempts == 3
    assert purge_preview(store, CUT) == lc.PurgePreview(CUT, 0, 0, 0)  # nothing is left to purge


def test_a_purge_deletes_only_old_unlinked_ended_attempts(tmp_path: Path) -> None:
    seeded = build(tmp_path)
    store = seeded.store
    before = attempt_ids(store)
    run_purge(store, CUT, CLOCK_AT_CUT)
    after = attempt_ids(store)
    assert before - after == set(seeded.unlinked_old)
    assert set(seeded.kept_old) | set(seeded.new) <= after
    running = query(store, "SELECT attempt_id FROM attempt WHERE running = 1")
    assert {r[0] for r in running} >= {seeded.kept_old[2]}


def test_observations_a_linked_attempt_needs_survive_and_old_unneeded_ones_go(
    tmp_path: Path,
) -> None:
    seeded = build(tmp_path)
    store = seeded.store
    linked = query(
        store,
        "SELECT a.slot_key, a.started_seq, a.ended_seq FROM attempt a"
        " WHERE a.attempt_id IN (SELECT attempt_id FROM work_attempt)",
    )
    needed = {
        int(seq)
        for slot, start, end in linked
        for (seq,) in query(
            store,
            "SELECT seq FROM observation WHERE slot_key = ? AND seq >= ? AND seq <= ?",
            slot,
            start,
            end,
        )
    }
    assert needed
    old_slots = {f"chat-{n}-{1_794_779_966 + n}" for n in (1, 5)}  # the two unlinked workers
    run_purge(store, CUT, CLOCK_AT_CUT)
    left = {int(r[0]) for r in query(store, "SELECT seq FROM observation")}
    assert needed <= left
    assert not {r[0] for r in query(store, "SELECT slot_key FROM observation")} & old_slots
    # Every old observation that remains is explained: a linked attempt's, a running attempt's
    # opening row, or one on a bot's own DM slot (the newest row, event, turn and chat_done).
    dm_keys = {r[0] for r in query(store, "SELECT dm_key FROM bot_binding")}
    opening = {int(r[0]) for r in query(store, "SELECT started_seq FROM attempt WHERE running = 1")}
    for seq, slot, received in query(
        store, "SELECT seq, slot_key, received_at_ms FROM observation"
    ):
        assert received >= CUT or seq in needed or seq in opening or slot in dm_keys
    assert counts_old(store) < 12  # a handful of boundary rows, not the history


def counts_old(store: Any) -> int:
    return int(query(store, "SELECT count(*) FROM observation WHERE received_at_ms < ?", CUT)[0][0])


def test_a_purge_keeps_what_the_next_start_and_the_next_row_need(tmp_path: Path) -> None:
    seeded = build(tmp_path)
    store = seeded.store
    newest_turn = query(
        store,
        "SELECT seq FROM observation WHERE binding_id = ? AND turn IS NOT NULL"
        " ORDER BY seq DESC LIMIT 1",
        seeded.bindings[1],
    )
    newest_gen = query(
        store, "SELECT seq FROM observation WHERE turn_gen IS NOT NULL ORDER BY seq DESC LIMIT 1"
    )
    chat_done = query(
        store,
        "SELECT seq FROM observation WHERE event_type = 'chat_done' AND binding_id = ?",
        seeded.bindings[1],
    )
    assert newest_turn and newest_gen and chat_done
    run_purge(store, CUT, CLOCK_AT_CUT)
    left = {int(r[0]) for r in query(store, "SELECT seq FROM observation")}
    assert int(newest_turn[0][0]) in left
    assert int(newest_gen[0][0]) in left
    assert int(chat_done[0][0]) in left
    held = query(store, "SELECT observed_seq FROM bot_state")
    assert {int(r[0]) for r in held} <= left


def test_a_rebuild_after_a_purge_reproduces_bot_state_and_every_kept_attempt(
    tmp_path: Path,
) -> None:
    seeded = build(tmp_path)
    store = seeded.store
    state = "SELECT * FROM bot_state ORDER BY binding_id"
    keep = (
        "SELECT * FROM attempt WHERE running = 1"
        " OR attempt_id IN (SELECT attempt_id FROM work_attempt) ORDER BY attempt_id"
    )
    state_before, kept_before = query(store, state), query(store, keep)
    run_purge(store, CUT, CLOCK_AT_CUT)
    assert (query(store, state), query(store, keep)) == (state_before, kept_before)
    rebuild_projection(store, as_of_ms=NEW)
    assert query(store, state) == state_before
    assert query(store, keep) == kept_before
    assert set(seeded.new) <= attempt_ids(store)


def test_the_new_data_after_the_cutoff_is_untouched(tmp_path: Path) -> None:
    seeded = build(tmp_path)
    store = seeded.store
    recent = query(
        store, "SELECT seq, payload FROM observation WHERE received_at_ms >= ? ORDER BY seq", CUT
    )
    run_purge(store, CUT, CLOCK_AT_CUT)
    assert (
        query(
            store,
            "SELECT seq, payload FROM observation WHERE received_at_ms >= ? ORDER BY seq",
            CUT,
        )
        == recent
    )
    assert query(store, "SELECT count(*) FROM quarantine WHERE received_at_ms >= ?", CUT)[0][0] == 1


def test_a_purge_changes_no_identity_hero_decision_or_xp_row(tmp_path: Path) -> None:
    seeded = build(tmp_path)
    store = seeded.store
    tables = (
        *("bot_binding", "bot_display_revision", "bot_presence", "hero_assignment"),
        *("avatar_revision", "asset", "work_item", "work_attempt", "work_milestone"),
        *("work_decision", "xp_entry", "slot_seen"),
    )
    before = {t: query(store, f"SELECT * FROM {t} ORDER BY 1, 2") for t in tables}
    assert before["xp_entry"]
    run_purge(store, CUT, CLOCK_AT_CUT)
    assert {t: query(store, f"SELECT * FROM {t} ORDER BY 1, 2") for t in tables} == before


def test_a_purge_runs_in_bounded_batches_and_counts_every_row(tmp_path: Path) -> None:
    store = build(tmp_path).store
    expected = purge_preview(store, CUT)
    seen: list[int] = []
    real_write = store.write

    from contextlib import contextmanager

    @contextmanager
    def counting() -> Any:
        with real_write() as conn:
            yield conn
        seen.append(1)

    store.write = counting  # type: ignore[method-assign]
    try:
        run = run_purge(store, CUT, CLOCK_AT_CUT, batch=2)
    finally:
        store.write = real_write  # type: ignore[method-assign]
    assert (run.observations, run.quarantine, run.attempts) == (
        expected.observations,
        expected.quarantine,
        expected.attempts,
    )
    assert run.state == "completed" and run.ended_ms is not None
    assert len(seen) >= (expected.observations + expected.quarantine + expected.attempts) // 2
    assert query(store, "SELECT count(*) FROM lifecycle_run WHERE state = 'running'")[0][0] == 0


def test_a_failed_purge_closes_the_run_and_keeps_what_was_deleted(tmp_path: Path) -> None:
    store = build(tmp_path).store
    real = lc.purge_attempts

    def boom(*args: Any, **kwargs: Any) -> int:
        raise RuntimeError("disk")

    lc.purge_attempts = boom
    try:
        with pytest.raises(RuntimeError):
            run_purge(store, CUT, CLOCK_AT_CUT)
    finally:
        lc.purge_attempts = real
    runs = read_runs(store)
    assert runs.running is None and runs.last_purge is not None
    assert runs.last_purge.state == "failed" and runs.last_purge.observations > 0
    assert read_horizon(store) == CUT  # rows were deleted, so history before CUT is unknown


# ---- the horizon: a purged span is a gap, never zero activity (FP19-WL-06) ---------------------


def test_with_purged_gap_replaces_everything_before_the_horizon_with_one_gap() -> None:
    spans = [("covered", 0, 50), ("gap", 50, 120), ("covered", 120, 400)]
    assert lc.with_purged_gap(spans, None) == spans
    assert lc.with_purged_gap(spans, 100) == [
        ("gap", 0, 100),
        ("gap", 100, 120),
        ("covered", 120, 400),
    ]
    assert lc.PURGED_REASON == "purged"


def test_there_is_no_horizon_until_a_purge_deletes_a_row(tmp_path: Path) -> None:
    store = build(tmp_path).store
    assert read_horizon(store) is None
    run_purge(store, T0, CLOCK_AT_CUT)  # a cutoff before every row deletes nothing
    assert read_horizon(store) is None
    run_purge(store, CUT, CLOCK_AT_CUT)
    assert read_horizon(store) == CUT
    run_purge(store, CUT - 5, CLOCK_AT_CUT)  # nothing left to delete: the horizon does not move
    assert read_horizon(store) == CUT


def window(store: Any, binding: str, as_of: int) -> dict[str, Any]:
    result = attempts_page(store, binding, cursor=None, limit=10, as_of_ms=as_of)
    return {w.key: w for w in result.activity}


def test_a_window_that_reaches_the_purged_span_reads_it_as_a_gap_not_covered_time(
    tmp_path: Path,
) -> None:
    seeded = build(tmp_path)
    store = seeded.store
    binding = seeded.bindings[0]
    as_of = CUT + 3 * DAY_MS  # the 7 d window starts before CUT
    send(store, CoverageMark("open-covered", T0))
    heartbeat(store, run_id=RUN, now_ms=as_of)
    before = window(store, binding, as_of)["last7d"]
    assert before.covered_ms == as_of - T0 and before.gap_count == 0
    run_purge(store, CUT, CLOCK_AT_CUT)
    after = window(store, binding, as_of)["last7d"]
    assert after.covered_ms == as_of - CUT  # only the time after the horizon is covered
    assert after.gap_count == 1  # the purged span is one gap, not zero activity
    assert after.window_ms == before.window_ms
    clear = window(store, binding, CUT + 60 * DAY_MS)["last7d"]  # a window that never reaches it
    assert clear.gap_count == 0


# ---- the backups (FP19-WL-07) -------------------------------------------------------------------


def test_a_pre_purge_backup_is_a_verified_copy_and_only_the_newest_is_kept(tmp_path: Path) -> None:
    store = build(tmp_path).store
    first = pre_lifecycle_backup(store, "purge")
    time.sleep(0.01)
    second = pre_lifecycle_backup(store, "purge")
    cleanup = pre_lifecycle_backup(store, "cleanup")
    names = sorted(p.name for p in store.backups_dir.iterdir())
    assert second.exists() and cleanup.exists() and not first.exists()
    assert [n for n in names if n.startswith("pre-purge-")] == [second.name]
    assert [n for n in names if n.startswith("pre-cleanup-")] == [cleanup.name]
    copy = sqlite3.connect(second)
    try:
        assert copy.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert (
            copy.execute("SELECT count(*) FROM observation").fetchone()[0]
            == counts(store)["observation"]
        )
    finally:
        copy.close()
    if os.name == "posix":
        assert second.stat().st_mode & 0o777 == 0o600


def test_pruning_touches_only_its_own_kind(tmp_path: Path) -> None:
    for name in (
        "pre-purge-20260101T000000000001Z.db",
        "pre-purge-20260101T000000000002Z.db",
        "pre-cleanup-20260101T000000000001Z.db",
        "pre-migrate-v1-to-v2-20260101T000000000001Z.db",
        "backup-v9-20260101T000000000001Z.db",
        "notes.txt",
    ):
        (tmp_path / name).write_bytes(b"x")
    prune_pre_lifecycle(tmp_path, "purge", 1)
    assert sorted(p.name for p in tmp_path.iterdir()) == [
        "backup-v9-20260101T000000000001Z.db",
        "notes.txt",
        "pre-cleanup-20260101T000000000001Z.db",
        "pre-migrate-v1-to-v2-20260101T000000000001Z.db",
        "pre-purge-20260101T000000000002Z.db",
    ]


def test_a_failed_pre_purge_backup_raises_and_leaves_no_partial_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = build(tmp_path).store
    before = counts(store)

    def broken(source: Path, dest: Path, name: str) -> Path:
        raise BackupError("backup failed")

    monkeypatch.setattr(
        importlib.import_module("backend.specter_arena.store.backup"), "copy_database", broken
    )
    with pytest.raises(BackupError):
        pre_lifecycle_backup(store, "purge")
    assert counts(store) == before
    assert not list(store.backups_dir.glob("pre-purge-*"))


# ---- crash recovery (FP19-WL-08) ----------------------------------------------------------------


def test_a_run_a_crash_left_open_is_closed_as_interrupted_when_the_store_opens(
    tmp_path: Path,
) -> None:
    seeded = build(tmp_path)
    store = seeded.store
    run_id = lc.begin_run(store, "purge", CUT, 5)
    with store.write() as conn:
        conn.execute("DELETE FROM observation WHERE seq = (SELECT min(seq) FROM observation)")
        conn.execute(
            "UPDATE lifecycle_run SET deleted_observations = 1 WHERE run_id = ?", (run_id,)
        )
    store.close()
    reopened = open_store(tmp_path / "data")
    try:
        runs = read_runs(reopened)
        assert runs.running is None
        assert runs.last_purge is not None and runs.last_purge.state == "interrupted"
        assert runs.last_purge.ended_ms is not None and runs.last_purge.observations == 1
        assert read_horizon(reopened) == CUT  # the deleted row still counts as purged history
        assert lc.begin_run(reopened, "purge", CUT, 6) > run_id  # a new run is allowed again
    finally:
        reopened.close()


def test_closing_interrupted_runs_never_raises_on_a_store_without_the_table() -> None:
    conn = sqlite3.connect(":memory:", isolation_level=None)
    assert close_interrupted_runs(conn, 1) == 0
    conn.execute("CREATE TABLE lifecycle_run (x)")
    assert close_interrupted_runs(conn, 1) == 0  # the UPDATE fails on the wrong shape: swallowed
    conn.close()


# ---- export (FP19-WL-09) ------------------------------------------------------------------------


def test_an_export_is_a_verified_closed_owner_only_copy_in_the_exports_directory(
    tmp_path: Path,
) -> None:
    store = build(tmp_path).store
    made = export_database(store)
    path = tmp_path / "data" / "exports" / made.file_name
    assert re.fullmatch(r"export-v11-\d{8}T\d{12}Z\.db", made.file_name)
    assert path.is_file() and made.byte_length == path.stat().st_size > 0
    import hashlib

    assert made.sha256 == hashlib.sha256(path.read_bytes()).hexdigest()
    assert abs(made.created_ms - int(time.time() * 1000)) < 60_000
    if os.name == "posix":
        assert path.stat().st_mode & 0o777 == 0o600
        assert (tmp_path / "data" / "exports").stat().st_mode & 0o777 == 0o700
    copy = sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True)
    try:
        assert copy.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert copy.execute("PRAGMA journal_mode").fetchone() == ("delete",)  # one closed file
        assert (
            copy.execute("SELECT count(*) FROM observation").fetchone()[0]
            == counts(store)["observation"]
        )
    finally:
        copy.close()
    assert not list((tmp_path / "data" / "exports").glob(".*partial"))
    assert list_exports(tmp_path / "data") == (made,)


def test_exports_list_newest_first_capped_at_twenty_and_ignore_other_names(tmp_path: Path) -> None:
    store = build(tmp_path).store
    directory = tmp_path / "data" / "exports"
    directory.mkdir(parents=True)
    for n in range(23):
        (directory / f"export-v9-20260101T0000000000{n:02d}Z.db").write_bytes(b"x" * (n + 1))
    (directory / "notes.txt").write_text("hi")
    (directory / "export-v9-bad.db").write_bytes(b"x")
    found = list_exports(store.data_dir)
    assert len(found) == 20
    assert found[0].file_name == "export-v9-20260101T000000000022Z.db"
    assert [f.created_ms for f in found] == sorted((f.created_ms for f in found), reverse=True)
    assert all(re.fullmatch(r"[0-9a-f]{64}", f.sha256) for f in found)
    assert (directory / "export-v9-20260101T000000000022Z.db.sha256").is_file()  # sidecar written
    assert list_exports(tmp_path / "nowhere") == ()


def test_an_export_that_cannot_be_written_raises_backup_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = build(tmp_path).store

    def broken(source: Path, dest: Path, name: str) -> Path:
        raise BackupError("backup failed")

    monkeypatch.setattr(
        importlib.import_module("backend.specter_arena.store.backup"), "copy_database", broken
    )
    with pytest.raises(BackupError):
        export_database(store)
    assert list_exports(store.data_dir) == ()


# ---- the startup sweep (FP19-WL-10) -------------------------------------------------------------

OLD_AGE_S = 11 * 60


def touch(path: Path, age_s: float) -> Path:
    path.write_bytes(b"orphan")
    stamp = time.time() - age_s
    os.utime(path, (stamp, stamp))
    return path


def test_the_sweep_deletes_only_matching_names_older_than_ten_minutes(tmp_path: Path) -> None:
    data = tmp_path / "data"
    store_dir, backups, exports = data / "store", data / "store" / "backups", data / "exports"
    for d in (store_dir, backups, exports):
        d.mkdir(parents=True)
    hexid = "0123456789abcdef0123456789abcdef"
    orphans = [
        touch(store_dir / f".restore-{hexid}.db", OLD_AGE_S),
        touch(store_dir / f"..restore-{hexid}.db.partial", OLD_AGE_S),
        touch(backups / ".backup-v9-20260101T000000000001Z.db.partial", OLD_AGE_S),
        touch(exports / ".export-v9-20260101T000000000001Z.db.partial", 3600),
    ]
    kept = [
        touch(store_dir / f".restore-{hexid}.db.pre", OLD_AGE_S),  # not a name the store writes
        touch(store_dir / ".restore-xyz.db", OLD_AGE_S),
        touch(store_dir / "specter-arena.db", 99999),
        touch(store_dir / "specter-arena.db-wal", 99999),
        touch(store_dir / "specter-arena.db-shm", 99999),
        touch(store_dir / "specter-arena.db.pre-restore-20260101T000000000001Z", 99999),
        touch(backups / "pre-migrate-v8-to-v9-20260101T000000000001Z.db", 99999),
        touch(backups / "pre-purge-20260101T000000000001Z.db", 99999),
        touch(backups / "backup-v9-20260101T000000000001Z.db", 99999),
        touch(exports / "export-v9-20260101T000000000001Z.db", 99999),
        touch(exports / "export-v9-20260101T000000000001Z.db.sha256", 99999),
        touch(store_dir / f".restore-{hexid}.db.tmp", 99999),
        touch(backups / ".fresh.partial", 30),  # an export in flight: younger than ten minutes
        touch(store_dir / f".restore-{'f' * 32}.db", 599),
    ]
    assert sweep_temp_files(data) == len(orphans)
    assert not any(p.exists() for p in orphans)
    assert all(p.exists() for p in kept)
    assert sweep_temp_files(data) == 0


def test_the_sweep_never_follows_a_link_or_raises(tmp_path: Path) -> None:
    data = tmp_path / "data"
    (data / "store").mkdir(parents=True)
    target = touch(tmp_path / "elsewhere.txt", OLD_AGE_S)
    link = data / "store" / ".restore-0123456789abcdef0123456789abcdef.db"
    if os.name == "posix":
        link.symlink_to(target)
    (data / "store" / ".gone.partial").mkdir()  # a directory with an orphan name is not a file
    assert sweep_temp_files(data, now=time.time() + 7200) == 0
    assert target.exists()
    assert sweep_temp_files(tmp_path / "missing") == 0


def test_the_sweep_runs_when_the_store_opens_and_an_error_cannot_block_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    data = tmp_path / "data"
    (data / "store").mkdir(parents=True)
    orphan = touch(data / "store" / ".x.db.partial", OLD_AGE_S)
    open_store(data).close()
    assert not orphan.exists()
    again = touch(data / "store" / ".y.db.partial", OLD_AGE_S)
    original = Path.unlink

    def refuse(self: Path, missing_ok: bool = False) -> None:
        if self == again:
            raise PermissionError("denied")
        original(self, missing_ok=missing_ok)

    monkeypatch.setattr(Path, "unlink", refuse)
    open_store(data).close()  # the sweep failing is not a reason to refuse to open
    assert again.exists()


def test_orphan_names_match_only_what_the_store_writes() -> None:
    assert is_orphan_name(".backup-v9-20260101T000000000001Z.db.partial")
    assert is_orphan_name("..restore-0123456789abcdef0123456789abcdef.db.partial")
    assert is_orphan_name(".restore-0123456789abcdef0123456789abcdef.db")
    for name in (
        "specter-arena.db",
        "x.partial",
        ".restore-ABC.db",
        ".partial",
        "backup.db.partial",
    ):
        assert not is_orphan_name(name)


# ---- asset cleanup and the upload cap (FP19-REQ-01, FP19-REQ-02) --------------------------------


def fill_uploads(store: Any, count: int, *, at: int) -> list[str]:
    ids = []
    for n in range(count):
        made = insert_asset(
            store,
            data=png(1 + n % 40, 1 + n // 40),
            width=1 + n % 40,
            height=1 + n // 40,
            origin="uploaded",
            label=f"up-{n}",
            now_ms=at + n,
        )
        ids.append(made.record.asset_id)
    return ids


def test_the_upload_cap_refuses_a_new_image_but_not_the_same_bytes_again(tmp_path: Path) -> None:
    store = open_store(tmp_path / "data")
    try:
        ids = fill_uploads(store, 100, at=OLD)
        with pytest.raises(UploadLimitReached):
            insert_asset(
                store,
                data=png(60, 60),
                width=60,
                height=60,
                origin="uploaded",
                label="x",
                now_ms=OLD,
            )
        again = insert_asset(
            store, data=png(1, 1), width=1, height=1, origin="uploaded", label="x", now_ms=OLD
        )
        assert (again.record.asset_id, again.created) == (ids[0], False)
        bundled = insert_asset(
            store, data=png(61, 61), width=61, height=61, origin="bundled", label="b", now_ms=OLD
        )
        assert bundled.created  # bundled art is not counted against the cap
    finally:
        store.close()


def test_cleanup_deletes_only_old_unreferenced_uploads(tmp_path: Path) -> None:
    seeded = build(tmp_path)
    store = seeded.store
    bundled = insert_asset(
        store, data=png(9, 9), width=9, height=9, origin="bundled", label="b", now_ms=OLD
    )
    ids = fill_uploads(store, 6, at=OLD)
    young = fill_uploads_at(store, NEW)
    set_avatar(store, seeded.bindings[0], 0, ids[0], OLD + 50)
    set_avatar(store, seeded.bindings[0], 1, ids[1], OLD + 60)  # ids[0] is now only historical

    def clock() -> int:
        return NEW + 10 * 60 * 1000  # young is 10 minutes old

    assert unused_upload_count(store, clock()) == 4
    run = run_asset_cleanup(store, clock, batch=2)
    assert (run.state, run.assets, run.kind) == ("completed", 4, "asset-cleanup")
    left = {r[0] for r in query(store, "SELECT asset_id FROM asset")}
    assert set(ids[:2]) <= left and young in left and bundled.record.asset_id in left
    assert not (set(ids[2:]) & left)
    assert unused_upload_count(store, clock()) == 0
    assert run_asset_cleanup(store, clock).assets == 0


def fill_uploads_at(store: Any, at: int) -> str:
    return insert_asset(
        store, data=png(70, 70), width=70, height=70, origin="uploaded", label="young", now_ms=at
    ).record.asset_id


def test_a_failed_cleanup_closes_its_run(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = open_store(tmp_path / "data")
    try:
        fill_uploads(store, 2, at=OLD)
        real = store.write
        calls: list[int] = []

        from contextlib import contextmanager

        @contextmanager
        def flaky() -> Any:
            calls.append(1)
            if len(calls) == 2:  # begin_run, then the first batch fails
                raise sqlite3.OperationalError("disk full")
            with real() as conn:
                yield conn

        monkeypatch.setattr(store, "write", flaky)
        with pytest.raises(Exception):  # noqa: B017, PT011 - StoreUnavailable from the driver error
            run_asset_cleanup(store, lambda: NEW)
        monkeypatch.setattr(store, "write", real)
        runs = read_runs(store)
        assert runs.running is None
        assert runs.last_cleanup is not None and runs.last_cleanup.state == "failed"
    finally:
        store.close()


def test_unused_helpers_validate_their_time_argument(tmp_path: Path) -> None:
    store = open_store(tmp_path / "data")
    try:
        for call in (
            lambda: unused_upload_count(store, -1),
            lambda: purge_preview(store, -1),
            lambda: lc.begin_run(store, "vacuum", 1, 1),  # type: ignore[arg-type]
            lambda: lc.begin_run(store, "purge", 1, -1),
        ):
            with pytest.raises(StoreUsageError):
                call()
        assert installation(store)
    finally:
        store.close()
