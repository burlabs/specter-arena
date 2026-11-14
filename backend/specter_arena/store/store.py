from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterator, Sequence
from contextlib import contextmanager, suppress
from pathlib import Path

from .backup import KEEP_PRE_MIGRATION, pre_migration_backup
from .connection import connect, enable_wal, quick_check
from .errors import SchemaNewer, StoreClosed, StoreUnavailable, StoreUsageError
from .location import (
    BACKUPS_DIRNAME,
    check_sqlite_version,
    db_path,
    ensure_private_dir,
    precreate_private_file,
    store_dir,
)
from .migrate import (
    Migration,
    check_sequence,
    current_version,
    migrate,
    packaged_migrations,
    pending,
)
from .status import StoreState, StoreStatus


class Store:
    """One writer and one `query_only` reader connection, each behind its own lock.

    The API is synchronous; async callers use `asyncio.to_thread`. Calling it from the event loop
    would block the loop for as long as SQLite waits on a lock.
    """

    def __init__(
        self, path: Path, writer: sqlite3.Connection, reader: sqlite3.Connection, latest: int
    ) -> None:
        self._path = path
        self._writer = writer
        self._reader = reader
        self._latest = latest
        self._write_lock = threading.Lock()
        self._read_lock = threading.Lock()
        self._write_owner: int | None = None
        self._read_owner: int | None = None
        self._closed = False

    @property
    def db_path(self) -> Path:
        return self._path

    @property
    def backups_dir(self) -> Path:
        return self._path.parent / BACKUPS_DIRNAME

    @contextmanager
    def write(self) -> Iterator[sqlite3.Connection]:
        """`BEGIN IMMEDIATE` ... `COMMIT`, rolled back on any exception. Not re-entrant."""
        self._refuse_nesting(self._write_owner)
        with self._write_lock:
            self._refuse_if_closed()
            self._write_owner = threading.get_ident()
            try:
                self._writer.execute("BEGIN IMMEDIATE")
                try:
                    yield self._writer
                    self._writer.execute("COMMIT")
                except BaseException:
                    if self._writer.in_transaction:
                        self._writer.execute("ROLLBACK")
                    raise
            finally:
                self._write_owner = None

    @contextmanager
    def read(self) -> Iterator[sqlite3.Connection]:
        """A deferred transaction on the reader: every statement in the block sees one snapshot."""
        self._refuse_nesting(self._read_owner)
        with self._read_lock:
            self._refuse_if_closed()
            self._read_owner = threading.get_ident()
            try:
                self._reader.execute("BEGIN")
                try:
                    yield self._reader
                finally:
                    if self._reader.in_transaction:
                        self._reader.execute("ROLLBACK")
            finally:
                self._read_owner = None

    def status(self) -> StoreStatus:
        if self._closed:
            return StoreStatus("unavailable", None, self._latest)
        try:
            with self.read() as conn:
                conn.execute("SELECT 1").fetchone()
                version = current_version(conn)
            # A held writer lock is itself evidence the writer is alive; readiness must not queue
            # behind a long write.
            if self._write_lock.acquire(blocking=False):
                try:
                    self._writer.execute("BEGIN IMMEDIATE")
                    self._writer.execute("ROLLBACK")
                finally:
                    self._write_lock.release()
        except (sqlite3.Error, StoreClosed):
            return StoreStatus("unavailable", None, self._latest)
        state: StoreState = "ready" if version == self._latest else "unavailable"
        return StoreStatus(state, version, self._latest)

    def close(self) -> None:
        self._refuse_nesting(self._write_owner)
        self._refuse_nesting(self._read_owner)
        with self._write_lock, self._read_lock:
            if self._closed:
                return
            self._closed = True
            with suppress(sqlite3.Error):
                self._writer.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            self._reader.close()
            self._writer.close()

    def _refuse_nesting(self, owner: int | None) -> None:
        if owner == threading.get_ident():
            raise StoreUsageError("nested store access on one thread")

    def _refuse_if_closed(self) -> None:
        if self._closed:
            raise StoreClosed


def open_store(
    data_dir: Path,
    *,
    migrations: Sequence[Migration] | None = None,
    keep_backups: int = KEEP_PRE_MIGRATION,
) -> Store:
    """Open the store under `data_dir`, creating it owner-only and migrating it forward.

    A database newer than this code is refused before anything writes to it. A non-empty
    database is backed up before any pending migration; if that backup fails, nothing migrates.
    Every failure is a `StoreError`.
    """
    check_sqlite_version()
    chosen = packaged_migrations() if migrations is None else check_sequence(migrations)
    ensure_private_dir(data_dir)
    ensure_private_dir(store_dir(data_dir))
    path = db_path(data_dir)
    precreate_private_file(path)
    writer = connect(path, read_only=False)
    try:
        version = current_version(writer)
        if version > len(chosen):
            raise SchemaNewer
        enable_wal(writer)
        quick_check(writer)
        if version > 0 and pending(writer, chosen):
            pre_migration_backup(path, version, len(chosen), keep_backups)
        migrate(writer, chosen)
        reader = connect(path, read_only=True)
    except BaseException as error:
        writer.close()
        if isinstance(error, sqlite3.Error):
            raise StoreUnavailable from error
        raise
    return Store(path, writer, reader, len(chosen))
