"""Migration 0007 (hero roster): backfill, kept portraits, dropped text, rollback (FP-16, WL)."""

import hashlib
import sqlite3
from pathlib import Path

import pytest

from backend.specter_arena.store import (
    HERO_IDS,
    MigrationError,
    SchemaNewer,
    StoreStatus,
    get_asset,
    get_hero,
    latest_version,
    list_heroes,
    open_store,
)
from backend.specter_arena.store.errors import StoreError
from backend.specter_arena.store.migrate import (
    check_sequence,
    load_migrations,
    make_migration,
    migrate,
    pending,
    validate,
    verify_checksums,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "store"
FIXTURE_V5 = FIXTURES / "schema-v5.sql"
FIXTURE_V6 = FIXTURES / "schema-v6.sql"
FIXTURE_V7 = FIXTURES / "schema-v7.sql"
PACKAGED = load_migrations()
ALL = check_sequence(PACKAGED)
INSTALLATION = "00000000-0000-4000-8000-000000000004"
FIXTURE_BINDING = "bnd_000000000000000000000001"
FIXTURE_ASSET = "ast_aaaaaaaaaaaaaaaaaaaaaaaa"
MARKER = "SECRET-GENERATED-TEXT-MARKER"
GONE = ("specter", "specter_revision", "generation_request")
LEDGER = ("work_item", "work_attempt", "work_milestone", "work_decision", "xp_entry")
T0 = 1_800_000_000_000


def place(data_dir: Path, fixture: Path) -> Path:
    (data_dir / "store").mkdir(parents=True)
    path = data_dir / "store" / "specter-arena.db"
    conn = sqlite3.connect(path, isolation_level=None)
    conn.executescript(fixture.read_text(encoding="utf-8"))
    conn.close()
    return path


def normalised(conn: sqlite3.Connection) -> list[tuple[str, str, str]]:
    query_text = "SELECT type, name, sql FROM sqlite_master ORDER BY type, name"
    return [(a, b, " ".join((c or "").split())) for a, b, c in conn.execute(query_text)]


def table_digest(conn: sqlite3.Connection, table: str) -> str:
    digest = hashlib.sha256()
    for row in conn.execute(f"SELECT * FROM {table} ORDER BY 1, 2"):
        digest.update(repr(tuple(row)).encode())
    return digest.hexdigest()


def ledger_digest(conn: sqlite3.Connection) -> dict[str, str]:
    return {name: table_digest(conn, name) for name in (*LEDGER, "attempt", "bot_binding")}


def png_asset(conn: sqlite3.Connection, tail: str, created_ms: int) -> str:
    sha = tail * 32
    asset_id = "ast_" + sha[:24]
    data = bytes.fromhex("89504e470d0a1a0a") + bytes.fromhex(tail * 2)
    conn.execute(
        "INSERT INTO asset (asset_id, sha256, media_type, width, height, byte_length, origin,"
        " label, bytes, created_ms) VALUES (?, ?, 'image/png', 1, 1, ?, 'uploaded', 'seed', ?, ?)",
        (asset_id, sha, len(data), data, created_ms),
    )
    return asset_id


def add_binding(conn: sqlite3.Connection, n: int, first_seen_ms: int) -> str:
    binding_id = f"bnd_{n:024x}"
    conn.execute(
        "INSERT INTO bot_binding (binding_id, installation_id, dm_key, member_id, memory_store,"
        " first_seen_ms) VALUES (?, ?, ?, ?, ?, ?)",
        (binding_id, INSTALLATION, f"member-bot{n:02d}", f"bot{n:02d}", "", first_seen_ms),
    )
    return binding_id


def add_manual_specter(
    conn: sqlite3.Connection,
    binding_id: str,
    n: int,
    created_ms: int,
    *,
    portrait: str | None,
    archive: bool = False,
) -> None:
    """A manual Specter holding `MARKER` text; with a portrait it takes a second revision."""
    specter_id = f"spc_{n:024x}"
    profile = (
        '{"appearance":"%s","artBrief":"x","assignmentRationale":"x","contractVersion":1,'
        '"epithet":null,"mannerism":"x","name":"Seed %d","personality":"%s","signatureAction":null}'
        % (MARKER, n, MARKER)
    )
    conn.execute(
        "INSERT INTO specter (specter_id, binding_id, version, created_ms, updated_ms)"
        " VALUES (?, ?, 1, ?, ?)",
        (specter_id, binding_id, created_ms, created_ms),
    )
    insert = (
        "INSERT INTO specter_revision (specter_id, revision_no, change, profile_json, asset_id,"
        " source, request_id, prompt_version, created_ms) VALUES (?, ?, ?, ?, ?, 'manual', NULL,"
        " NULL, ?)"
    )
    conn.execute(insert, (specter_id, 1, "manual", profile, None, created_ms))
    version = 1
    if portrait is not None:
        version += 1
        conn.execute(
            "UPDATE specter SET version = ?, updated_ms = ? WHERE specter_id = ?",
            (version, created_ms + 1, specter_id),
        )
        conn.execute(insert, (specter_id, version, "portrait", profile, portrait, created_ms + 1))
    if archive:
        version += 1
        conn.execute(
            "UPDATE specter SET version = ?, updated_ms = ?, archived_ms = ? WHERE specter_id = ?",
            (version, created_ms + 2, created_ms + 2, specter_id),
        )
        conn.execute(insert, (specter_id, version, "archived", profile, portrait, created_ms + 2))


def seeded_v6(data_dir: Path) -> dict[str, object]:
    """The frozen v6 fixture plus 12 more bindings and summoning-era Specters.

    Bindings 2..13 are created in order, but bindings 4 and 5 were first seen long before
    the rest, so first-seen order differs from creation order for them. Expected portraits:
    the fixture binding (asset A, newest revision), 3 (archived, keeps B), 5 (B), 6 (a newer
    Specter with no portrait over an archived one with a portrait: none), 7 (A and B on two
    revisions: the newest, B).
    """
    path = place(data_dir, FIXTURE_V6)
    conn = sqlite3.connect(path, isolation_level=None)
    conn.execute("PRAGMA foreign_keys = ON")
    asset_b = png_asset(conn, "bb", T0)
    ids = {1: FIXTURE_BINDING}
    for n in range(2, 14):
        seen = 1_000 + n if n in (4, 5) else T0 + n * 10
        ids[n] = add_binding(conn, n, seen)
    add_manual_specter(conn, ids[3], 3, T0 + 3, portrait=asset_b, archive=True)
    add_manual_specter(conn, ids[5], 5, T0 + 5, portrait=asset_b)
    add_manual_specter(conn, ids[6], 61, T0 + 6, portrait=FIXTURE_ASSET, archive=True)
    add_manual_specter(conn, ids[6], 62, T0 + 7, portrait=None)
    add_manual_specter(conn, ids[7], 7, T0 + 8, portrait=FIXTURE_ASSET)
    conn.execute(
        "UPDATE specter SET version = 3, updated_ms = ? WHERE specter_id = ?",
        (T0 + 9, f"spc_{7:024x}"),
    )
    conn.execute(
        "INSERT INTO specter_revision (specter_id, revision_no, change, profile_json, asset_id,"
        " source, request_id, prompt_version, created_ms) SELECT specter_id, 3, 'portrait',"
        " profile_json, ?, 'manual', NULL, NULL, ? FROM specter_revision"
        " WHERE specter_id = ? AND revision_no = 2",
        (asset_b, T0 + 9, f"spc_{7:024x}"),
    )
    conn.close()
    return {"path": path, "ids": ids, "asset_b": asset_b}


# --- the migration as a packaged file ----------------------------------------------------------


def test_the_migration_is_the_seventh_and_names_the_hero_tables() -> None:
    assert latest_version() == 7
    assert PACKAGED[6].name == "hero_roster"


def test_a_fresh_store_has_the_hero_tables_and_no_summoning_tables(tmp_path: Path) -> None:
    opened = open_store(tmp_path / "data")
    try:
        assert opened.status() == StoreStatus("ready", 7, 7)
        with opened.read() as conn:
            names = {str(n) for (n,) in conn.execute("SELECT name FROM sqlite_master")}
            assert {"hero_assignment", "avatar_revision", "asset"} <= names
            assert names.isdisjoint(GONE)
            hero_triggers = {
                str(n)
                for (n,) in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name IN"
                    " ('hero_assignment', 'avatar_revision')"
                )
            }
            assert hero_triggers == {
                "hero_assignment_sequence",
                "hero_assignment_immutable",
                "hero_assignment_keep",
                "avatar_revision_sequence",
                "avatar_revision_immutable",
                "avatar_revision_keep",
            }
    finally:
        opened.close()


def test_the_migration_file_passes_the_runner_validation_and_drops_in_child_first_order() -> None:
    statements = [
        "\n".join(line for line in s.splitlines() if not line.lstrip().startswith("--"))
        for s in validate(PACKAGED[6])
    ]
    kinds = [" ".join(s.split()[:2]) for s in statements]
    assert kinds.count("CREATE TABLE") == 2 and kinds.count("CREATE TRIGGER") == 6
    assert kinds.count("INSERT INTO") == 2 and kinds.count("DROP TABLE") == 3
    drops = [s.split()[2].rstrip(";") for s in statements if s.startswith("DROP")]
    assert drops == ["specter_revision", "specter", "generation_request"]
    assert kinds[-3:] == ["DROP TABLE"] * 3  # nothing runs after the drops


# --- upgrading frozen fixtures -------------------------------------------------------------------


def test_the_v6_fixture_gets_a_hero_keeps_its_portrait_and_loses_its_text(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    place(data_dir, FIXTURE_V6)
    opened = open_store(data_dir)
    try:
        assert opened.status().state == "ready"
        hero = get_hero(opened, FIXTURE_BINDING)
        assert (hero.hero_id, hero.ordinal, hero.assignment_no) == ("vell", 1, 0)
        assert (hero.version, hero.asset_id) == (1, FIXTURE_ASSET)
        assert hero.assigned_ms == 1767225600000 and hero.updated_ms == 1767225606000
        kept = get_asset(opened, hero.asset_id or "")
        assert kept is not None and kept.label == "fixture portrait"
        with opened.read() as conn:
            names = {str(n) for (n,) in conn.execute("SELECT name FROM sqlite_master")}
            assert names.isdisjoint(GONE)
            dump = "\n".join(conn.iterdump())
            assert "Fixture Specter" not in dump and "lantern-bearer" not in dump
            assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
            assert conn.execute("PRAGMA integrity_check").fetchone() == ("ok",)
            assert conn.execute("PRAGMA user_version").fetchone() == (7,)
            assert conn.execute("SELECT max(version) FROM schema_migrations").fetchone() == (7,)
    finally:
        opened.close()
    backups = list((data_dir / "store" / "backups").glob("pre-migrate-v6-to-v7-*.db"))
    assert len(backups) == 1
    old = sqlite3.connect(backups[0])
    try:
        assert old.execute("PRAGMA user_version").fetchone() == (6,)
        assert old.execute("SELECT count(*) FROM specter_revision").fetchone() == (2,)
    finally:
        old.close()


def test_the_v5_fixture_upgrades_to_v7_in_one_open_with_one_backup(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    place(data_dir, FIXTURE_V5)
    opened = open_store(data_dir)
    try:
        assert opened.status() == StoreStatus("ready", 7, 7)
        hero = get_hero(opened, FIXTURE_BINDING)
        assert (hero.hero_id, hero.asset_id) == ("vell", FIXTURE_ASSET)
    finally:
        opened.close()
    assert len(list((data_dir / "store" / "backups").glob("pre-migrate-v5-to-v7-*.db"))) == 1


def test_work_and_xp_rows_and_bindings_are_untouched_by_the_migration(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    path = seeded_v6(data_dir)["path"]
    before = sqlite3.connect(path)
    expected = {k: v for k, v in ledger_digest(before).items() if k != "bot_binding"}
    bindings = [tuple(r) for r in before.execute("SELECT * FROM bot_binding ORDER BY binding_seq")]
    before.close()
    opened = open_store(data_dir)
    try:
        with opened.read() as conn:
            assert {k: v for k, v in ledger_digest(conn).items() if k != "bot_binding"} == expected
            now = [tuple(r) for r in conn.execute("SELECT * FROM bot_binding ORDER BY binding_seq")]
            assert now == bindings
            assert conn.execute("SELECT count(*) FROM xp_entry").fetchone() == (1,)
    finally:
        opened.close()


# --- backfill order and kept portraits ---------------------------------------------------------


def test_thirteen_bindings_are_assigned_in_first_seen_order_with_ordinals(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    seeded = seeded_v6(data_dir)
    ids: dict[int, str] = seeded["ids"]  # type: ignore[assignment]
    opened = open_store(data_dir)
    try:
        heroes = list_heroes(opened)
        with opened.read() as conn:
            expected = [
                str(r[0])
                for r in conn.execute(
                    "SELECT binding_id FROM bot_binding ORDER BY first_seen_ms, binding_seq"
                )
            ]
        assert [h.binding_id for h in heroes] == expected
        assert expected[:2] == [ids[4], ids[5]]  # first seen long before the rest
        assert expected[2] == ids[1]  # the fixture binding: 2026-01-01
        assert [h.assignment_no for h in heroes] == list(range(13))
        assert [h.hero_id for h in heroes] == [HERO_IDS[n % 11] for n in range(13)]
        assert [h.ordinal for h in heroes] == [1] * 11 + [2, 2]
        assert [(h.hero_id, h.ordinal) for h in heroes[11:]] == [("vell", 2), ("stitch", 2)]
        assert all(h.assigned_ms == _first_seen(opened, h.binding_id) for h in heroes)
    finally:
        opened.close()


def _first_seen(opened: object, binding_id: str) -> int:
    with opened.read() as conn:  # type: ignore[attr-defined]
        return int(
            conn.execute(
                "SELECT first_seen_ms FROM bot_binding WHERE binding_id = ?", (binding_id,)
            ).fetchone()[0]
        )


def test_only_the_newest_specters_newest_portrait_is_kept(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    seeded = seeded_v6(data_dir)
    ids: dict[int, str] = seeded["ids"]  # type: ignore[assignment]
    asset_b = str(seeded["asset_b"])
    opened = open_store(data_dir)
    try:
        by_binding = {h.binding_id: h for h in list_heroes(opened)}
        kept = {n: by_binding[b].asset_id for n, b in ids.items() if by_binding[b].asset_id}
        assert kept == {1: FIXTURE_ASSET, 3: asset_b, 5: asset_b, 7: asset_b}
        assert all(by_binding[ids[n]].version == 1 for n in kept)
        assert by_binding[ids[6]].version == 0  # newest Specter had no portrait
        assert by_binding[ids[2]].version == 0  # no Specter at all
        assert by_binding[ids[3]].updated_ms == T0 + 3 + 2  # archived: its last revision time
    finally:
        opened.close()


def test_no_generated_text_remains_in_any_table_but_survives_in_the_backup(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    seeded_v6(data_dir)
    opened = open_store(data_dir)
    try:
        with opened.read() as conn:
            dump = "\n".join(conn.iterdump())
        assert MARKER not in dump
    finally:
        opened.close()
    (backup,) = (data_dir / "store" / "backups").glob("pre-migrate-v6-to-v7-*.db")
    old = sqlite3.connect(backup)
    try:
        assert MARKER in "\n".join(old.iterdump())
    finally:
        old.close()


def test_a_store_with_no_bindings_migrates_to_empty_hero_tables(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    from backend.specter_arena.store.store import open_store as open_with

    open_with(data_dir, migrations=PACKAGED[:6]).close()
    opened = open_store(data_dir)
    try:
        assert list_heroes(opened) == ()
        assert opened.status().state == "ready"
    finally:
        opened.close()


# --- failure and downgrade -----------------------------------------------------------------------


def test_a_failing_0007_rolls_back_whole_and_leaves_v6_with_its_backup(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    path = place(data_dir, FIXTURE_V6)
    broken = make_migration(
        7, "hero_roster", PACKAGED[6].sql + "\nINSERT INTO no_such_table VALUES (1);\n"
    )
    with pytest.raises(StoreError):
        open_store(data_dir, migrations=[*PACKAGED[:6], broken])
    check = sqlite3.connect(path)
    try:
        assert check.execute("PRAGMA user_version").fetchone() == (6,)
        names = {str(n) for (n,) in check.execute("SELECT name FROM sqlite_master")}
        assert set(GONE) <= names and not {"hero_assignment", "avatar_revision"} & names
        assert check.execute("SELECT count(*) FROM specter_revision").fetchone() == (2,)
    finally:
        check.close()
    assert len(list((data_dir / "store" / "backups").glob("pre-migrate-v6-to-v7-*.db"))) == 1
    reopened = open_store(data_dir)
    try:
        assert get_hero(reopened, FIXTURE_BINDING).hero_id == "vell"
    finally:
        reopened.close()


def test_a_backfill_that_breaks_the_sequence_rule_fails_the_migration(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    place(data_dir, FIXTURE_V6)
    skewed = PACKAGED[6].sql.replace("- 1 AS n", "+ 1 AS n")
    assert skewed != PACKAGED[6].sql
    with pytest.raises((MigrationError, StoreError)):
        open_store(data_dir, migrations=[*PACKAGED[:6], make_migration(7, "hero_roster", skewed)])


def test_a_v7_store_is_refused_by_code_that_knows_only_six(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    open_store(data_dir).close()
    with pytest.raises(SchemaNewer):
        open_store(data_dir, migrations=PACKAGED[:6])


def test_the_migration_checksum_is_audited_after_the_run(tmp_path: Path) -> None:
    conn = sqlite3.connect(tmp_path / "a.db", isolation_level=None)
    try:
        migrate(conn, ALL)
        verify_checksums(conn, ALL)
        assert pending(conn, ALL) == []
        assert conn.execute("SELECT name FROM schema_migrations WHERE version = 7").fetchone() == (
            "hero_roster",
        )
    finally:
        conn.close()


# --- the frozen v7 fixture ------------------------------------------------------------------------


def test_the_frozen_v7_fixture_has_the_schema_the_migrations_create(tmp_path: Path) -> None:
    fixture = sqlite3.connect(tmp_path / "fixture.db", isolation_level=None)
    fixture.executescript(FIXTURE_V7.read_text(encoding="utf-8"))
    migrated = sqlite3.connect(tmp_path / "migrated.db", isolation_level=None)
    migrate(migrated, ALL)
    try:
        assert normalised(fixture) == normalised(migrated)
        verify_checksums(fixture, ALL)
        assert pending(fixture, ALL) == []
        assert fixture.execute("PRAGMA foreign_key_check").fetchall() == []
    finally:
        fixture.close()
        migrated.close()


def test_the_v7_fixture_opens_and_serves_its_heroes_and_avatar(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    place(data_dir, FIXTURE_V7)
    opened = open_store(data_dir)
    try:
        assert opened.status() == StoreStatus("ready", 7, 7)
        heroes = list_heroes(opened)
        assert [(h.hero_id, h.ordinal) for h in heroes] == [("vell", 1), ("stitch", 1)]
        assert [h.version for h in heroes] == [1, 0]
        assert heroes[0].asset_id == FIXTURE_ASSET and heroes[1].asset_id is None
    finally:
        opened.close()
    assert not (data_dir / "store" / "backups").exists()
