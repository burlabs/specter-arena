from __future__ import annotations

import sqlite3
import time
from pathlib import Path

from .errors import StoreUnavailable

BUSY_TIMEOUT_S = 5.0
WAL_DEADLINE_S = 5.0
_WAL_RETRY_S = 0.05


def connect(path: Path, *, read_only: bool) -> sqlite3.Connection:
    """An autocommit connection, so the store owns every transaction explicitly."""
    try:
        conn = sqlite3.connect(
            str(path), timeout=BUSY_TIMEOUT_S, isolation_level=None, check_same_thread=False
        )
    except sqlite3.Error as error:
        raise StoreUnavailable from error
    try:
        conn.execute(f"PRAGMA busy_timeout = {int(BUSY_TIMEOUT_S * 1000)}")
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA trusted_schema = OFF")
        if read_only:
            conn.execute("PRAGMA query_only = ON")
    except sqlite3.Error as error:
        conn.close()
        raise StoreUnavailable from error
    return conn


def enable_wal(conn: sqlite3.Connection, deadline_s: float | None = None) -> None:
    """Switch to WAL, retrying until a deadline: a mode switch does not use the busy handler."""
    deadline = time.monotonic() + (WAL_DEADLINE_S if deadline_s is None else deadline_s)
    while True:
        try:
            if str(conn.execute("PRAGMA journal_mode").fetchone()[0]).lower() == "wal":
                return
            if str(conn.execute("PRAGMA journal_mode = WAL").fetchone()[0]).lower() == "wal":
                return
        except sqlite3.OperationalError:
            pass
        if time.monotonic() >= deadline:
            raise StoreUnavailable
        time.sleep(_WAL_RETRY_S)


def quick_check(conn: sqlite3.Connection) -> None:
    try:
        rows = conn.execute("PRAGMA quick_check").fetchall()
    except sqlite3.Error as error:
        raise StoreUnavailable from error
    if rows != [("ok",)]:
        raise StoreUnavailable
