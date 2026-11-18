import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest

from backend.specter_arena.store import (
    SchemaNewer,
    StoreStatus,
    get_specter,
    latest_version,
    open_store,
)
from backend.specter_arena.store.migrate import load_migrations, migrate, pending, verify_checksums

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "store"
FIXTURE_V4 = FIXTURES / "schema-v4.sql"
FIXTURE_V5 = FIXTURES / "schema-v5.sql"
FIXTURE_BINDING = "bnd_000000000000000000000001"
FIXTURE_SPECTER = "spc_000000000000000000000001"
OWN_TABLES = {"asset", "generation_request", "specter", "specter_revision"}


def place(data_dir: Path, fixture: Path) -> None:
    (data_dir / "store").mkdir(parents=True)
    conn = sqlite3.connect(data_dir / "store" / "specter-arena.db", isolation_level=None)
    conn.executescript(fixture.read_text(encoding="utf-8"))
    conn.close()


def normalised(conn: sqlite3.Connection) -> list[tuple[str, str, str]]:
    query = "SELECT type, name, sql FROM sqlite_master ORDER BY type, name"
    return [(a, b, " ".join((c or "").split())) for a, b, c in conn.execute(query)]


# --- fresh, upgrade, downgrade -----------------------------------------------------------------


def test_a_fresh_store_has_the_specter_tables_and_indexes(tmp_path: Path) -> None:
    opened = open_store(tmp_path / "data")
    try:
        assert opened.status() == StoreStatus("ready", latest_version(), latest_version())
        assert latest_version() >= 5
        with opened.read() as conn:
            names = {n for (n,) in conn.execute("SELECT name FROM sqlite_master")}
            for table in OWN_TABLES:
                assert conn.execute(f"SELECT count(*) FROM {table}").fetchone() == (0,)
        assert {
            "specter_one_active",
            "specter_by_binding",
            "specter_revision_request",
            "generation_request_by_binding",
            "generation_request_by_status",
            "generation_request_started",
            "generation_request_transition",
            "specter_guard",
            "specter_revision_sequence",
        } <= names
    finally:
        opened.close()


def test_the_frozen_v5_fixture_has_the_schema_the_migrations_create(tmp_path: Path) -> None:
    fixture = sqlite3.connect(tmp_path / "fixture.db", isolation_level=None)
    fixture.executescript(FIXTURE_V5.read_text(encoding="utf-8"))
    migrated = sqlite3.connect(tmp_path / "migrated.db", isolation_level=None)
    through_v5 = load_migrations()[:5]
    migrate(migrated, through_v5)
    try:
        assert normalised(fixture) == normalised(migrated)
        verify_checksums(fixture, through_v5)
        assert pending(fixture, through_v5) == []
    finally:
        fixture.close()
        migrated.close()


def test_the_v4_fixture_upgrades_with_empty_specter_tables_and_a_backup(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    place(data_dir, FIXTURE_V4)
    opened = open_store(data_dir)
    try:
        assert opened.status().state == "ready"
        with opened.read() as conn:
            assert conn.execute("PRAGMA user_version").fetchone() == (latest_version(),)
            assert conn.execute("SELECT count(*) FROM bot_binding").fetchone() == (1,)
            assert conn.execute("SELECT count(*) FROM observation").fetchone() == (1,)
            for table in OWN_TABLES:
                assert conn.execute(f"SELECT count(*) FROM {table}").fetchone() == (0,)
        assert get_specter(opened, FIXTURE_BINDING) is None
    finally:
        opened.close()
    assert list((data_dir / "store" / "backups").glob("pre-migrate-v4-to-v*.db"))


def test_the_v5_fixture_opens_and_serves_its_specter(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    place(data_dir, FIXTURE_V5)
    opened = open_store(data_dir)
    try:
        assert opened.status().state == "ready"
        record = get_specter(opened, FIXTURE_BINDING)
        assert record is not None
        assert (record.specter_id, record.version, record.source) == (
            FIXTURE_SPECTER,
            2,
            "generated",
        )
        assert record.profile["name"] == "Fixture Specter"
        assert record.portrait is not None and record.portrait.label == "fixture portrait"
    finally:
        opened.close()


def test_code_that_knows_only_schema_four_refuses_a_version_five_store(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    place(data_dir, FIXTURE_V5)
    db = data_dir / "store" / "specter-arena.db"
    before = db.read_bytes()
    with pytest.raises(SchemaNewer):
        open_store(data_dir, migrations=load_migrations()[:4])
    assert db.read_bytes() == before
    assert not (data_dir / "store" / "backups").exists()


# --- constraints -------------------------------------------------------------------------------


@pytest.fixture
def conn(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    db = sqlite3.connect(tmp_path / "store.db", isolation_level=None)
    db.execute("PRAGMA foreign_keys = ON")
    db.executescript(FIXTURE_V5.read_text(encoding="utf-8"))
    yield db
    db.close()


REQUEST_COLS = (
    "request_id, binding_id, status, keep_json, prompt_version, attempts, internal_tag, created_ms"
    "{extra}"
)


def request_sql(
    request_id: str = "req_" + "1" * 24,
    status: str = "queued",
    extra: str = "",
    values: str = "",
    tag: str = "summoning",
    keep: str = "[]",
) -> str:
    return (
        f"INSERT INTO generation_request ({REQUEST_COLS.format(extra=extra)}) VALUES "
        f"('{request_id}', '{FIXTURE_BINDING}', '{status}', '{keep}', 'summon-1', 0, '{tag}', 10"
        f"{values})"
    )


GOOD_PNG = "x'89504e470d0a1a0a00'"
GOOD_SHA = "c" * 24 + "0" * 40


def asset_sql(
    asset_id: str = "ast_" + "c" * 24,
    sha: str = GOOD_SHA,
    media: str = "image/png",
    width: int = 1,
    length: int = 9,
    origin: str = "uploaded",
    data: str = GOOD_PNG,
) -> str:
    return (
        "INSERT INTO asset (asset_id, sha256, media_type, width, height, byte_length, origin,"
        f" label, bytes, created_ms) VALUES ('{asset_id}', '{sha}', '{media}', {width}, 1,"
        f" {length}, '{origin}', 'x', {data}, 1)"
    )


def specter_sql(
    specter_id: str = "spc_" + "2" * 24, binding: str = FIXTURE_BINDING, version: int = 1
) -> str:
    return (
        "INSERT INTO specter (specter_id, binding_id, version, created_ms, updated_ms)"
        f" VALUES ('{specter_id}', '{binding}', {version}, 5, 5)"
    )


def revision_sql(
    number: int = 3, change: str = "renamed", profile: str = "{}", asset: str = "NULL"
) -> str:
    return (
        "INSERT INTO specter_revision (specter_id, revision_no, change, profile_json, asset_id,"
        " source, prompt_version, created_ms)"
        f" VALUES ('{FIXTURE_SPECTER}', {number}, '{change}', '{profile}', {asset}, 'generated',"
        " 'summon-1', 9)"
    )


BAD_STATEMENTS = {
    "asset id does not match sha": asset_sql(asset_id="ast_" + "b" * 24),
    "asset not png bytes": asset_sql(data="x'474946383961000000'"),
    "asset length mismatch": asset_sql(length=10),
    "asset media type": asset_sql(media="image/jpeg"),
    "asset origin": asset_sql(origin="remote"),
    "asset text bytes": asset_sql(data="'89504e470'"),
    "asset oversize dimension": asset_sql(width=1025),
    "request id shape": request_sql("req_xyz"),
    "request id upper hex": request_sql("req_" + "A" * 24),
    "request tag": request_sql(tag="monitoring"),
    "request status": request_sql(status="done"),
    "request keep not array": request_sql(keep="{}"),
    "queued with a start": request_sql(extra=", started_ms", values=", 11"),
    "running without a start": request_sql(status="running"),
    "ready without candidate": request_sql(
        status="ready", extra=", started_ms, finished_ms", values=", 11, 12"
    ),
    "failed without code": request_sql(status="failed", extra=", finished_ms", values=", 12"),
    "failed with candidate": request_sql(
        status="failed",
        extra=", finished_ms, error_code, candidate_json",
        values=", 12, 'x', '{}'",
    ),
    "cancelled with code": request_sql(
        status="cancelled", extra=", finished_ms, error_code", values=", 12, 'x'"
    ),
    "start before create": request_sql(status="running", extra=", started_ms", values=", 9"),
    "error code shape": request_sql(
        status="failed", extra=", finished_ms, error_code", values=", 12, 'Bad Code'"
    ),
    "attempts over bound": request_sql().replace(", 0, 'summoning'", ", 9, 'summoning'"),
    "second active specter": specter_sql(),
    "specter version zero": specter_sql(version=0),
    "specter unknown binding": specter_sql(binding="bnd_" + "f" * 24),
    "revision out of sequence": revision_sql(number=4),
    "revision duplicate number": revision_sql(number=2),
    "revision profile not object": revision_sql(number=3, profile="[]"),
    "revision unknown change": revision_sql(number=3, change="rerolled"),
    "revision unknown asset": revision_sql(
        number=3, change="portrait", asset="'ast_" + "d" * 24 + "'"
    ),
}


@pytest.mark.parametrize("name", sorted(BAD_STATEMENTS))
def test_the_schema_refuses_a_bad_row(conn: sqlite3.Connection, name: str) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(BAD_STATEMENTS[name])


def test_revision_one_must_be_generated_or_manual_and_provenance_must_agree(
    tmp_path: Path,
) -> None:
    db = sqlite3.connect(tmp_path / "store.db", isolation_level=None)
    db.execute("PRAGMA foreign_keys = ON")
    db.executescript(FIXTURE_V5.read_text(encoding="utf-8"))
    db.execute(
        "INSERT INTO bot_binding (binding_id, installation_id, dm_key, member_id, memory_store,"
        " first_seen_ms) VALUES ('bnd_" + "9" * 24 + "', '00000000-0000-4000-8000-000000000004',"
        " 'member-nine.memory-nine', 'nine', 'nine', 1)"
    )
    db.execute(
        "INSERT INTO specter (specter_id, binding_id, version, created_ms, updated_ms)"
        " VALUES ('spc_" + "9" * 24 + "', 'bnd_" + "9" * 24 + "', 1, 5, 5)"
    )
    insert = (
        "INSERT INTO specter_revision (specter_id, revision_no, change, profile_json, source,"
        " request_id, prompt_version, created_ms) VALUES ('spc_" + "9" * 24 + "', 1, ?, '{}', ?,"
        " ?, ?, 9)"
    )
    try:
        for change, source, request, prompt in (
            ("renamed", "generated", None, "summon-1"),  # revision 1 cannot be a rename
            ("generated", "generated", None, "summon-1"),  # generated needs its request
            ("generated", "manual", "req_" + "1" * 24, None),  # generated must say generated
            ("manual", "manual", "req_" + "1" * 24, None),  # manual has no request
            ("manual", "manual", None, "summon-1"),  # manual has no prompt version
            ("manual", "generated", None, "summon-1"),  # manual must say manual
        ):
            with pytest.raises(sqlite3.IntegrityError):
                db.execute(insert, (change, source, request, prompt))
        db.execute(insert, ("manual", "manual", None, None))
    finally:
        db.close()


def test_a_request_can_be_accepted_into_only_one_revision(conn: sqlite3.Connection) -> None:
    conn.execute(
        "UPDATE specter SET version = 3, updated_ms = 9999999999999 WHERE specter_id = ?",
        (FIXTURE_SPECTER,),
    )
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO specter_revision (specter_id, revision_no, change, profile_json, source,"
            " request_id, prompt_version, created_ms) VALUES (?, 3, 'generated', '{}', 'generated',"
            " 'req_000000000000000000000001', 'summon-1', 9)",
            (FIXTURE_SPECTER,),
        )


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE specter_revision SET profile_json = '{}'",
        "DELETE FROM specter_revision",
        "UPDATE asset SET label = 'changed'",
        "DELETE FROM asset",
        "DELETE FROM specter",
        "DELETE FROM generation_request",
        "UPDATE specter SET version = 4",
        "UPDATE specter SET version = 1",
        "UPDATE specter SET binding_id = 'bnd_" + "f" * 24 + "', version = 3",
        "UPDATE specter SET specter_id = 'spc_" + "f" * 24 + "', version = 3",
        "UPDATE specter SET created_ms = 0, version = 3",
        "UPDATE generation_request SET status = 'running'",
        "UPDATE generation_request SET status = 'superseded'",
        "UPDATE generation_request SET keep_json = '[\"name\"]'",
        "UPDATE generation_request SET prompt_version = 'other'",
        "UPDATE generation_request SET attempts = 2",
    ],
)
def test_history_and_guarded_rows_cannot_be_rewritten(
    conn: sqlite3.Connection, statement: str
) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(statement)


def test_an_archived_specter_is_frozen_and_frees_its_binding(conn: sqlite3.Connection) -> None:
    conn.execute(
        "UPDATE specter SET version = 3, archived_ms = 1767225607000,"
        " updated_ms = 1767225607000 WHERE specter_id = ?",
        (FIXTURE_SPECTER,),
    )
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("UPDATE specter SET version = 4 WHERE specter_id = ?", (FIXTURE_SPECTER,))
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("UPDATE specter SET archived_ms = NULL, version = 4")
    conn.execute(
        "INSERT INTO specter (specter_id, binding_id, version, created_ms, updated_ms)"
        " VALUES (?, ?, 1, 100, 100)",
        ("spc_" + "3" * 24, FIXTURE_BINDING),
    )


LEGAL = {
    ("queued", "running"),
    ("queued", "failed"),
    ("queued", "cancelled"),
    ("running", "ready"),
    ("running", "failed"),
    ("running", "cancelled"),
    ("ready", "accepted"),
    ("ready", "superseded"),
    ("ready", "cancelled"),
}
STATUSES = ("queued", "running", "ready", "failed", "cancelled", "accepted", "superseded")

SHAPES = {
    "queued": ("NULL", "NULL", "NULL", "NULL"),
    "running": ("11", "NULL", "NULL", "NULL"),
    "ready": ("11", "12", "'{}'", "NULL"),
    "accepted": ("11", "12", "'{}'", "NULL"),
    "superseded": ("11", "12", "'{}'", "NULL"),
    "failed": ("NULL", "12", "NULL", "'timeout'"),
    "cancelled": ("NULL", "12", "NULL", "NULL"),
}


@pytest.mark.parametrize("old", STATUSES)
@pytest.mark.parametrize("new", STATUSES)
def test_only_the_documented_status_transitions_are_possible(
    conn: sqlite3.Connection, old: str, new: str
) -> None:
    start, finish, candidate, error = SHAPES[old]
    conn.execute(
        "INSERT INTO generation_request (request_id, binding_id, status, keep_json,"
        " prompt_version, candidate_json, error_code, attempts, internal_tag, created_ms,"
        f" started_ms, finished_ms) VALUES ('req_{'7' * 24}', '{FIXTURE_BINDING}', '{old}', '[]',"
        f" 'summon-1', {candidate}, {error}, 0, 'summoning', 10, {start}, {finish})"
    )
    start, finish, candidate, error = SHAPES[new]
    # Keep started_ms when the new state needs it and the old state had none.
    if new in {"ready", "accepted", "superseded"} and old == "queued":
        start = "11"
    update = (
        f"UPDATE generation_request SET status = '{new}', started_ms = {start},"
        f" finished_ms = {finish}, candidate_json = {candidate}, error_code = {error}"
        f" WHERE request_id = 'req_{'7' * 24}'"
    )
    if (old, new) in LEGAL:
        conn.execute(update)
    else:
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(update)


def test_the_specter_store_functions_are_the_only_writers_of_the_new_tables() -> None:
    sources = list((Path(__file__).resolve().parents[1] / "specter_arena").rglob("*.py"))
    writers = [
        path.name
        for path in sources
        if any(
            f"INSERT INTO {table}" in path.read_text(encoding="utf-8")
            or f"UPDATE {table} " in path.read_text(encoding="utf-8")
            for table in OWN_TABLES
        )
    ]
    assert writers == ["specters.py"]
