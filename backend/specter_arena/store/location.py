from __future__ import annotations

import os
import re
import sqlite3
from collections.abc import Mapping
from pathlib import Path

from .errors import SqliteTooOld, StoreUnavailable

APP_NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
STORE_DIRNAME = "store"
DB_FILENAME = "specter-arena.db"
BACKUPS_DIRNAME = "backups"
# STRICT tables need SQLite 3.37.
SQLITE_FLOOR = (3, 37, 0)


def resolve_data_dir(environ: Mapping[str, str]) -> Path | None:
    """`<KIROCREW_HOME>/apps/<KIROCREW_APP_NAME>/data`, or None when that cannot be trusted.

    None when either variable is missing, the name is malformed, the home is relative (it would
    resolve against the backend's working directory), or the resolved path escapes the apps
    directory through a symlink. Creates nothing.
    """
    home = environ.get("KIROCREW_HOME", "")
    name = environ.get("KIROCREW_APP_NAME", "")
    if not home or not APP_NAME_PATTERN.fullmatch(name):
        return None
    home_path = Path(home)
    if not home_path.is_absolute():
        return None
    apps = (home_path / "apps").resolve()
    data = (apps / name / "data").resolve()
    if data.parent.parent != apps:
        return None
    return data


def check_sqlite_version(version: tuple[int, int, int] | None = None) -> None:
    if (sqlite3.sqlite_version_info if version is None else version) < SQLITE_FLOOR:
        raise SqliteTooOld


def store_dir(data_dir: Path) -> Path:
    return data_dir / STORE_DIRNAME


def db_path(data_dir: Path) -> Path:
    return store_dir(data_dir) / DB_FILENAME


def ensure_private_dir(path: Path) -> None:
    try:
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
        if os.name == "posix":
            path.chmod(0o700)
    except OSError as error:
        raise StoreUnavailable from error


def precreate_private_file(path: Path) -> None:
    """Create an empty owner-only file; SQLite would create a new file 0644 under umask 022."""
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        return
    except OSError as error:
        raise StoreUnavailable from error
    os.close(fd)
