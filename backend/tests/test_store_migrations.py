import hashlib
import re
import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest

from backend.specter_arena.store import (
    ChecksumMismatch,
    MigrationError,
    MigrationFileError,
    SchemaNewer,
    latest_version,
)
from backend.specter_arena.store import migrate as migrate_module
from backend.specter_arena.store.migrate import (
    MIGRATIONS_DIR,
    Migration,
    check_sequence,
    current_version,
    load_migrations,
    make_migration,
    migrate,
    packaged_migrations,
    pending,
    split_statements,
    validate,
    verify_checksums,
)

# Pinning the hash freezes 0001: once released, an edit must fail here before it reaches a store.
BASELINE_SHA256 = "fef6c7529554b4a1d2179f1e177f59b09335d65a998611aefea01de17255e570"
FIXTURE_V1 = Path(__file__).resolve().parent / "fixtures" / "store" / "schema-v1.sql"
FIXTURE_STORE_ID = "00000000-0000-4000-8000-000000000001"
UUID_V4 = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")

REAL = load_migrations()
SYNTHETIC_0002 = make_migration(
    2,
    "notes",
    "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL) STRICT;\n"
    "INSERT INTO notes (body) VALUES ('seeded by 0002');\n",
)


def connect(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(path, isolation_level=None)


@pytest.fixture
def conn(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    connection = connect(tmp_path / "store.db")
    yield connection
    connection.close()


def load_fixture_v1(path: Path) -> None:
    connection = connect(path)
    try:
        connection.executescript(FIXTURE_V1.read_text(encoding="utf-8"))
    finally:
        connection.close()


def tables(connection: sqlite3.Connection) -> set[str]:
    rows = connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    return {name for (name,) in rows}


def schema(connection: sqlite3.Connection) -> list[tuple[str, str, str]]:
    rows = connection.execute("SELECT type, name, sql FROM sqlite_master ORDER BY type, name")
    return [(kind, name, " ".join((sql or "").split())) for kind, name, sql in rows]


def test_an_empty_store_migrates_to_the_latest_version(conn: sqlite3.Connection) -> None:
    assert current_version(conn) == 0
    assert migrate(conn, REAL, now=lambda: "2026-11-14T00:00:00Z") == latest_version() == 1
    assert tables(conn) == {"schema_migrations", "store_meta"}
    assert conn.execute(
        "SELECT version, name, sha256, applied_at FROM schema_migrations"
    ).fetchall() == [(1, "baseline", BASELINE_SHA256, "2026-11-14T00:00:00Z")]
    ((store_id, created_at, family),) = conn.execute(
        "SELECT store_id, created_at, app_schema_family FROM store_meta"
    ).fetchall()
    assert UUID_V4.fullmatch(store_id)
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", created_at)
    assert family == "specter-arena"


def test_migrating_an_up_to_date_store_changes_nothing(conn: sqlite3.Connection) -> None:
    migrate(conn, REAL)
    before = conn.execute("SELECT store_id FROM store_meta").fetchall()
    assert pending(conn, REAL) == []
    assert migrate(conn, REAL) == 1
    assert conn.execute("SELECT store_id FROM store_meta").fetchall() == before


def test_the_baseline_migration_is_frozen() -> None:
    assert [(m.version, m.name) for m in REAL] == [(1, "baseline")]
    assert REAL[0].sha256 == BASELINE_SHA256
    raw = (MIGRATIONS_DIR / "0001_baseline.sql").read_bytes()
    assert hashlib.sha256(raw.replace(b"\r\n", b"\n")).hexdigest() == BASELINE_SHA256


def test_the_frozen_fixture_has_the_schema_the_baseline_creates(tmp_path: Path) -> None:
    load_fixture_v1(tmp_path / "fixture.db")
    fixture = connect(tmp_path / "fixture.db")
    migrated = connect(tmp_path / "migrated.db")
    try:
        migrate(migrated, REAL)
        assert schema(fixture) == schema(migrated)
        assert current_version(fixture) == current_version(migrated) == 1
    finally:
        fixture.close()
        migrated.close()


def test_the_frozen_fixture_passes_the_checksum_audit(tmp_path: Path) -> None:
    load_fixture_v1(tmp_path / "fixture.db")
    fixture = connect(tmp_path / "fixture.db")
    try:
        verify_checksums(fixture, REAL)
        assert pending(fixture, REAL) == []
    finally:
        fixture.close()


def test_the_previous_test_schema_upgrades_with_its_rows_kept(tmp_path: Path) -> None:
    load_fixture_v1(tmp_path / "store.db")
    connection = connect(tmp_path / "store.db")
    try:
        assert migrate(connection, (*REAL, SYNTHETIC_0002)) == 2
        assert connection.execute("SELECT store_id, created_at FROM store_meta").fetchall() == [
            (FIXTURE_STORE_ID, "2026-01-01T00:00:00Z")
        ]
        assert connection.execute("SELECT version, name FROM schema_migrations").fetchall() == [
            (1, "baseline"),
            (2, "notes"),
        ]
        assert connection.execute("SELECT body FROM notes").fetchall() == [("seeded by 0002",)]
    finally:
        connection.close()


def test_a_failing_migration_rolls_back_completely(conn: sqlite3.Connection) -> None:
    migrate(conn, (*REAL, SYNTHETIC_0002))
    broken = make_migration(
        3,
        "broken",
        "CREATE TABLE half_done (id INTEGER PRIMARY KEY);\nINSERT INTO missing VALUES (1);\n",
    )
    with pytest.raises(MigrationError) as caught:
        migrate(conn, (*REAL, SYNTHETIC_0002, broken))
    assert isinstance(caught.value.__cause__, sqlite3.Error)
    assert "missing" not in str(caught.value)
    assert not conn.in_transaction
    assert current_version(conn) == 2
    assert "half_done" not in tables(conn)
    assert conn.execute("SELECT max(version) FROM schema_migrations").fetchone() == (2,)


def test_an_edited_applied_migration_fails_the_checksum(conn: sqlite3.Connection) -> None:
    migrate(conn, REAL)
    edited = make_migration(1, "baseline", REAL[0].sql + "\n-- edited after release\n")
    with pytest.raises(ChecksumMismatch):
        migrate(conn, (edited,))


def test_a_missing_history_row_fails_the_checksum(conn: sqlite3.Connection) -> None:
    migrate(conn, (*REAL, SYNTHETIC_0002))
    conn.execute("DELETE FROM schema_migrations WHERE version = 2")
    with pytest.raises(ChecksumMismatch):
        verify_checksums(conn, (*REAL, SYNTHETIC_0002))


def test_an_unmigrated_file_has_no_history_to_audit(conn: sqlite3.Connection) -> None:
    verify_checksums(conn, REAL)
    assert tables(conn) == set()


def test_an_unreadable_history_is_a_migration_error(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA user_version = 1")
    with pytest.raises(MigrationError) as caught:
        migrate(conn, REAL)
    assert not isinstance(caught.value, ChecksumMismatch)
    assert isinstance(caught.value.__cause__, sqlite3.Error)


def test_the_checksum_ignores_line_endings() -> None:
    lf = make_migration(1, "x", "CREATE TABLE a (id INTEGER);\nCREATE TABLE b (id INTEGER);\n")
    crlf = make_migration(
        1, "x", "CREATE TABLE a (id INTEGER);\r\nCREATE TABLE b (id INTEGER);\r\n"
    )
    cr = make_migration(1, "x", "CREATE TABLE a (id INTEGER);\rCREATE TABLE b (id INTEGER);\r")
    assert lf.sha256 == crlf.sha256 == cr.sha256
    assert crlf.sql == lf.sql


def test_a_newer_database_is_refused_and_left_byte_identical(tmp_path: Path) -> None:
    path = tmp_path / "store.db"
    seed = connect(path)
    migrate(seed, REAL)
    seed.execute("PRAGMA user_version = 9")
    seed.close()
    before = path.read_bytes()
    connection = connect(path)
    try:
        with pytest.raises(SchemaNewer) as caught:
            migrate(connection, REAL)
        assert caught.value.code == "schema-newer"
        with pytest.raises(SchemaNewer):
            pending(connection, REAL)
    finally:
        connection.close()
    assert path.read_bytes() == before
    assert sorted(p.name for p in tmp_path.iterdir()) == ["store.db"]


def test_a_second_opener_skips_a_version_another_opener_applied(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    first = connect(tmp_path / "store.db")
    second = connect(tmp_path / "store.db")
    try:
        stale = pending(second, REAL)
        migrate(first, REAL)
        monkeypatch.setattr(migrate_module, "pending", lambda _conn, _migrations: stale)
        assert migrate(second, REAL) == 1
        assert not second.in_transaction
        assert second.execute("SELECT count(*) FROM schema_migrations").fetchone() == (1,)
    finally:
        first.close()
        second.close()


TRIGGER_SQL = """\
-- an append-only table, the shape Pass 2 evidence tables will take
CREATE TABLE events (id INTEGER PRIMARY KEY, body TEXT NOT NULL) STRICT;

CREATE TRIGGER events_append_only BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(ABORT, 'append-only');
END;
"""


def test_a_trigger_stays_one_statement_and_applies(conn: sqlite3.Connection) -> None:
    statements = split_statements(TRIGGER_SQL)
    assert len(statements) == 2
    assert statements[1].startswith("CREATE TRIGGER") and statements[1].endswith("END;")
    migrate(conn, (*REAL, make_migration(2, "events", TRIGGER_SQL)))
    conn.execute("INSERT INTO events (body) VALUES ('a')")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("UPDATE events SET body = 'b'")


def test_comment_only_chunks_are_dropped() -> None:
    assert split_statements("-- lead\nCREATE TABLE a (id INTEGER);\n-- trailing note\n") == [
        "-- lead\nCREATE TABLE a (id INTEGER);"
    ]


@pytest.mark.parametrize(
    "sql",
    [
        "",
        "\n\n",
        "-- only a comment\n",
        "CREATE TABLE a (id INTEGER)",
        "CREATE TABLE a (id INTEGER);\nCREATE TABLE b (",
    ],
)
def test_an_empty_or_unterminated_migration_is_rejected(sql: str) -> None:
    with pytest.raises(MigrationFileError):
        validate(make_migration(1, "x", sql))


@pytest.mark.parametrize(
    "statement",
    [
        "BEGIN;",
        "begin immediate;",
        "COMMIT;",
        "END;",
        "ROLLBACK;",
        "SAVEPOINT s;",
        "RELEASE s;",
        "PRAGMA user_version = 7;",
        "-- harmless comment\n  pragma foreign_keys = OFF;",
        "ATTACH DATABASE 'other.db' AS other;",
        "DETACH DATABASE other;",
        "VACUUM;",
    ],
)
def test_transaction_control_and_pragmas_are_rejected(statement: str) -> None:
    with pytest.raises(MigrationFileError):
        validate(make_migration(1, "x", f"CREATE TABLE a (id INTEGER);\n{statement}\n"))


def test_a_word_that_merely_starts_like_a_forbidden_one_is_allowed() -> None:
    assert len(validate(make_migration(1, "x", "CREATE TABLE endings (id INTEGER);\n"))) == 1


@pytest.mark.parametrize("versions", [[2], [1, 3], [1, 1], [0, 1]])
def test_migration_numbering_must_be_contiguous_from_one(versions: list[int]) -> None:
    migrations = [
        make_migration(v, f"m{i}", "CREATE TABLE t (id INTEGER);") for i, v in enumerate(versions)
    ]
    with pytest.raises(MigrationFileError):
        check_sequence(migrations)


def test_check_sequence_orders_by_version() -> None:
    later = make_migration(2, "b", "CREATE TABLE b (id INTEGER);")
    earlier = make_migration(1, "a", "CREATE TABLE a (id INTEGER);")
    assert [m.version for m in check_sequence([later, earlier])] == [1, 2]


@pytest.mark.parametrize(
    "name",
    ["1_x.sql", "0001_X.sql", "0001-x.sql", "0001_.sql", "0001_x.SQL.sql", f"0001_{'a' * 65}.sql"],
)
def test_a_badly_named_migration_file_is_rejected(tmp_path: Path, name: str) -> None:
    (tmp_path / name).write_text("CREATE TABLE a (id INTEGER);\n", encoding="utf-8")
    with pytest.raises(MigrationFileError):
        load_migrations(tmp_path)


def test_migration_files_load_in_version_order(tmp_path: Path) -> None:
    (tmp_path / "0002_second.sql").write_text("CREATE TABLE b (id INTEGER);\n", encoding="utf-8")
    (tmp_path / "0001_first.sql").write_text("CREATE TABLE a (id INTEGER);\r\n", encoding="utf-8")
    (tmp_path / "README.md").write_text("not a migration\n", encoding="utf-8")
    loaded = load_migrations(tmp_path)
    assert [(m.version, m.name) for m in loaded] == [(1, "first"), (2, "second")]
    assert loaded[0].sql == "CREATE TABLE a (id INTEGER);\n"


def test_latest_version_reads_the_packaged_files_once() -> None:
    assert packaged_migrations() is packaged_migrations()
    assert packaged_migrations() == load_migrations(MIGRATIONS_DIR)
    assert latest_version() == len(REAL)
    assert latest_version((*REAL, SYNTHETIC_0002)) == 2


def test_migration_is_a_frozen_value() -> None:
    migration = REAL[0]
    assert isinstance(migration, Migration)
    with pytest.raises(AttributeError):
        migration.version = 2  # type: ignore[misc]
