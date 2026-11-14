import os
import sqlite3
import stat
import threading
import time
from collections.abc import Iterator
from pathlib import Path

import pytest

from backend.specter_arena.store import (
    SchemaNewer,
    SqliteTooOld,
    Store,
    StoreClosed,
    StoreStatus,
    StoreUnavailable,
    StoreUsageError,
    open_store,
    status_for_error,
)
from backend.specter_arena.store import connection as connection_module
from backend.specter_arena.store.connection import connect, enable_wal, quick_check
from backend.specter_arena.store.migrate import load_migrations, make_migration

posix_only = pytest.mark.skipif(os.name != "posix", reason="file modes are POSIX-only")

REAL = load_migrations()
NOTES = make_migration(
    2, "notes", "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL) STRICT;\n"
)
WITH_NOTES = (*REAL, NOTES)


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    return tmp_path / "home" / "apps" / "specter-arena" / "data"


@pytest.fixture
def store(data_dir: Path) -> Iterator[Store]:
    opened = open_store(data_dir, migrations=WITH_NOTES)
    yield opened
    opened.close()


def db_file(data_dir: Path) -> Path:
    return data_dir / "store" / "specter-arena.db"


def mode(path: Path) -> int:
    return stat.S_IMODE(path.stat().st_mode)


def add_note(store: Store, body: str) -> None:
    with store.write() as conn:
        conn.execute("INSERT INTO notes (body) VALUES (?)", (body,))


def notes(store: Store) -> list[str]:
    with store.read() as conn:
        return [body for (body,) in conn.execute("SELECT body FROM notes ORDER BY id")]


def store_id(store: Store) -> str:
    with store.read() as conn:
        return str(conn.execute("SELECT store_id FROM store_meta").fetchone()[0])


def test_an_empty_store_opens_ready_at_the_latest_version(data_dir: Path) -> None:
    opened = open_store(data_dir)
    try:
        assert opened.status() == StoreStatus("ready", 1, 1)
        assert opened.db_path == db_file(data_dir)
        assert opened.backups_dir == data_dir / "store" / "backups"
        with opened.read() as conn:
            assert conn.execute("PRAGMA journal_mode").fetchone() == ("wal",)
            assert conn.execute("PRAGMA foreign_keys").fetchone() == (1,)
    finally:
        opened.close()
    assert not (data_dir / "store" / "backups").exists()


@posix_only
def test_the_store_files_are_owner_only(data_dir: Path) -> None:
    open_store(data_dir).close()
    assert mode(data_dir) == 0o700
    assert mode(data_dir / "store") == 0o700
    assert mode(db_file(data_dir)) == 0o600


def test_data_and_store_id_survive_a_restart(data_dir: Path) -> None:
    first = open_store(data_dir, migrations=WITH_NOTES)
    add_note(first, "kept across restart")
    original_id = store_id(first)
    first.close()
    second = open_store(data_dir, migrations=WITH_NOTES)
    try:
        assert notes(second) == ["kept across restart"]
        assert store_id(second) == original_id
        assert second.status() == StoreStatus("ready", 2, 2)
    finally:
        second.close()


def test_a_write_rolls_back_on_any_exception(store: Store) -> None:
    with pytest.raises(RuntimeError), store.write() as conn:
        conn.execute("INSERT INTO notes (body) VALUES ('lost')")
        raise RuntimeError("caller failed")
    assert notes(store) == []
    add_note(store, "after the rollback")
    assert notes(store) == ["after the rollback"]


def test_the_reader_refuses_writes(store: Store) -> None:
    with pytest.raises(sqlite3.OperationalError), store.read() as conn:
        conn.execute("INSERT INTO notes (body) VALUES ('nope')")
    assert notes(store) == []


def test_a_read_block_sees_one_snapshot(store: Store) -> None:
    add_note(store, "first")
    with store.read() as conn:
        before = conn.execute("SELECT count(*) FROM notes").fetchone()
        writer = threading.Thread(target=add_note, args=(store, "second"))
        writer.start()
        writer.join()
        assert conn.execute("SELECT count(*) FROM notes").fetchone() == before
    assert notes(store) == ["first", "second"]


def test_nested_access_on_one_thread_is_a_usage_error(store: Store) -> None:
    with store.write():
        with pytest.raises(StoreUsageError):
            store.write().__enter__()
        with pytest.raises(StoreUsageError):
            store.close()
    with store.read():
        with pytest.raises(StoreUsageError):
            store.read().__enter__()
        with pytest.raises(StoreUsageError):
            store.close()
    assert store.status().state == "ready"


def test_a_closed_store_refuses_use_and_reports_unavailable(store: Store) -> None:
    store.close()
    store.close()
    with pytest.raises(StoreClosed), store.write():
        pass
    with pytest.raises(StoreClosed), store.read():
        pass
    assert store.status() == StoreStatus("unavailable", None, 2)


def test_close_tolerates_a_failed_checkpoint(data_dir: Path) -> None:
    opened = open_store(data_dir)
    opened._writer.close()
    opened.close()
    assert opened.status().state == "unavailable"


def test_four_threads_writing_serialise(store: Store) -> None:
    def write_many(prefix: str) -> None:
        for n in range(50):
            add_note(store, f"{prefix}-{n}")

    threads = [threading.Thread(target=write_many, args=(f"t{i}",)) for i in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    written = notes(store)
    assert len(written) == len(set(written)) == 200


def test_status_does_not_wait_for_a_held_writer(store: Store) -> None:
    holding = threading.Event()
    release = threading.Event()

    def hold() -> None:
        with store.write():
            holding.set()
            release.wait(5)

    holder = threading.Thread(target=hold)
    holder.start()
    try:
        assert holding.wait(5)
        started = time.monotonic()
        assert store.status().state == "ready"
        assert time.monotonic() - started < 1
    finally:
        release.set()
        holder.join()


def lock_from_another_connection(data_dir: Path) -> sqlite3.Connection:
    other = sqlite3.connect(db_file(data_dir), isolation_level=None)
    other.execute("BEGIN IMMEDIATE")
    return other


def test_a_write_times_out_behind_another_process(
    data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(connection_module, "BUSY_TIMEOUT_S", 0.2)
    opened = open_store(data_dir)
    other = lock_from_another_connection(data_dir)
    try:
        started = time.monotonic()
        with pytest.raises(sqlite3.OperationalError), opened.write():
            pass
        assert time.monotonic() - started < 3
        assert opened.status().state == "unavailable"
    finally:
        other.execute("ROLLBACK")
        other.close()
    assert opened.status().state == "ready"
    opened.close()


def test_a_newer_database_is_refused_untouched(data_dir: Path) -> None:
    open_store(data_dir).close()
    seed = sqlite3.connect(db_file(data_dir), isolation_level=None)
    seed.execute("PRAGMA journal_mode = DELETE")
    seed.execute("PRAGMA user_version = 9")
    seed.close()
    before = db_file(data_dir).read_bytes()
    with pytest.raises(SchemaNewer) as caught:
        open_store(data_dir)
    assert status_for_error(caught.value, 9) == StoreStatus("schema-newer", 9, 1)
    assert db_file(data_dir).read_bytes() == before
    assert sorted(p.name for p in (data_dir / "store").iterdir()) == ["specter-arena.db"]


def test_a_file_that_is_not_a_database_is_unavailable(data_dir: Path) -> None:
    (data_dir / "store").mkdir(parents=True)
    db_file(data_dir).write_bytes(b"not a database " * 300)
    with pytest.raises(StoreUnavailable) as caught:
        open_store(data_dir)
    assert isinstance(caught.value.__cause__, sqlite3.DatabaseError)
    assert status_for_error(caught.value).state == "unavailable"


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


def test_a_damaged_database_fails_the_integrity_check(data_dir: Path) -> None:
    open_store(data_dir).close()
    corrupt_a_page(db_file(data_dir))
    with pytest.raises(StoreUnavailable):
        open_store(data_dir)


def test_an_old_sqlite_is_refused_before_anything_is_created(
    data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(sqlite3, "sqlite_version_info", (3, 36, 0))
    with pytest.raises(SqliteTooOld):
        open_store(data_dir)
    assert not data_dir.exists()


def test_an_unwritable_location_is_unavailable(tmp_path: Path) -> None:
    blocker = tmp_path / "data"
    blocker.write_text("")
    with pytest.raises(StoreUnavailable):
        open_store(blocker)


def test_connect_reports_a_file_it_cannot_open(tmp_path: Path) -> None:
    with pytest.raises(StoreUnavailable) as caught:
        connect(tmp_path / "missing" / "x.db", read_only=False)
    assert isinstance(caught.value.__cause__, sqlite3.Error)


class FakeConnection:
    def __init__(self, *answers: object) -> None:
        self.answers = list(answers)

    def execute(self, _sql: str) -> "FakeConnection":
        answer = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        if isinstance(answer, BaseException):
            raise answer
        self.row = answer
        return self

    def fetchone(self) -> object:
        return self.row

    def fetchall(self) -> object:
        return self.row


def test_enable_wal_retries_until_the_mode_switches() -> None:
    busy = sqlite3.OperationalError("database is locked")
    fake = FakeConnection(busy, ("delete",), ("delete",), ("wal",))
    enable_wal(fake, deadline_s=5)  # type: ignore[arg-type]


def test_enable_wal_gives_up_at_the_deadline() -> None:
    with pytest.raises(StoreUnavailable):
        enable_wal(FakeConnection(("delete",)), deadline_s=0)  # type: ignore[arg-type]


def test_quick_check_rejects_any_answer_but_ok() -> None:
    with pytest.raises(StoreUnavailable):
        quick_check(FakeConnection([("*** in database main ***",)]))  # type: ignore[arg-type]
    with pytest.raises(StoreUnavailable):
        quick_check(FakeConnection(sqlite3.DatabaseError("malformed")))  # type: ignore[arg-type]
