from __future__ import annotations

import logging
import re
import sqlite3
import stat
import time
from pathlib import Path

from .location import BACKUPS_DIRNAME, store_dir

_LOG = logging.getLogger("specter_arena.store.housekeeping")

EXPORTS_DIRNAME = "exports"
SWEEP_MIN_AGE_S = 600
# The only temp names the store writes: `copy_database` stages `.<name>.partial` (so a staged
# restore is `..restore-<hex>.db.partial`) and `restore` stages `.restore-<32 hex>.db`.
_PARTIAL = re.compile(r"^\.[A-Za-z0-9._-]{1,200}\.partial$")
_RESTORE = re.compile(r"^\.restore-[0-9a-f]{32}\.db$")


def sweep_directories(data_dir: Path) -> tuple[Path, ...]:
    return (store_dir(data_dir), store_dir(data_dir) / BACKUPS_DIRNAME, data_dir / EXPORTS_DIRNAME)


def is_orphan_name(name: str) -> bool:
    return _PARTIAL.fullmatch(name) is not None or _RESTORE.fullmatch(name) is not None


def sweep_temp_files(data_dir: Path, *, now: float | None = None) -> int:
    """Delete orphan `.partial` and `.restore-<hex>.db` files older than 10 minutes (by mtime)
    in the store, backups and exports directories; returns how many were removed.

    Never touches a database, a `-wal` or `-shm` file, or a pre-restore, pre-migrate, backup or
    export file. Never raises: a directory or file that cannot be read or removed is skipped, so
    the sweep can never stop the store from opening. Logs a count and no path.
    """
    cutoff = (time.time() if now is None else now) - SWEEP_MIN_AGE_S
    removed = 0
    for directory in sweep_directories(data_dir):
        try:
            entries = list(directory.iterdir())
        except OSError:
            continue
        for path in entries:
            if not is_orphan_name(path.name):
                continue
            try:
                info = path.lstat()
                if not stat.S_ISREG(info.st_mode) or info.st_mtime >= cutoff:
                    continue
                path.unlink()
            except OSError:
                continue
            removed += 1
    if removed:
        _LOG.info("startup sweep removed %d orphan temp file(s)", removed)
    return removed


def close_interrupted_runs(conn: sqlite3.Connection, now_ms: int) -> int:
    """Mark a lifecycle run a crash left `running` as `interrupted`; rows it already deleted stay
    deleted (the pre-run backup exists). Never raises: a store without the table, or one that
    cannot be written, is left as it is."""
    try:
        if (
            conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'lifecycle_run'"
            ).fetchone()
            is None
        ):
            return 0
        cursor = conn.execute(
            "UPDATE lifecycle_run SET state = 'interrupted', ended_ms = max(started_ms, ?)"
            " WHERE state = 'running'",
            (now_ms,),
        )
        return max(cursor.rowcount, 0)
    except sqlite3.Error:
        return 0
