import sqlite3
from pathlib import Path

import pytest

from backend.specter_arena.store import (
    BindingSeen,
    DmKey,
    IngestBatch,
    Store,
    StoreStatus,
    ingest,
    latest_version,
    open_store,
    start_run,
)
from backend.specter_arena.store.migrate import (
    load_migrations,
    migrate,
    pending,
    verify_checksums,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "store"
FIXTURE_V2 = FIXTURES / "schema-v2.sql"
FIXTURE_V3 = FIXTURES / "schema-v3.sql"
FIXTURE_V3_STORE_ID = "00000000-0000-4000-8000-000000000003"
BINDING = "bnd_000000000000000000000001"
KEY = DmKey("fixture-bot", "fixture-store")


def place(data_dir: Path, fixture: Path) -> None:
    (data_dir / "store").mkdir(parents=True)
    conn = sqlite3.connect(data_dir / "store" / "specter-arena.db", isolation_level=None)
    conn.executescript(fixture.read_text(encoding="utf-8"))
    conn.close()


def scalar(opened: Store, sql: str, *params: object) -> object:
    with opened.read() as conn:
        return conn.execute(sql, params).fetchone()[0]


def test_an_empty_store_has_the_observation_and_coverage_tables(tmp_path: Path) -> None:
    opened = open_store(tmp_path / "data")
    try:
        assert opened.status() == StoreStatus("ready", latest_version(), latest_version())
        assert latest_version() >= 3
        with opened.read() as conn:
            names = {n for (n,) in conn.execute("SELECT name FROM sqlite_master")}
        assert {
            "observation",
            "quarantine",
            "collector_run",
            "coverage_interval",
            "collector_setting",
            "observation_event_dedup",
            "observation_row_latest",
            "coverage_open_covered",
            "coverage_open_gap",
        } <= names
        assert scalar(opened, "SELECT revision FROM collector_setting") == 0
        assert scalar(opened, "SELECT paused FROM collector_setting") == 0
    finally:
        opened.close()


def test_the_frozen_v3_fixture_has_the_schema_the_migrations_create(tmp_path: Path) -> None:
    fixture = sqlite3.connect(tmp_path / "fixture.db", isolation_level=None)
    fixture.executescript(FIXTURE_V3.read_text(encoding="utf-8"))
    migrated = sqlite3.connect(tmp_path / "migrated.db", isolation_level=None)
    through_v3 = load_migrations()[:3]
    migrate(migrated, through_v3)
    try:
        query = "SELECT type, name, sql FROM sqlite_master ORDER BY type, name"

        def normalised(conn: sqlite3.Connection) -> list[tuple[str, str, str]]:
            return [(a, b, " ".join((c or "").split())) for a, b, c in conn.execute(query)]

        assert normalised(fixture) == normalised(migrated)
        verify_checksums(fixture, through_v3)
        assert pending(fixture, through_v3) == []
    finally:
        fixture.close()
        migrated.close()


def test_the_v2_fixture_upgrades_and_keeps_its_seeded_bindings(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    place(data_dir, FIXTURE_V2)
    opened = open_store(data_dir)
    try:
        assert opened.status().state == "ready"
        assert scalar(opened, "SELECT count(*) FROM bot_binding") == 1
        assert scalar(opened, "SELECT count(*) FROM observation") == 0
        assert scalar(opened, "SELECT revision FROM collector_setting") == 0
        assert scalar(opened, "SELECT paused FROM collector_setting") == 0
    finally:
        opened.close()
    assert len(list((data_dir / "store" / "backups").glob("pre-migrate-v2-to-v*.db"))) == 1


def test_the_v3_fixture_upgrades_and_keeps_its_seeded_evidence(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    place(data_dir, FIXTURE_V3)
    opened = open_store(data_dir)
    try:
        assert opened.status().state == "ready"
        assert scalar(opened, "SELECT count(*) FROM observation") == 1
        assert scalar(opened, "SELECT count(*) FROM quarantine") == 1
        assert scalar(opened, "SELECT revision FROM collector_setting") == 1
        run = start_run(opened, run_id="run-00000002", now_ms=1_767_225_700_000)
        assert run.recovered_runs == 0
        assert run.previous_ended_ms == 1_767_225_660_000
        assert [b.binding_id for b in run.bindings] == [BINDING]
        assert (run.bindings[0].last_turn, run.bindings[0].last_turn_gen) == (1, "abc123")
        assert run.last_turn_gen == "abc123"
    finally:
        opened.close()


def test_evidence_survives_a_restart(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    first = open_store(data_dir)
    try:
        run = start_run(first, run_id="run-00000001", now_ms=1_000)
        result = ingest(
            first,
            IngestBatch(run.run_id, run.installation_id, (BindingSeen(KEY, 1_000),)),
        )
        assert result.counts["binding"].persisted == 1
    finally:
        first.close()
    second = open_store(data_dir)
    try:
        assert scalar(second, "SELECT count(*) FROM bot_binding") == 1
        assert scalar(second, "SELECT count(*) FROM collector_run") == 1
    finally:
        second.close()


@pytest.fixture
def store(tmp_path: Path) -> Store:
    opened = open_store(tmp_path / "data")
    with opened.write() as conn:
        conn.execute(
            "INSERT INTO bot_binding"
            " (binding_id, installation_id, dm_key, member_id, memory_store, first_seen_ms)"
            " SELECT ?, store_id, 'member-x.memory-s', 'x', 's', 0 FROM store_meta",
            (BINDING,),
        )
        conn.execute(
            "INSERT INTO collector_run (run_id, started_ms, last_heartbeat_ms)"
            " VALUES ('run-00000001', 0, 0)"
        )
    return opened


OBSERVATION_INSERT = (
    "INSERT INTO observation (binding_id, kind, event_type, source, slot_key, turn, turn_gen,"
    " tool_call_id, dedup_key, fact_digest, received_at_ms, source_time_ms, origin,"
    " contract_version, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
)


def observation_row(**overrides: object) -> tuple[object, ...]:
    base: dict[str, object] = {
        "binding_id": BINDING,
        "kind": "event",
        "event_type": "chat_done",
        "source": "crew-ws",
        "slot_key": "member-x.memory-s",
        "turn": 1,
        "turn_gen": "ab12",
        "tool_call_id": None,
        "dedup_key": None,
        "fact_digest": None,
        "received_at_ms": 5,
        "source_time_ms": None,
        "origin": "live",
        "contract_version": 1,
        "payload": "{}",
    }
    base.update(overrides)
    return tuple(base.values())


@pytest.mark.parametrize(
    "overrides",
    [
        {"binding_id": "bnd_" + "9" * 24},
        {"kind": ""},
        {"kind": "k" * 17},
        {"event_type": "e" * 41},
        {"source": ""},
        {"slot_key": ""},
        {"slot_key": "s" * 257},
        {"turn": -1},
        {"turn_gen": "XYZ"},
        {"turn_gen": "a" * 17},
        {"turn_gen": ""},
        {"tool_call_id": "t" * 129},
        {"dedup_key": ""},
        {"dedup_key": "d" * 513},
        {"fact_digest": "f" * 63},
        {"received_at_ms": -1},
        {"source_time_ms": -1},
        {"origin": "recorded-ish"},
        {"contract_version": 0},
        {"payload": "not json"},
        {"payload": '{"a":"' + "x" * 65_536 + '"}'},
    ],
)
def test_the_observation_table_rejects_out_of_bounds_values(
    store: Store, overrides: dict[str, object]
) -> None:
    with pytest.raises(sqlite3.IntegrityError), store.write() as conn:
        conn.execute(OBSERVATION_INSERT, observation_row(**overrides))


def test_the_observation_table_accepts_the_boundary_values(store: Store) -> None:
    edge = observation_row(
        kind="k" * 16,
        event_type="e" * 40,
        slot_key="s" * 256,
        turn_gen="a" * 16,
        tool_call_id="t" * 128,
        dedup_key="d" * 512,
        fact_digest="f" * 64,
        origin="fixture",
    )
    with store.write() as conn:
        conn.execute(OBSERVATION_INSERT, edge)
        conn.execute(OBSERVATION_INSERT, observation_row(payload='{"a":"' + "x" * 65_000 + '"}'))
    assert scalar(store, "SELECT count(*) FROM observation") == 2


def test_the_open_interval_indexes_allow_one_open_covered_and_one_open_gap(store: Store) -> None:
    insert = (
        "INSERT INTO coverage_interval (run_id, state, start_ms, end_ms, reason)"
        " VALUES ('run-00000001', ?, 0, NULL, ?)"
    )
    with store.write() as conn:
        conn.execute(insert, ("covered", None))
        conn.execute(insert, ("gap", "restart"))
    for state, reason in (("covered", None), ("gap", "restart")):
        with pytest.raises(sqlite3.IntegrityError), store.write() as conn:
            conn.execute(insert, (state, reason))


@pytest.mark.parametrize(
    "values",
    [
        ("covered", 5, 4, None),
        ("gap", 0, None, None),
        ("other", 0, None, None),
    ],
)
def test_coverage_intervals_refuse_bad_shapes(
    store: Store, values: tuple[str, int, int | None, str | None]
) -> None:
    with pytest.raises(sqlite3.IntegrityError), store.write() as conn:
        conn.execute(
            "INSERT INTO coverage_interval (run_id, state, start_ms, end_ms, reason)"
            " VALUES ('run-00000001', ?, ?, ?, ?)",
            values,
        )


@pytest.mark.parametrize(
    "values",
    [
        (5, "r", "t", 1, None, 0, 5),
        (5, "r", "t", 1, None, 2**31 + 1, 5),
        (5, "r", "t", 1, None, 1, 6),
        (5, "r", "t", 1, "sha256:ABCDEFABCDEF", 1, 5),
        (5, "r", "t", 1, "sha256:abcdef", 1, 5),
        (5, "r", "t", -1, None, 1, 5),
        (5, "r" * 41, "t", 1, None, 1, 5),
        (5, "r", "t" * 65, 1, None, 1, 5),
    ],
)
def test_the_quarantine_table_refuses_bad_rows(store: Store, values: tuple[object, ...]) -> None:
    with pytest.raises(sqlite3.IntegrityError), store.write() as conn:
        conn.execute(
            "INSERT INTO quarantine (run_id, received_at_ms, reason, frame_type, size_bytes,"
            " digest, count, first_received_at_ms) VALUES ('run-00000001', ?, ?, ?, ?, ?, ?, ?)",
            values,
        )


def test_the_quarantine_table_accepts_its_boundaries(store: Store) -> None:
    with store.write() as conn:
        conn.execute(
            "INSERT INTO quarantine (run_id, received_at_ms, reason, frame_type, size_bytes,"
            " digest, count, first_received_at_ms)"
            " VALUES ('run-00000001', 5, ?, ?, 0, 'sha256:0123456789ab', 2147483648, 5)",
            ("r" * 40, "t" * 64),
        )
    assert scalar(store, "SELECT count(*) FROM quarantine") == 1


def test_observation_and_quarantine_are_append_only(store: Store) -> None:
    with store.write() as conn:
        conn.execute(OBSERVATION_INSERT, observation_row())
        conn.execute(
            "INSERT INTO quarantine (run_id, received_at_ms, reason, frame_type, size_bytes,"
            " first_received_at_ms) VALUES ('run-00000001', 5, 'r', 't', 0, 5)"
        )
    for statement in (
        "UPDATE observation SET turn = 2",
        "DELETE FROM observation",
        "UPDATE quarantine SET count = 2",
        "DELETE FROM quarantine",
    ):
        with pytest.raises(sqlite3.IntegrityError, match="append-only"), store.write() as conn:
            conn.execute(statement)


def test_the_settings_row_is_a_singleton_with_a_boolean_flag(store: Store) -> None:
    for statement in (
        "INSERT INTO collector_setting (singleton, paused, changed_at_ms, revision)"
        " VALUES (2, 0, 0, 0)",
        "UPDATE collector_setting SET paused = 2",
        "UPDATE collector_setting SET revision = -1",
    ):
        with pytest.raises(sqlite3.IntegrityError), store.write() as conn:
            conn.execute(statement)
