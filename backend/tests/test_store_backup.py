import importlib
import os
import shutil
import sqlite3
import stat
from pathlib import Path

import pytest

from backend.specter_arena.store import (
    BackupError,
    RestoreError,
    SchemaNewer,
    StoreStatus,
    backup,
    open_store,
    restore,
)
from backend.specter_arena.store import store as store_module
from backend.specter_arena.store.backup import copy_database, prune_pre_migration
from backend.specter_arena.store.migrate import load_migrations, make_migration

# The package re-exports the `backup` function under the same name as this module.
backup_module = importlib.import_module("backend.specter_arena.store.backup")


REAL = load_migrations()
FIXTURE_V1 = Path(__file__).resolve().parent / "fixtures" / "store" / "schema-v1.sql"
FIXTURE_STORE_ID = "00000000-0000-4000-8000-000000000001"


NOTES = make_migration(
    2, "notes", "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL) STRICT;\n"
)
WITH_NOTES = (*REAL, NOTES)


def data_dir_in(root: Path) -> Path:
    return root / "home" / "apps" / "specter-arena" / "data"


def db_file(data_dir: Path) -> Path:
    return data_dir / "store" / "specter-arena.db"


def mode(path: Path) -> int:
    return stat.S_IMODE(path.stat().st_mode)


def read_one(path: Path, sql: str) -> object:
    conn = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
    try:
        return conn.execute(sql).fetchone()
    finally:
        conn.close()


def store_with_notes(data_dir: Path, *bodies: str) -> None:
    opened = open_store(data_dir, migrations=WITH_NOTES)
    with opened.write() as conn:
        conn.executemany("INSERT INTO notes (body) VALUES (?)", [(b,) for b in bodies])
    opened.close()


def place_fixture_v1(data_dir: Path) -> None:
    (data_dir / "store").mkdir(parents=True)
    conn = sqlite3.connect(db_file(data_dir), isolation_level=None)
    conn.executescript(FIXTURE_V1.read_text(encoding="utf-8"))
    conn.close()


def pre_migration_files(data_dir: Path) -> list[Path]:
    return sorted((data_dir / "store" / "backups").glob("pre-migrate-*.db"))


def test_a_backup_of_a_live_wal_store_is_one_verified_owner_only_file(tmp_path: Path) -> None:
    data_dir = data_dir_in(tmp_path)
    opened = open_store(data_dir, migrations=WITH_NOTES)
    with opened.write() as conn:
        conn.executemany("INSERT INTO notes (body) VALUES (?)", [("a",), ("b",), ("c",)])
    dest = tmp_path / "backups"
    try:
        made = backup(opened, dest)
    finally:
        opened.close()
    assert made.parent == dest
    assert made.name.startswith("backup-v2-") and made.suffix == ".db"
    assert read_one(made, "SELECT count(*) FROM notes") == (3,)
    assert read_one(made, "PRAGMA user_version") == (2,)
    assert read_one(made, "PRAGMA journal_mode") == ("delete",)
    assert read_one(made, "PRAGMA integrity_check") == ("ok",)
    assert sorted(p.name for p in dest.iterdir()) == [made.name]
    if os.name == "posix":
        assert mode(made) == 0o600
        assert mode(dest) == 0o700


def test_a_failed_copy_leaves_no_partial_file(tmp_path: Path) -> None:
    dest = tmp_path / "backups"
    with pytest.raises(BackupError) as caught:
        copy_database(tmp_path / "missing.db", dest, "copy.db")
    assert isinstance(caught.value.__cause__, sqlite3.Error)
    assert list(dest.iterdir()) == []


def corrupt_a_page(path: Path) -> None:
    conn = sqlite3.connect(path, isolation_level=None)
    conn.execute("PRAGMA journal_mode = DELETE")
    conn.execute("CREATE TABLE filler (body TEXT)")
    conn.executemany("INSERT INTO filler VALUES (?)", [("x" * 200,) for _ in range(500)])
    page_size = conn.execute("PRAGMA page_size").fetchone()[0]
    conn.close()
    with path.open("r+b") as handle:
        handle.seek(page_size * 3)
        handle.write(b"\xff" * page_size)


def break_an_index(path: Path) -> None:
    """Pages stay readable and quick_check passes, but the index no longer matches its table."""
    conn = sqlite3.connect(path, isolation_level=None)
    conn.execute("CREATE TABLE t (a INTEGER)")
    conn.execute("CREATE INDEX i ON t (a)")
    conn.executemany("INSERT INTO t VALUES (?)", [(n,) for n in range(50)])
    conn.execute("PRAGMA writable_schema = ON")
    conn.execute("UPDATE sqlite_master SET sql = 'CREATE INDEX i ON t (-a)' WHERE name = 'i'")
    conn.close()


def test_a_copy_that_fails_verification_is_discarded(tmp_path: Path) -> None:
    source = tmp_path / "inconsistent.db"
    break_an_index(source)
    dest = tmp_path / "backups"
    with pytest.raises(BackupError) as caught:
        copy_database(source, dest, "copy.db")
    assert caught.value.__cause__ is None
    assert list(dest.iterdir()) == []


def test_the_previous_schema_upgrade_takes_a_pre_migration_backup(tmp_path: Path) -> None:
    data_dir = data_dir_in(tmp_path)
    place_fixture_v1(data_dir)
    opened = open_store(data_dir, migrations=WITH_NOTES)
    try:
        assert opened.status() == StoreStatus("ready", 2, 2)
        with opened.read() as conn:
            assert conn.execute("SELECT store_id FROM store_meta").fetchone() == (FIXTURE_STORE_ID,)
    finally:
        opened.close()
    (taken,) = pre_migration_files(data_dir)
    assert taken.name.startswith("pre-migrate-v1-to-v2-")
    assert read_one(taken, "PRAGMA user_version") == (1,)
    assert read_one(taken, "SELECT store_id FROM store_meta") == (FIXTURE_STORE_ID,)
    if os.name == "posix":
        assert mode(taken) == 0o600
        assert mode(taken.parent) == 0o700


def test_a_store_with_nothing_pending_takes_no_backup(tmp_path: Path) -> None:
    data_dir = data_dir_in(tmp_path)
    open_store(data_dir).close()
    open_store(data_dir).close()
    assert not (data_dir / "store" / "backups").exists()


def test_a_failed_pre_migration_backup_aborts_the_migration(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    data_dir = data_dir_in(tmp_path)
    place_fixture_v1(data_dir)

    def refuse(*_args: object) -> Path:
        raise BackupError

    monkeypatch.setattr(store_module, "pre_migration_backup", refuse)
    with pytest.raises(BackupError):
        open_store(data_dir, migrations=WITH_NOTES)
    assert read_one(db_file(data_dir), "PRAGMA user_version") == (1,)


def test_successive_upgrades_keep_the_newest_three_pre_migration_backups(tmp_path: Path) -> None:
    data_dir = data_dir_in(tmp_path)
    migrations = list(REAL)
    open_store(data_dir, migrations=migrations).close()
    for version in range(2, 7):
        migrations.append(
            make_migration(version, f"t{version}", f"CREATE TABLE t{version} (id INTEGER);")
        )
        open_store(data_dir, migrations=migrations).close()
    names = [p.name.split("-")[2:4] for p in pre_migration_files(data_dir)]
    assert names == [["v3", "to"], ["v4", "to"], ["v5", "to"]]


def test_pruning_only_ever_deletes_old_pre_migration_backups(tmp_path: Path) -> None:
    for stamp in ["20260101T000000000001Z", "20260101T000000000002Z", "20260101T000000000003Z"]:
        (tmp_path / f"pre-migrate-v1-to-v2-{stamp}.db").write_text("")
    kept = ["backup-v1-20250101T000000000000Z.db", "pre-migrate-notes.db", "other.txt"]
    for name in kept:
        (tmp_path / name).write_text("")
    (tmp_path / "pre-migrate-v1-to-v2-20240101T000000000000Z.db").mkdir()
    prune_pre_migration(tmp_path, 1)
    remaining = sorted(p.name for p in tmp_path.iterdir())
    assert remaining == sorted(
        [
            *kept,
            "pre-migrate-v1-to-v2-20240101T000000000000Z.db",
            "pre-migrate-v1-to-v2-20260101T000000000003Z.db",
        ]
    )


def take_backup(data_dir: Path, dest: Path) -> Path:
    opened = open_store(data_dir, migrations=WITH_NOTES)
    try:
        return backup(opened, dest)
    finally:
        opened.close()


def test_restore_refuses_while_the_store_is_open(tmp_path: Path) -> None:
    data_dir = data_dir_in(tmp_path)
    store_with_notes(data_dir, "live")
    copy = take_backup(data_dir, tmp_path / "saved")
    opened = open_store(data_dir, migrations=WITH_NOTES)
    try:
        with opened.read() as conn:
            conn.execute("SELECT 1").fetchone()
        with pytest.raises(RestoreError):
            restore(copy, data_dir, migrations=WITH_NOTES)
        with opened.read() as conn:
            assert conn.execute("SELECT body FROM notes").fetchall() == [("live",)]
    finally:
        opened.close()
    assert sorted(p.name for p in (data_dir / "store").iterdir() if "restore" in p.name) == []


def test_restore_replaces_a_closed_store_and_keeps_the_old_file(tmp_path: Path) -> None:
    data_dir = data_dir_in(tmp_path)
    store_with_notes(data_dir, "one", "two", "three")
    copy = take_backup(data_dir, tmp_path / "saved")
    db_file(data_dir).unlink()
    store_with_notes(data_dir, "replaced")
    aside = restore(copy, data_dir, migrations=WITH_NOTES)
    assert aside is not None
    assert aside.name.startswith("specter-arena.db.pre-restore-")
    assert read_one(aside, "SELECT body FROM notes") == ("replaced",)
    opened = open_store(data_dir, migrations=WITH_NOTES)
    try:
        with opened.read() as conn:
            assert conn.execute("SELECT count(*) FROM notes").fetchone() == (3,)
    finally:
        opened.close()
    if os.name == "posix":
        assert mode(db_file(data_dir)) == 0o600


def test_restore_without_a_live_database_returns_none(tmp_path: Path) -> None:
    source = data_dir_in(tmp_path / "a")
    store_with_notes(source, "x")
    copy = take_backup(source, tmp_path / "saved")
    target = data_dir_in(tmp_path / "b")
    assert restore(copy, target, migrations=WITH_NOTES) is None
    assert read_one(db_file(target), "SELECT body FROM notes") == ("x",)


def test_an_older_backup_restores_and_then_migrates_forward(tmp_path: Path) -> None:
    data_dir = data_dir_in(tmp_path)
    opened = open_store(data_dir)
    v1_copy = backup(opened, tmp_path / "saved")
    opened.close()
    shutil.rmtree(data_dir / "store")
    assert restore(v1_copy, data_dir) is None
    upgraded = open_store(data_dir, migrations=WITH_NOTES)
    try:
        assert upgraded.status() == StoreStatus("ready", 2, 2)
    finally:
        upgraded.close()
    assert len(pre_migration_files(data_dir)) == 1


def test_restore_over_a_damaged_live_database_is_allowed(tmp_path: Path) -> None:
    data_dir = data_dir_in(tmp_path)
    store_with_notes(data_dir, "good")
    copy = take_backup(data_dir, tmp_path / "saved")
    db_file(data_dir).write_bytes(b"not a database " * 300)
    aside = restore(copy, data_dir, migrations=WITH_NOTES)
    assert aside is not None and aside.read_bytes().startswith(b"not a database")
    assert read_one(db_file(data_dir), "SELECT body FROM notes") == ("good",)


def edit_copy(source: Path, target: Path, *statements: str) -> Path:
    shutil.copyfile(source, target)
    conn = sqlite3.connect(target, isolation_level=None)
    for statement in statements:
        conn.execute(statement)
    conn.close()
    return target


@pytest.mark.parametrize(
    ("statements", "error"),
    [
        (("PRAGMA user_version = 9",), SchemaNewer),
        (("PRAGMA user_version = 0",), RestoreError),
        (("UPDATE schema_migrations SET sha256 = replace(sha256, 'f', 'e')",), RestoreError),
        (("DROP TABLE schema_migrations",), RestoreError),
    ],
)
def test_restore_refuses_a_backup_that_does_not_verify(
    tmp_path: Path, statements: tuple[str, ...], error: type[Exception]
) -> None:
    data_dir = data_dir_in(tmp_path)
    store_with_notes(data_dir, "live")
    good = take_backup(data_dir, tmp_path / "saved")
    bad = edit_copy(good, tmp_path / "bad.db", *statements)
    before = db_file(data_dir).read_bytes()
    with pytest.raises(error):
        restore(bad, data_dir, migrations=WITH_NOTES)
    assert db_file(data_dir).read_bytes() == before


@pytest.mark.parametrize("content", [None, b"not a database " * 300])
def test_restore_refuses_a_missing_or_unreadable_backup(
    tmp_path: Path, content: bytes | None
) -> None:
    candidate = tmp_path / "candidate.db"
    if content is not None:
        candidate.write_bytes(content)
    with pytest.raises(RestoreError):
        restore(candidate, data_dir_in(tmp_path))
    assert not data_dir_in(tmp_path).exists()


def test_restore_refuses_a_damaged_backup(tmp_path: Path) -> None:
    candidate = tmp_path / "damaged.db"
    corrupt_a_page(candidate)
    with pytest.raises(RestoreError):
        restore(candidate, data_dir_in(tmp_path))


def test_restore_reports_a_staging_failure(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    data_dir = data_dir_in(tmp_path)
    store_with_notes(data_dir, "x")
    copy = take_backup(data_dir, tmp_path / "saved")

    def refuse(*_args: object) -> Path:
        raise BackupError

    monkeypatch.setattr(backup_module, "copy_database", refuse)
    with pytest.raises(RestoreError):
        restore(copy, data_dir, migrations=WITH_NOTES)


def test_a_failed_final_rename_puts_the_old_database_back(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    data_dir = data_dir_in(tmp_path)
    store_with_notes(data_dir, "original")
    copy = take_backup(data_dir, tmp_path / "saved")
    live = db_file(data_dir)
    real_replace = os.replace

    def failing_replace(src: str | os.PathLike[str], dst: str | os.PathLike[str]) -> None:
        if Path(dst) == live and Path(src).name.startswith(".restore-"):
            raise OSError("disk full")
        real_replace(src, dst)

    monkeypatch.setattr(backup_module.os, "replace", failing_replace)
    with pytest.raises(RestoreError):
        restore(copy, data_dir, migrations=WITH_NOTES)
    monkeypatch.undo()
    assert read_one(live, "SELECT body FROM notes") == ("original",)
    assert [p.name for p in live.parent.iterdir() if p.name.startswith(".restore-")] == []
