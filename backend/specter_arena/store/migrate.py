from __future__ import annotations

import functools
import hashlib
import re
import sqlite3
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from .errors import ChecksumMismatch, MigrationError, MigrationFileError, SchemaNewer

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
_FILE_NAME = re.compile(r"^(\d{4})_([a-z0-9_]{1,64})\.sql$")
# The runner owns the transaction and the version header, so a file may not start a statement
# with any of these. Checking statement starts (not substrings) keeps CREATE TRIGGER ... END legal.
_FORBIDDEN_START = re.compile(
    r"^(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE|PRAGMA|ATTACH|DETACH|VACUUM)\b", re.IGNORECASE
)


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    sql: str
    sha256: str


def make_migration(version: int, name: str, sql: str) -> Migration:
    """Line endings are normalised before hashing so a CRLF checkout keeps the same checksum."""
    text = sql.replace("\r\n", "\n").replace("\r", "\n")
    return Migration(version, name, text, hashlib.sha256(text.encode("utf-8")).hexdigest())


def _code_lines(text: str) -> list[str]:
    return [
        line for line in text.splitlines() if line.strip() and not line.lstrip().startswith("--")
    ]


def split_statements(sql: str) -> list[str]:
    """Split on complete statements, as SQLite itself judges them, so trigger bodies stay whole."""
    statements: list[str] = []
    buffer = ""
    for line in sql.splitlines(keepends=True):
        buffer += line
        if sqlite3.complete_statement(buffer):
            if _code_lines(buffer):
                statements.append(buffer.strip())
            buffer = ""
    if _code_lines(buffer):
        raise MigrationFileError("unterminated statement")
    return statements


def validate(migration: Migration) -> list[str]:
    statements = split_statements(migration.sql)
    if not statements:
        raise MigrationFileError("empty migration")
    for statement in statements:
        if _FORBIDDEN_START.match("\n".join(_code_lines(statement)).lstrip()):
            raise MigrationFileError("transaction control or PRAGMA in a migration")
    return statements


def check_sequence(migrations: Sequence[Migration]) -> tuple[Migration, ...]:
    ordered = tuple(sorted(migrations, key=lambda migration: migration.version))
    if [migration.version for migration in ordered] != list(range(1, len(ordered) + 1)):
        raise MigrationFileError("migration numbering must run 1..N without gaps")
    for migration in ordered:
        validate(migration)
    return ordered


def load_migrations(directory: Path | None = None) -> tuple[Migration, ...]:
    root = MIGRATIONS_DIR if directory is None else directory
    found: list[Migration] = []
    for path in sorted(root.glob("*.sql")):
        match = _FILE_NAME.fullmatch(path.name)
        if match is None:
            raise MigrationFileError("bad migration file name")
        found.append(make_migration(int(match[1]), match[2], path.read_text(encoding="utf-8")))
    return check_sequence(found)


@functools.cache
def packaged_migrations() -> tuple[Migration, ...]:
    return load_migrations()


def latest_version(migrations: Sequence[Migration] | None = None) -> int:
    """The newest schema version this code knows. Reads files only; opens no database."""
    return len(packaged_migrations() if migrations is None else migrations)


def current_version(conn: sqlite3.Connection) -> int:
    return int(conn.execute("PRAGMA user_version").fetchone()[0])


def pending(conn: sqlite3.Connection, migrations: Sequence[Migration]) -> list[Migration]:
    version = current_version(conn)
    if version > len(migrations):
        raise SchemaNewer
    return [migration for migration in migrations if migration.version > version]


def verify_checksums(conn: sqlite3.Connection, migrations: Sequence[Migration]) -> None:
    """Every applied version has exactly the row and checksum of the file this code ships."""
    version = current_version(conn)
    if version == 0:
        return
    try:
        applied = dict(conn.execute("SELECT version, sha256 FROM schema_migrations").fetchall())
    except sqlite3.Error as error:
        raise MigrationError("migration history is unreadable") from error
    expected = {m.version: m.sha256 for m in migrations if m.version <= version}
    if applied != expected:
        raise ChecksumMismatch("applied migrations do not match the packaged files")


def _utc_now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def migrate(
    conn: sqlite3.Connection, migrations: Sequence[Migration], now: Callable[[], str] = _utc_now
) -> int:
    """Apply pending migrations, one `BEGIN IMMEDIATE` transaction each, then audit checksums.

    `conn` must be in autocommit mode (`isolation_level=None`) so the runner owns transactions.
    """
    for migration in pending(conn, migrations):
        statements = validate(migration)
        try:
            conn.execute("BEGIN IMMEDIATE")
            # A second backend opening the same file during an update restart may have applied
            # this version between our read of user_version and taking the write lock.
            if current_version(conn) >= migration.version:
                conn.execute("ROLLBACK")
                continue
            for statement in statements:
                conn.execute(statement)
            conn.execute(
                "INSERT INTO schema_migrations (version, name, sha256, applied_at)"
                " VALUES (?, ?, ?, ?)",
                (migration.version, migration.name, migration.sha256, now()),
            )
            # PRAGMA takes no bound parameters; the value is an int this runner built.
            conn.execute(f"PRAGMA user_version = {int(migration.version)}")
            conn.execute("COMMIT")
        except sqlite3.Error as error:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise MigrationError("migration failed and was rolled back") from error
    verify_checksums(conn, migrations)
    return current_version(conn)
