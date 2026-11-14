from __future__ import annotations

import os
import re
import sqlite3
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

from .connection import BUSY_TIMEOUT_S, quick_check
from .errors import BackupError, RestoreError, SchemaNewer, StoreError
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
    packaged_migrations,
    verify_checksums,
)

if TYPE_CHECKING:
    from .store import Store

KEEP_PRE_MIGRATION = 3
_PRE_MIGRATION_NAME = re.compile(r"^pre-migrate-v\d+-to-v\d+-(\d{8}T\d{12}Z)\.db$")
_BUSY_CODES = {sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED}


def _utc_stamp() -> str:
    return datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")


def _open_read_only(path: Path) -> sqlite3.Connection:
    # A read-only URI connection takes no part in the Store's own locks and cannot write.
    return sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True, timeout=BUSY_TIMEOUT_S)


def copy_database(source: Path, dest_dir: Path, name: str) -> Path:
    """Copy a live database consistently to an owner-only file, verify it, then rename it in."""
    final = dest_dir / name
    partial = dest_dir / f".{name}.partial"
    try:
        ensure_private_dir(dest_dir)
        precreate_private_file(partial)
        src = _open_read_only(source)
        try:
            dst = sqlite3.connect(str(partial))
            try:
                src.backup(dst)
                # The copy inherits WAL mode from the source; a backup must be one closed file.
                dst.execute("PRAGMA journal_mode = DELETE")
                if dst.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                    raise BackupError("backup failed verification")
            finally:
                dst.close()
        finally:
            src.close()
        os.replace(partial, final)
    except (sqlite3.Error, OSError, StoreError) as error:
        partial.unlink(missing_ok=True)
        if isinstance(error, BackupError):
            raise
        raise BackupError("backup failed") from error
    return final


def backup(store: Store, dest_dir: Path) -> Path:
    with store.read() as conn:
        version = current_version(conn)
    return copy_database(store.db_path, dest_dir, f"backup-v{version}-{_utc_stamp()}.db")


def pre_migration_backup(db: Path, from_version: int, to_version: int, keep: int) -> Path:
    directory = db.parent / BACKUPS_DIRNAME
    name = f"pre-migrate-v{from_version}-to-v{to_version}-{_utc_stamp()}.db"
    made = copy_database(db, directory, name)
    prune_pre_migration(directory, keep)
    return made


def prune_pre_migration(directory: Path, keep: int) -> None:
    """Delete all but the newest `keep` pre-migration backups; no other file is ever touched."""
    stamped = sorted(
        (match[1], path)
        for path in directory.iterdir()
        if (match := _PRE_MIGRATION_NAME.fullmatch(path.name)) and path.is_file()
    )
    for _, path in stamped[: max(0, len(stamped) - keep)]:
        path.unlink(missing_ok=True)


def _verify_backup(backup_path: Path, migrations: Sequence[Migration]) -> None:
    try:
        src = _open_read_only(backup_path)
    except sqlite3.Error as error:
        raise RestoreError("backup is unreadable") from error
    try:
        quick_check(src)
        version = current_version(src)
        if version > len(migrations):
            raise SchemaNewer
        if version < 1:
            raise RestoreError("not a store backup")
        verify_checksums(src, migrations)
    except (SchemaNewer, RestoreError):
        raise
    except (sqlite3.Error, StoreError) as error:
        raise RestoreError("backup failed verification") from error
    finally:
        src.close()


def _require_offline(live: Path) -> None:
    """Best effort: leaving WAL mode needs every other connection to the file to be closed.

    An idle connection that has never read the file can slip past this check, which is why
    restore is an offline maintenance function and has no HTTP route. A live file SQLite cannot
    read at all (corrupt) does not block a restore: replacing it is the point.
    """
    try:
        conn = sqlite3.connect(str(live), timeout=0)
        try:
            mode = str(conn.execute("PRAGMA journal_mode = DELETE").fetchone()[0]).lower()
        finally:
            conn.close()
    except sqlite3.Error as error:
        if error.sqlite_errorcode & 0xFF in _BUSY_CODES:
            raise RestoreError("store is open") from error
        return
    if mode != "delete":
        raise RestoreError("store is open")


def restore(
    backup_path: Path, data_dir: Path, *, migrations: Sequence[Migration] | None = None
) -> Path | None:
    """Replace the store's database with a verified backup while the store is closed.

    The previous database is moved aside as `specter-arena.db.pre-restore-<stamp>` and never
    deleted. Returns that path, or None when there was no database. Does not reopen the store:
    the caller runs `open_store`, which migrates an older backup forward.
    """
    check_sqlite_version()
    chosen = packaged_migrations() if migrations is None else check_sequence(migrations)
    _verify_backup(backup_path, chosen)
    live = db_path(data_dir)
    ensure_private_dir(store_dir(data_dir))
    if live.exists():
        _require_offline(live)
    try:
        staged = copy_database(backup_path, live.parent, f".restore-{uuid.uuid4().hex}.db")
    except BackupError as error:
        raise RestoreError("could not stage the backup") from error
    aside: Path | None = None
    try:
        if live.exists():
            aside = live.with_name(f"{live.name}.pre-restore-{_utc_stamp()}")
            os.replace(live, aside)
        for suffix in ("-wal", "-shm"):
            live.with_name(live.name + suffix).unlink(missing_ok=True)
        os.replace(staged, live)
    except OSError as error:
        staged.unlink(missing_ok=True)
        if aside is not None and not live.exists():
            os.replace(aside, live)
        raise RestoreError("restore failed") from error
    return aside
