"""FP-14 release evidence for the work ledger: real-schema restore, a real lock, a 100-item walk.

Test-time only. Nothing here changes production behaviour."""

import shutil
import sqlite3
import time
from pathlib import Path

import pytest

from backend.specter_arena.store import (
    StoreUnavailable,
    backup,
    list_work,
    open_store,
    rebuild_projection,
    restore,
    xp_history,
    xp_summaries,
    xp_summary,
)
from backend.specter_arena.store import connection as connection_module
from backend.specter_arena.store import specters as sp

from .test_store_specter_isolation import PNG, PROFILE
from .work_fakes import T0, decide, ledger_hash, make_work, open_seeded, query, submit_and_accept

BUDGET_S = 2.0


def test_a_restored_backup_keeps_identity_specters_portraits_and_xp(tmp_path: Path) -> None:
    store, seeded = open_seeded(tmp_path, bots=2, per_bot=2)
    binding = seeded.bindings[0]
    sp.save_manual(store, binding, expected_version=0, profile=PROFILE, now_ms=T0 + 50)
    asset = sp.insert_asset(
        store, data=PNG, width=8, height=8, origin="uploaded", label="a", now_ms=T0 + 51
    ).record
    sp.set_portrait(store, binding, expected_version=1, asset_id=asset.asset_id, now_ms=T0 + 52)
    item = make_work(store, [seeded.attempts[0][0]])
    accepted = submit_and_accept(store, item, 1, at=T0 + 2000)
    assert accepted.state == "accepted"
    assert xp_summary(store, binding).total_xp == 100
    ledger_before = ledger_hash(store)
    identity_before = query(store, "SELECT binding_id, dm_key FROM bot_binding ORDER BY 1")
    saved = backup(store, tmp_path / "saved")
    store.close()
    data = tmp_path / "data"
    shutil.rmtree(data / "store")
    assert restore(saved, data) is None
    again = open_store(data)
    try:
        assert ledger_hash(again) == ledger_before
        assert query(again, "SELECT binding_id, dm_key FROM bot_binding ORDER BY 1") == (
            identity_before
        )
        assert xp_summary(again, binding).total_xp == 100
        current = sp.get_specter(again, binding)
        assert current is not None and current.profile["name"] == PROFILE["name"]
        assert current.portrait is not None and current.portrait.asset_id == asset.asset_id
        assert query(again, "SELECT count(*) FROM specter_revision")[0][0] == 2
        stored = sp.get_asset(again, asset.asset_id)
        assert stored is not None and stored.sha256 == asset.sha256
        assert query(again, "SELECT count(*) FROM observation")[0][0] > 0
    finally:
        again.close()


def test_deleting_or_rebuilding_observations_never_changes_xp(tmp_path: Path) -> None:
    store, seeded = open_seeded(tmp_path, bots=1, per_bot=1)
    binding = seeded.bindings[0]
    item = make_work(store, [seeded.attempts[0][0]])
    submit_and_accept(store, item, 1, at=T0 + 2000)
    try:
        with pytest.raises(sqlite3.DatabaseError), store.write() as conn:
            conn.execute("DELETE FROM observation")
        with pytest.raises(sqlite3.DatabaseError), store.write() as conn:
            conn.execute("DELETE FROM xp_entry")
        assert query(store, "SELECT count(*) FROM observation")[0][0] > 0
        rebuild_projection(store, as_of_ms=T0 + 9000)
        assert xp_summary(store, binding).total_xp == 100
    finally:
        store.close()


def test_a_backup_taken_before_acceptance_restores_without_the_later_award(tmp_path: Path) -> None:
    store, seeded = open_seeded(tmp_path, bots=1, per_bot=1)
    binding = seeded.bindings[0]
    sp.save_manual(store, binding, expected_version=0, profile=PROFILE, now_ms=T0 + 50)
    item = make_work(store, [seeded.attempts[0][0]])
    submitted = decide(store, item, "submit", 1, at=T0 + 2000)
    saved = backup(store, tmp_path / "saved")
    decide(store, submitted, "accept", 1, at=T0 + 2001)
    assert xp_summary(store, binding).total_xp == 100
    store.close()
    data = tmp_path / "data"
    shutil.rmtree(data / "store")
    restore(saved, data)
    again = open_store(data)
    try:
        assert xp_summary(again, binding).total_xp == 0
        assert xp_history(again, binding, cursor=None, limit=50).page.items == ()
        page = list_work(again, state=None, binding_id=None, cursor=None, limit=25)
        assert [record.state for record in page.items] == ["awaiting-review"]
        assert sp.get_specter(again, binding) is not None
        assert query(again, "SELECT count(*) FROM xp_entry")[0][0] == 0
    finally:
        again.close()


def test_a_second_connection_holding_the_write_lock_makes_the_store_unavailable_then_it_recovers(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(connection_module, "BUSY_TIMEOUT_S", 0.2)
    store, seeded = open_seeded(tmp_path, bots=1, per_bot=1)
    binding = seeded.bindings[0]
    submitted = decide(store, make_work(store, [seeded.attempts[0][0]]), "submit", 1, at=T0 + 2000)
    other = sqlite3.connect(
        str(tmp_path / "data" / "store" / "specter-arena.db"), isolation_level=None
    )
    other.execute("BEGIN IMMEDIATE")
    try:
        with pytest.raises(StoreUnavailable):
            decide(store, submitted, "accept", 1, at=T0 + 3000)
        assert store.status().state == "unavailable"
        assert xp_summary(store, binding).total_xp == 0
    finally:
        other.execute("ROLLBACK")
        other.close()
    assert store.status().state == "ready"
    assert decide(store, submitted, "accept", 1, at=T0 + 3000).state == "accepted"
    assert xp_summary(store, binding).total_xp == 100
    assert query(store, "SELECT count(*) FROM xp_entry WHERE kind = 'award'")[0][0] == 1
    store.close()


def test_a_hundred_work_items_over_twenty_bots_page_in_four_requests_inside_the_budget(
    tmp_path: Path,
) -> None:
    store, seeded = open_seeded(tmp_path, bots=20, per_bot=5)
    try:
        records = [
            make_work(
                store,
                [seeded.attempts[i % 20][i // 20]],
                n=i + 1,
                at=T0 + 1000 + i,
                milestones=["a", "b"],
            )
            for i in range(100)
        ]
        for n, record in enumerate(records[:50]):
            submit_and_accept(store, record, n + 1, at=T0 + 5000 + n * 3)
        clock = time.monotonic()
        walked: list[str] = []
        sizes: list[int] = []
        cursor: str | None = None
        while True:
            page = list_work(store, state=None, binding_id=None, cursor=cursor, limit=None)
            sizes.append(len(page.items))
            walked.extend(record.work_id for record in page.items)
            cursor = page.next_cursor
            if cursor is None:
                break
        assert time.monotonic() - clock < BUDGET_S
        assert sizes == [25, 25, 25, 25]
        assert len(set(walked)) == 100
        accepted = list_work(store, state="accepted", binding_id=None, cursor=None, limit=None)
        assert len(accepted.items) == 25 and accepted.next_cursor is not None
        assert len(xp_summaries(store)) == 20
        assert sum(s.total_xp for s in xp_summaries(store)) == 50 * 100
    finally:
        store.close()
