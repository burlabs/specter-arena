import re
import sqlite3
from pathlib import Path

from backend.specter_arena.store.migrate import load_migrations, make_migration, migrate

REPO_ROOT = Path(__file__).resolve().parents[2]

# FP-02-AC06: no required Specter class, archetype, species category, capability score or hidden
# agent classifier in the schema. A name is flagged when any of its words is in this list.
DENYLIST = frozenset(
    {
        "class",
        "classes",
        "archetype",
        "archetypes",
        "species",
        "category",
        "categories",
        "taxonomy",
        "role",
        "roles",
        "rarity",
        "tier",
        "rank",
        "score",
        "scores",
        "rating",
        "classifier",
        "classification",
        "capability",
        "capabilities",
        "alignment",
        "element",
        "specialty",
        "specialization",
    }
)


def words(name: str) -> set[str]:
    spaced = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", name)
    return {word.lower() for word in re.split(r"[_\W]+", spaced) if word}


def classifier_like_names(conn: sqlite3.Connection) -> list[str]:
    found: list[str] = []
    table_rows = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    for (table,) in table_rows:
        if words(table) & DENYLIST:
            found.append(table)
        for column in conn.execute("SELECT name FROM pragma_table_info(?)", (table,)):
            if words(column[0]) & DENYLIST:
                found.append(f"{table}.{column[0]}")
    return found


def migrated(path: Path, *extra_sql: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path, isolation_level=None)
    extra = [
        make_migration(len(load_migrations()) + 1 + i, f"extra{i}", sql)
        for i, sql in enumerate(extra_sql)
    ]
    migrate(conn, (*load_migrations(), *extra))
    return conn


def test_the_store_schema_has_no_classifier_like_table_or_column(tmp_path: Path) -> None:
    conn = migrated(tmp_path / "store.db")
    try:
        assert classifier_like_names(conn) == []
    finally:
        conn.close()


def test_the_check_catches_a_classifier_column_and_table(tmp_path: Path) -> None:
    conn = migrated(
        tmp_path / "store.db",
        "CREATE TABLE bots (id INTEGER PRIMARY KEY, archetype TEXT) STRICT;",
        "CREATE TABLE agent_class (id INTEGER PRIMARY KEY, powerScore INTEGER) STRICT;",
    )
    try:
        assert classifier_like_names(conn) == [
            "bots.archetype",
            "agent_class",
            "agent_class.powerScore",
        ]
    finally:
        conn.close()


def test_name_splitting_handles_snake_and_camel_case() -> None:
    assert words("app_schema_family") == {"app", "schema", "family"}
    assert words("powerScore") == {"power", "score"}
    assert words("store_meta") & DENYLIST == set()


def test_the_denylist_equals_the_schema_tooling_set() -> None:
    source = (REPO_ROOT / "scripts" / "check-schema.mjs").read_text(encoding="utf-8")
    block = re.search(r"DENIED_TOKENS = new Set\(\[(.*?)\]\)", source, re.DOTALL)
    assert block is not None
    assert set(re.findall(r"'([a-z]+)'", block.group(1))) == DENYLIST


def test_the_frozen_baseline_has_no_denied_token(tmp_path: Path) -> None:
    conn = sqlite3.connect(tmp_path / "store.db", isolation_level=None)
    try:
        migrate(conn, load_migrations()[:1])
        assert classifier_like_names(conn) == []
    finally:
        conn.close()


def sql_identifier_words(sql: str) -> set[str]:
    code = re.sub(r"/\*.*?\*/", " ", sql, flags=re.DOTALL)
    code = re.sub(r"--[^\n]*", " ", code)
    code = re.sub(r"'(?:[^']|'')*'", "''", code)
    return {word for name in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", code) for word in words(name)}


def test_no_packaged_migration_uses_a_denied_word_in_any_identifier() -> None:
    for migration in load_migrations():
        assert sql_identifier_words(migration.sql) & DENYLIST == set(), migration.name


def test_the_identifier_scan_catches_a_denied_word_outside_names_it_would_miss() -> None:
    sql = "CREATE INDEX rank_ix ON t (x); -- role in a comment is ignored\nSELECT 'tier';"
    assert sql_identifier_words(sql) & DENYLIST == {"rank"}
