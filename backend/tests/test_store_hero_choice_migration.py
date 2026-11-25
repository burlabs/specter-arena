"""Migration 0011 (hero choice): every 0010 row kept, the rebuilt tables and triggers (FP-23)."""

import hashlib
import sqlite3
from pathlib import Path

import pytest

from backend.specter_arena.store import (
    HERO_IDS,
    MigrationError,
    StoreStatus,
    latest_version,
    open_store,
)
from backend.specter_arena.store.migrate import (
    check_sequence,
    load_migrations,
    make_migration,
    migrate,
)

PACKAGED = load_migrations()
ALL = check_sequence(PACKAGED)
MIGRATION_0011 = PACKAGED[10]
HERO_TRIGGERS = {
    "hero_assignment": {
        "hero_assignment_sequence",
        "hero_assignment_ordinal",
        "hero_assignment_immutable",
        "hero_assignment_keep",
    },
    "avatar_revision": {
        "avatar_revision_sequence",
        "avatar_revision_immutable",
        "avatar_revision_keep",
    },
}


def seeded_v10(path: Path, bindings: int) -> sqlite3.Connection:
    """Migrations 1..10 applied, `bindings` bindings with the FP-16 numbering, two avatar rows."""
    conn = sqlite3.connect(path, isolation_level=None)
    conn.execute("PRAGMA foreign_keys = ON")
    migrate(conn, ALL[:10])
    store_id = conn.execute("SELECT store_id FROM store_meta").fetchone()[0]
    for n in range(bindings):
        binding = f"bnd_{n:024x}"
        conn.execute(
            "INSERT INTO bot_binding (binding_id, installation_id, dm_key, member_id,"
            " memory_store, first_seen_ms) VALUES (?, ?, ?, ?, '', ?)",
            (binding, store_id, f"member-m{n}", f"m{n}", 1000 + n),
        )
        conn.execute(
            "INSERT INTO hero_assignment VALUES (?, ?, ?, ?, ?)",
            (binding, n, HERO_IDS[n % 11], n // 11 + 1, 1000 + n),
        )
    if bindings > 3:
        for revision, created in ((1, 5000), (2, 5001)):
            conn.execute(
                "INSERT INTO avatar_revision (binding_id, revision_no, asset_id, created_ms)"
                " VALUES (?, ?, NULL, ?)",
                (f"bnd_{3:024x}", revision, created),
            )
    return conn


def digest(conn: sqlite3.Connection, table: str) -> str:
    hashed = hashlib.sha256()
    for row in conn.execute(f"SELECT * FROM {table} ORDER BY 1, 2"):
        hashed.update(repr(tuple(row)).encode())
    return hashed.hexdigest()


def triggers(conn: sqlite3.Connection, table: str) -> set[str]:
    return {
        str(n)
        for (n,) in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?", (table,)
        )
    }


def test_the_migration_is_the_eleventh_and_is_named_hero_choice() -> None:
    assert latest_version() >= 11
    assert MIGRATION_0011.name == "hero_choice"
    assert MIGRATION_0011.version == 11


def test_every_row_is_copied_and_marked_auto(tmp_path: Path) -> None:
    conn = seeded_v10(tmp_path / "v10.db", 13)
    avatars = digest(conn, "avatar_revision")
    bindings = digest(conn, "bot_binding")
    old = [tuple(r) for r in conn.execute("SELECT * FROM hero_assignment ORDER BY assignment_no")]
    assert migrate(conn, ALL[:11]) == 11
    new = [tuple(r) for r in conn.execute("SELECT * FROM hero_assignment ORDER BY assignment_no")]
    assert [row[:5] for row in new] == old
    assert {row[5] for row in new} == {"auto"}
    assert [(row[2], row[3]) for row in new][11:] == [("vell", 2), ("stitch", 2)]
    assert digest(conn, "avatar_revision") == avatars
    assert digest(conn, "bot_binding") == bindings
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    assert conn.execute("PRAGMA user_version").fetchone() == (11,)
    conn.close()


def test_all_triggers_are_back_on_the_rebuilt_tables_and_asset_keep_is_unchanged(
    tmp_path: Path,
) -> None:
    conn = seeded_v10(tmp_path / "v10.db", 2)
    before = conn.execute("SELECT sql FROM sqlite_master WHERE name = 'asset_keep'").fetchone()[0]
    migrate(conn, ALL[:11])
    for table, expected in HERO_TRIGGERS.items():
        assert triggers(conn, table) == expected
    after = conn.execute("SELECT sql FROM sqlite_master WHERE name = 'asset_keep'").fetchone()[0]
    assert " ".join(after.split()) == " ".join(before.split())
    assert "asset_keep" in triggers(conn, "asset")
    conn.close()


def test_the_rebuilt_avatar_table_still_references_the_hero_table(tmp_path: Path) -> None:
    conn = seeded_v10(tmp_path / "v10.db", 4)
    migrate(conn, ALL[:11])
    refs = {
        (str(r[2]), str(r[3]), str(r[4]))
        for r in conn.execute("PRAGMA foreign_key_list(avatar_revision)")
    }
    assert ("hero_assignment", "binding_id", "binding_id") in refs
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO avatar_revision (binding_id, revision_no, asset_id, created_ms)"
            " VALUES ('bnd_ffffffffffffffffffffffff', 1, NULL, 1)"
        )
    conn.execute(
        "INSERT INTO avatar_revision (binding_id, revision_no, asset_id, created_ms)"
        f" VALUES ('bnd_{3:024x}', 3, NULL, 9)"
    )
    with pytest.raises(sqlite3.DatabaseError, match="out of sequence"):
        conn.execute(
            "INSERT INTO avatar_revision (binding_id, revision_no, asset_id, created_ms)"
            f" VALUES ('bnd_{3:024x}', 9, NULL, 9)"
        )
    conn.close()


def add_binding(conn: sqlite3.Connection, n: int) -> str:
    store_id = conn.execute("SELECT store_id FROM store_meta").fetchone()[0]
    binding = f"bnd_{n:024x}"
    conn.execute(
        "INSERT INTO bot_binding (binding_id, installation_id, dm_key, member_id,"
        " memory_store, first_seen_ms) VALUES (?, ?, ?, ?, '', 1)",
        (binding, store_id, f"member-m{n}", f"m{n}"),
    )
    return binding


@pytest.mark.parametrize(
    ("hero", "ordinal", "number", "by"),
    [
        ("nova", 1, 2, "picked"),  # not one of the eleven
        ("vell", 1, 2, "picked"),  # vell already has ordinal 1
        ("reeve", 2, 2, "picked"),  # the first holder of reeve is ordinal 1
        ("stitch", 1, 5, "picked"),  # assignment number out of sequence
        ("stitch", 1, 2, "manual"),  # unknown provenance
        ("stitch", 0, 2, "picked"),
    ],
)
def test_the_rebuilt_table_rejects_rows_that_break_its_rules(
    tmp_path: Path, hero: str, ordinal: int, number: int, by: str
) -> None:
    conn = seeded_v10(tmp_path / "v10.db", 2)
    migrate(conn, ALL[:11])
    binding = add_binding(conn, 9)
    with pytest.raises(sqlite3.DatabaseError):
        conn.execute(
            "INSERT INTO hero_assignment VALUES (?, ?, ?, ?, 1, ?)",
            (binding, number, hero, ordinal, by),
        )
    conn.close()


def test_the_rebuilt_table_accepts_any_hero_and_a_per_hero_ordinal(tmp_path: Path) -> None:
    conn = seeded_v10(tmp_path / "v10.db", 2)
    migrate(conn, ALL[:11])
    for step, hero in enumerate(("bur", "bur", "reeve")):
        binding = add_binding(conn, 20 + step)
        ordinal = 2 if step == 1 else 1
        conn.execute(
            "INSERT INTO hero_assignment VALUES (?, ?, ?, ?, 1, 'picked')",
            (binding, 2 + step, hero, ordinal),
        )
    assert [
        r[0] for r in conn.execute("SELECT ordinal FROM hero_assignment ORDER BY assignment_no")
    ] == [1, 1, 1, 2, 1]
    conn.close()


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE hero_assignment SET hero_id = 'vell'",
        "UPDATE hero_assignment SET assigned_by = 'random'",
        "DELETE FROM hero_assignment",
        "UPDATE avatar_revision SET asset_id = NULL",
        "DELETE FROM avatar_revision",
    ],
)
def test_the_rebuilt_tables_stay_append_only(tmp_path: Path, statement: str) -> None:
    conn = seeded_v10(tmp_path / "v10.db", 5)
    migrate(conn, ALL[:11])
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):
        conn.execute(statement)
    conn.close()


def test_an_empty_store_migrates_and_a_new_binding_may_start_without_a_hero(
    tmp_path: Path,
) -> None:
    conn = seeded_v10(tmp_path / "v10.db", 0)
    migrate(conn, ALL[:11])
    add_binding(conn, 1)
    assert conn.execute("SELECT count(*) FROM hero_assignment").fetchone() == (0,)
    conn.close()


def test_a_failure_inside_the_migration_leaves_the_store_at_version_ten(tmp_path: Path) -> None:
    conn = seeded_v10(tmp_path / "v10.db", 3)
    broken = make_migration(
        11, "hero_choice", MIGRATION_0011.sql + "\nSELECT * FROM no_such_table;\n"
    )
    before = digest(conn, "hero_assignment")
    with pytest.raises(MigrationError):
        migrate(conn, [*ALL[:10], broken])
    assert conn.execute("PRAGMA user_version").fetchone() == (10,)
    assert digest(conn, "hero_assignment") == before
    names = {str(n) for (n,) in conn.execute("SELECT name FROM sqlite_master")}
    assert "hero_assignment_new" not in names and "avatar_revision_new" not in names
    assert "asset_keep" in names
    conn.close()


def test_opening_a_ten_store_backs_it_up_and_migrates_it(tmp_path: Path) -> None:
    data = tmp_path / "data"
    (data / "store").mkdir(parents=True)
    conn = seeded_v10(data / "store" / "specter-arena.db", 3)
    conn.close()
    opened = open_store(data)
    try:
        assert opened.status() == StoreStatus("ready", latest_version(), latest_version())
        with opened.read() as reader:
            assert reader.execute("SELECT count(*) FROM hero_assignment").fetchone() == (3,)
    finally:
        opened.close()
    assert len(list((data / "store" / "backups").glob("pre-migrate-v10-to-v*.db"))) == 1


def test_the_sqlite_library_supports_the_rebuild() -> None:
    assert tuple(int(p) for p in sqlite3.sqlite_version.split(".")) >= (3, 26)
