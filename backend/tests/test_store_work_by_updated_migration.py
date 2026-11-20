"""FP-18 migration 0008: two indexes for the update-ordered work list, nothing else.
Test-time only."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from backend.specter_arena.store import (
    StoreStatus,
    list_work_view,
    open_store,
)
from backend.specter_arena.store import work as work_module
from backend.specter_arena.store.errors import SchemaNewer
from backend.specter_arena.store.migrate import (
    check_sequence,
    latest_version,
    load_migrations,
    migrate,
    pending,
    validate,
    verify_checksums,
)

from .work_fakes import T0, decide, make_work, open_seeded

FIXTURE_V7 = Path(__file__).resolve().parent / "fixtures" / "store" / "schema-v7.sql"
PACKAGED = load_migrations()
ALL = check_sequence(PACKAGED)


def place(data_dir: Path) -> Path:
    (data_dir / "store").mkdir(parents=True)
    path = data_dir / "store" / "specter-arena.db"
    conn = sqlite3.connect(path, isolation_level=None)
    conn.executescript(FIXTURE_V7.read_text(encoding="utf-8"))
    conn.close()
    return path


def digest(conn: sqlite3.Connection) -> dict[str, list[tuple[object, ...]]]:
    tables = [
        str(n)
        for (n,) in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
            " AND name <> 'schema_migrations' ORDER BY name"
        )
    ]
    return {t: sorted(tuple(r) for r in conn.execute(f"SELECT * FROM {t}")) for t in tables}


def test_the_migration_is_the_eighth_and_only_creates_two_indexes() -> None:
    assert latest_version() == 8
    assert PACKAGED[7].name == "work_by_updated"
    statements = [
        " ".join(
            "\n".join(line for line in s.splitlines() if not line.lstrip().startswith("--")).split()
        )
        for s in validate(PACKAGED[7])
    ]
    assert statements == [
        "CREATE INDEX work_item_by_updated ON work_item (updated_ms, work_id);",
        "CREATE INDEX work_item_by_state_updated ON work_item (state, updated_ms, work_id);",
    ]


def test_a_fresh_store_has_both_indexes_on_the_columns_the_list_orders_by(tmp_path: Path) -> None:
    opened = open_store(tmp_path / "data")
    try:
        assert opened.status() == StoreStatus("ready", 8, 8)
        with opened.read() as conn:
            for name, columns in (
                ("work_item_by_updated", ["updated_ms", "work_id"]),
                ("work_item_by_state_updated", ["state", "updated_ms", "work_id"]),
                ("work_item_by_created", ["created_ms", "work_id"]),
            ):
                found = [str(r[2]) for r in conn.execute(f"PRAGMA index_info({name})")]
                assert found == columns
    finally:
        opened.close()


def test_a_v7_store_upgrades_in_one_open_with_one_backup_and_no_row_changes(
    tmp_path: Path,
) -> None:
    data_dir = tmp_path / "data"
    path = place(data_dir)
    before_conn = sqlite3.connect(path)
    before = digest(before_conn)
    before_conn.close()
    opened = open_store(data_dir)
    try:
        assert opened.status() == StoreStatus("ready", 8, 8)
        with opened.read() as conn:
            assert conn.execute("PRAGMA integrity_check").fetchone() == ("ok",)
            assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
            assert digest(conn) == before
            assert conn.execute(
                "SELECT name FROM schema_migrations WHERE version = 8"
            ).fetchone() == ("work_by_updated",)
    finally:
        opened.close()
    backups = list((data_dir / "store" / "backups").glob("pre-migrate-v7-to-v8-*.db"))
    assert len(backups) == 1
    old = sqlite3.connect(backups[0])
    try:
        assert old.execute("PRAGMA user_version").fetchone() == (7,)
        assert old.execute(
            "SELECT count(*) FROM sqlite_master WHERE name LIKE 'work_item_by_%updated'"
        ).fetchone() == (0,)
    finally:
        old.close()


def test_the_checksum_of_the_migration_is_audited_and_nothing_is_pending(tmp_path: Path) -> None:
    conn = sqlite3.connect(tmp_path / "a.db", isolation_level=None)
    try:
        migrate(conn, ALL)
        verify_checksums(conn, ALL)
        assert pending(conn, ALL) == []
    finally:
        conn.close()


def test_a_v8_store_is_refused_by_code_that_knows_only_seven(tmp_path: Path) -> None:
    """The rollback consequence, stated as a test: an older build fails closed on a v8 store."""
    data_dir = tmp_path / "data"
    open_store(data_dir).close()
    with pytest.raises(SchemaNewer):
        open_store(data_dir, migrations=PACKAGED[:7])


@pytest.mark.parametrize(
    ("order", "has_state", "has_binding", "index"),
    [
        ("updated", False, False, "work_item_by_updated"),
        ("updated", True, False, "work_item_by_state_updated"),
        ("updated", False, True, "work_item_by_updated"),
        ("updated", True, True, "work_item_by_state_updated"),
        ("created", False, False, "work_item_by_created"),
    ],
)
def test_every_list_shape_seeks_an_index_and_never_sorts(
    tmp_path: Path, order: str, has_state: bool, has_binding: bool, index: str
) -> None:
    opened, seeded = open_seeded(tmp_path, bots=2, per_bot=3)
    try:
        for i in range(6):
            make_work(opened, [seeded.attempts[i % 2][i // 2]], i + 1, at=T0 + 1000 + i)
        list_work_view(opened, state=None, binding_id=None, order=order, cursor=None, limit=None)
        params: dict[str, object] = {"after_ms": work_module._FIRST_KEY, "after_id": "", "n": 26}
        if has_state:
            params["state"] = "open"
        if has_binding:
            params["binding"] = seeded.bindings[0]
        sql = work_module._VIEW_SQL_BY_SHAPE[(order, has_state, has_binding)]
        with opened.read() as conn:
            plan = [str(r[3]) for r in conn.execute("EXPLAIN QUERY PLAN " + sql, params)]
        top = [line for line in plan if line.startswith(("SEARCH w", "SCAN w"))]
        assert top and all(f"USING INDEX {index}" in line for line in top), plan
        assert not any("TEMP B-TREE" in line for line in plan), plan
    finally:
        opened.close()


def test_an_update_keeps_the_index_ordered(tmp_path: Path) -> None:
    opened, seeded = open_seeded(tmp_path, bots=1, per_bot=3)
    try:
        records = [
            make_work(opened, [seeded.attempts[0][i]], i + 1, at=T0 + 1000 + i) for i in range(3)
        ]
        decide(opened, records[0], "block", 1, at=T0 + 9000)
        page = list_work_view(
            opened, state=None, binding_id=None, order="updated", cursor=None, limit=None
        )
        assert [r.work_id for r in page.items][0] == records[0].work_id
        assert page.items[0].state == "blocked"
    finally:
        opened.close()
