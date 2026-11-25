import ast
import sqlite3
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest

from backend.specter_arena.store import (
    BindingSeen,
    DmKey,
    IngestBatch,
    IngestItem,
    IngestResult,
    ObservationIn,
    Store,
    StoreStatus,
    StoreUsageError,
    ingest,
    latest_version,
    open_store,
    rebuild_projection,
    row_fact_digest,
    start_run,
)
from backend.specter_arena.store.migrate import load_migrations, migrate, pending, verify_checksums

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "store"
FIXTURE_V3 = FIXTURES / "schema-v3.sql"
FIXTURE_V4 = FIXTURES / "schema-v4.sql"
ALPHA = DmKey("alpha-0123456789ab", "memory-alpha")
BETA = DmKey("beta-0123456789ab", "memory-beta")
ALPHA_KEY = "member-alpha-0123456789ab.memory-memory-alpha"
BETA_KEY = "member-beta-0123456789ab.memory-memory-beta"
WORKER_SLOT = "chat-61-1794779966"
T0 = 1_800_000_000_000
RUN = "run-00000001"
STORE_DIR = Path(__file__).resolve().parents[1] / "specter_arena" / "store"


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    opened = open_store(tmp_path / "data")
    try:
        start_run(opened, run_id=RUN, now_ms=T0 - 1)
        run(opened, BindingSeen(ALPHA, T0), BindingSeen(BETA, T0))
        yield opened
    finally:
        opened.close()


def installation(opened: Store) -> str:
    with opened.read() as conn:
        return str(conn.execute("SELECT store_id FROM store_meta").fetchone()[0])


def run(opened: Store, *items: IngestItem) -> IngestResult:
    return ingest(opened, IngestBatch(RUN, installation(opened), items))


def row(
    opened: Store,
    ms: int,
    key: str = ALPHA_KEY,
    slot: str | None = None,
    **facts: Any,
) -> ObservationIn:
    payload: dict[str, Any] = {"running": True, **facts}
    turn = payload.get("turn")
    gen = payload.get("turnGen")
    return ObservationIn(
        installation_id=installation(opened),
        dm_key=key,
        slot_key=slot or key,
        kind="row-change",
        event_type="slot-row",
        received_at_ms=ms,
        payload=payload,
        turn=turn,
        turn_gen=gen,
        fact_digest=row_fact_digest(payload),
    )


def done(
    opened: Store, ms: int, turn: int, gen: str = "ab12", key: str = ALPHA_KEY
) -> ObservationIn:
    return ObservationIn(
        installation_id=installation(opened),
        dm_key=key,
        slot_key=key,
        kind="event",
        event_type="chat_done",
        received_at_ms=ms,
        payload={"continuing": False},
        turn=turn,
        turn_gen=gen,
        dedup_key=f"chat_done:{gen}:{turn}",
    )


def table(opened: Store, sql: str) -> list[tuple[Any, ...]]:
    with opened.read() as conn:
        return [tuple(r) for r in conn.execute(sql)]


STATE_SQL = "SELECT * FROM bot_state ORDER BY binding_id"
ATTEMPT_SQL = "SELECT * FROM attempt ORDER BY attempt_id"
EVIDENCE_SQL = (
    "SELECT (SELECT count(*) FROM observation), (SELECT count(*) FROM quarantine),"
    " (SELECT count(*) FROM bot_binding), (SELECT count(*) FROM bot_presence),"
    " (SELECT count(*) FROM collector_run), (SELECT count(*) FROM coverage_interval),"
    " (SELECT count(*) FROM slot_seen), (SELECT group_concat(payload) FROM observation)"
)


def scenario(opened: Store) -> list[ObservationIn]:
    worker: dict[str, Any] = {"createdBy": ALPHA_KEY, "createdMs": 7}
    return [
        row(opened, T0 + 1, turn=1, turnGen="ab12", lastActivityMs=10),
        row(opened, T0 + 2, turn=1, turnGen="ab12", lastActivityMs=10),
        row(opened, T0 + 3, slot=WORKER_SLOT, **worker),
        done(opened, T0 + 4, 1),
        row(opened, T0 + 5, turn=2, turnGen="ab12", lastActivityMs=20, pendingApproval=True),
        row(opened, T0 + 6, turn=1, turnGen="ab12", lastActivityMs=5, running=False),
        row(opened, T0 + 7, slot=WORKER_SLOT, running=False, **worker),
        row(opened, T0 + 8, turn=1, turnGen="cd34", lastActivityMs=1, needsInput=True),
        done(opened, T0 + 9, 1, "cd34"),
        row(opened, T0 + 10, key=BETA_KEY, turn=4, turnGen="ef56", running=False),
        row(opened, T0 + 11, key=BETA_KEY, turn=5, turnGen="ef56"),
    ]


def run_scenario(opened: Store) -> None:
    for item in scenario(opened):
        run(opened, item)


def test_the_incremental_projection_equals_a_rebuild(store: Store) -> None:
    run_scenario(store)
    incremental = (table(store, STATE_SQL), table(store, ATTEMPT_SQL))
    assert len(incremental[0]) == 2 and len(incremental[1]) >= 3
    report = rebuild_projection(store, as_of_ms=T0 + 99)
    assert (table(store, STATE_SQL), table(store, ATTEMPT_SQL)) == incremental
    assert (report.as_of_ms, report.observations_folded) == (T0 + 99, 10)
    assert (report.bot_states, report.attempts) == (2, len(incremental[1]))


def test_a_batch_folds_the_same_as_one_by_one(tmp_path: Path) -> None:
    single = open_store(tmp_path / "single")
    batch = open_store(tmp_path / "batch")
    try:
        for opened in (single, batch):
            start_run(opened, run_id=RUN, now_ms=T0 - 1)
            run(opened, BindingSeen(ALPHA, T0), BindingSeen(BETA, T0))
        run_scenario(single)
        run(batch, *scenario(batch))

        def shape(opened: Store) -> list[tuple[Any, ...]]:
            rows = table(
                opened,
                "SELECT turn, turn_gen, running, observed_seq FROM bot_state ORDER BY dm_slot_key",
            )
            return rows + table(
                opened,
                "SELECT kind, running, started_seq, ended_seq FROM attempt ORDER BY started_seq",
            )

        assert shape(single) == shape(batch)
    finally:
        single.close()
        batch.close()


def test_the_bot_state_after_the_scenario(store: Store) -> None:
    run_scenario(store)
    alpha = table(
        store,
        "SELECT running, turn, turn_gen, needs_input, pending_approval, last_terminal_turn,"
        " last_terminal_gen, row_observed_ms, event_observed_ms FROM bot_state"
        " WHERE dm_slot_key = '" + ALPHA_KEY + "'",
    )
    assert alpha == [(1, 1, "cd34", 1, None, 1, "cd34", T0 + 8, T0 + 9)]
    beta = table(
        store, "SELECT running, turn FROM bot_state WHERE dm_slot_key = '" + BETA_KEY + "'"
    )
    assert beta == [(1, 5)]


def test_a_stale_row_stays_evidence_but_does_not_change_the_state(store: Store) -> None:
    run(store, row(store, T0 + 1, turn=5, turnGen="ab12"))
    result = run(store, row(store, T0 + 2, turn=2, turnGen="ab12", running=False))
    assert result.counts["observation"].persisted == 1
    assert table(store, "SELECT running, turn, row_observed_ms FROM bot_state") == [(1, 5, T0 + 1)]
    assert table(store, "SELECT count(*) FROM observation") == [(2,)]


def test_attempts_open_and_close_with_deterministic_ids(store: Store) -> None:
    run(store, row(store, T0 + 1, turn=1, turnGen="ab12"))
    (opened,) = table(store, ATTEMPT_SQL)
    assert opened[2] == "bot-turn" and opened[9] == 1 and opened[6] is None
    run(store, row(store, T0 + 2, turn=1, turnGen="ab12", lastActivityMs=3, running=False))
    (closed,) = table(store, ATTEMPT_SQL)
    assert closed[0] == opened[0]
    assert (closed[9], closed[8], closed[6]) == (0, "row-idle", T0 + 2)
    run(store, row(store, T0 + 3, turn=2, turnGen="ab12"))
    assert len(table(store, ATTEMPT_SQL)) == 2
    ids = {r[0] for r in table(store, ATTEMPT_SQL)}
    rebuild_projection(store, as_of_ms=T0 + 9)
    assert {r[0] for r in table(store, ATTEMPT_SQL)} == ids
    assert opened[0] in ids


def test_chat_done_closes_the_open_attempt(store: Store) -> None:
    run(store, row(store, T0 + 1, turn=1, turnGen="ab12"))
    run(store, done(store, T0 + 2, 1))
    assert table(store, "SELECT running, end_signal, ended_ms FROM attempt") == [
        (0, "chat_done", T0 + 2)
    ]


def test_a_worker_attempt_is_counted_and_closed_by_its_idle_row(store: Store) -> None:
    worker: dict[str, Any] = {"createdBy": ALPHA_KEY, "createdMs": 7}
    run(store, row(store, T0 + 1, slot=WORKER_SLOT, **worker))
    assert table(store, "SELECT kind, running FROM attempt") == [("worker", 1)]
    assert table(store, "SELECT count(*) FROM bot_state") == [(0,)]
    run(store, row(store, T0 + 2, slot=WORKER_SLOT, running=False, **worker))
    assert table(store, "SELECT running, end_signal FROM attempt") == [(0, "row-idle")]


def test_events_before_any_row_create_a_state_with_no_facts(store: Store) -> None:
    run(store, done(store, T0 + 1, 1))
    assert table(store, "SELECT running, row_observed_ms, event_observed_ms FROM bot_state") == [
        (None, None, T0 + 1)
    ]
    assert table(store, "SELECT count(*) FROM attempt") == [(0,)]


def test_worker_events_do_not_touch_the_bot_state(store: Store) -> None:
    event = replace(done(store, T0 + 1, 1), slot_key=WORKER_SLOT)
    assert run(store, event).counts["observation"].persisted == 1
    assert table(store, "SELECT count(*) FROM bot_state") == [(0,)]


# slot_seen ------------------------------------------------------------------------------------


def test_slot_seen_tracks_the_newest_receive_and_activity_times(store: Store) -> None:
    run(store, row(store, T0 + 5, turn=1, turnGen="ab12", lastActivityMs=40))
    run(store, row(store, T0 + 3, turn=1, turnGen="ab12", lastActivityMs=20, running=False))
    run(store, row(store, T0 + 9, slot=WORKER_SLOT, createdBy=ALPHA_KEY))
    seen = table(
        store, "SELECT slot_key, last_seen_ms, last_activity_ms FROM slot_seen ORDER BY slot_key"
    )
    assert seen == [(WORKER_SLOT, T0 + 9, None), (ALPHA_KEY, T0 + 5, 40)]


def test_a_duplicate_touches_slot_seen_and_nothing_else(store: Store) -> None:
    first = row(store, T0 + 1, turn=1, turnGen="ab12", lastActivityMs=5)
    run(store, first)
    before = table(store, "SELECT count(*) FROM observation")
    again = run(
        store,
        replace(first, received_at_ms=T0 + 50, payload={**first.payload, "lastActivityMs": 99}),
    )
    assert again.counts["observation"].deduplicated == 1
    assert table(store, "SELECT count(*) FROM observation") == before
    assert table(store, "SELECT last_seen_ms, last_activity_ms FROM slot_seen") == [(T0 + 50, 99)]
    event = done(store, T0 + 60, 1)
    run(store, event, replace(event, received_at_ms=T0 + 70))
    assert table(store, "SELECT last_seen_ms FROM slot_seen") == [(T0 + 70,)]


# rebuild --------------------------------------------------------------------------------------


def test_rebuild_changes_nothing_but_the_projection_and_the_revision(store: Store) -> None:
    run_scenario(store)
    before = table(store, EVIDENCE_SQL)
    revision = table(store, "SELECT revision FROM collector_setting")[0][0]
    rebuild_projection(store, as_of_ms=T0 + 5)
    assert table(store, EVIDENCE_SQL) == before
    assert table(store, "SELECT revision FROM collector_setting") == [(revision + 1,)]


def test_rebuild_repairs_a_damaged_projection(store: Store) -> None:
    run_scenario(store)
    good = (table(store, STATE_SQL), table(store, ATTEMPT_SQL))
    with store.write() as conn:
        conn.execute("UPDATE bot_state SET running = 0, turn = 99")
        conn.execute("DELETE FROM attempt")
    rebuild_projection(store, as_of_ms=T0)
    assert (table(store, STATE_SQL), table(store, ATTEMPT_SQL)) == good


def test_rebuild_of_an_empty_store_is_an_empty_report(tmp_path: Path) -> None:
    opened = open_store(tmp_path / "data")
    try:
        report = rebuild_projection(opened, as_of_ms=5)
        assert (
            report.observations_folded,
            report.bot_states,
            report.attempts,
            report.last_seq,
        ) == (
            0,
            0,
            0,
            None,
        )
    finally:
        opened.close()


@pytest.mark.parametrize("as_of_ms", [-1, True, 1.5])
def test_rebuild_refuses_a_bad_time(store: Store, as_of_ms: Any) -> None:
    with pytest.raises(StoreUsageError):
        rebuild_projection(store, as_of_ms=as_of_ms)


def test_the_store_modules_that_rebuild_import_no_network_or_clock_module() -> None:
    forbidden = {"socket", "http", "urllib", "ssl", "asyncio", "requests", "time", "datetime"}
    for name in ("fold.py", "projection.py", "roster.py", "observations.py", "runs.py"):
        tree = ast.parse((STORE_DIR / name).read_text(encoding="utf-8"))
        imported = {
            part.split(".")[0]
            for node in ast.walk(tree)
            if isinstance(node, ast.Import)
            for part in (alias.name for alias in node.names)
        } | {
            (node.module or "").split(".")[0]
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom) and node.level == 0
        }
        assert imported & forbidden == set(), name


# migration 0004 ------------------------------------------------------------------------------


def test_an_empty_store_has_the_projection_tables(tmp_path: Path) -> None:
    opened = open_store(tmp_path / "data")
    try:
        assert opened.status() == StoreStatus("ready", latest_version(), latest_version())
        assert latest_version() >= 4
        names = {n for (n,) in table(opened, "SELECT name FROM sqlite_master")}
        assert {"bot_state", "attempt", "slot_seen", "attempt_by_binding"} <= names
    finally:
        opened.close()


def test_the_frozen_v4_fixture_has_the_schema_the_migrations_create(tmp_path: Path) -> None:
    fixture = sqlite3.connect(tmp_path / "fixture.db", isolation_level=None)
    fixture.executescript(FIXTURE_V4.read_text(encoding="utf-8"))
    migrated = sqlite3.connect(tmp_path / "migrated.db", isolation_level=None)
    through_v4 = load_migrations()[:4]
    migrate(migrated, through_v4)
    try:
        query = "SELECT type, name, sql FROM sqlite_master ORDER BY type, name"

        def normalised(conn: sqlite3.Connection) -> list[tuple[str, str, str]]:
            return [(a, b, " ".join((c or "").split())) for a, b, c in conn.execute(query)]

        assert normalised(fixture) == normalised(migrated)
        verify_checksums(fixture, through_v4)
        assert pending(fixture, through_v4) == []
    finally:
        fixture.close()
        migrated.close()


def test_the_v3_fixture_upgrades_to_the_projection_schema_and_rebuilds(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    (data_dir / "store").mkdir(parents=True)
    conn = sqlite3.connect(data_dir / "store" / "specter-arena.db", isolation_level=None)
    conn.executescript(FIXTURE_V3.read_text(encoding="utf-8"))
    conn.close()
    opened = open_store(data_dir)
    try:
        assert opened.status().state == "ready"
        assert table(opened, "SELECT count(*) FROM bot_state") == [(0,)]
        report = rebuild_projection(opened, as_of_ms=T0)
        assert (report.observations_folded, report.bot_states, report.attempts) == (1, 1, 1)
    finally:
        opened.close()


def test_the_v4_fixture_upgrades_and_keeps_its_projection(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    (data_dir / "store").mkdir(parents=True)
    conn = sqlite3.connect(data_dir / "store" / "specter-arena.db", isolation_level=None)
    conn.executescript(FIXTURE_V4.read_text(encoding="utf-8"))
    conn.close()
    opened = open_store(data_dir)
    try:
        assert opened.status().state == "ready"
        assert table(opened, "SELECT count(*) FROM bot_state") == [(1,)]
        assert table(opened, "SELECT count(*) FROM slot_seen") == [(1,)]
    finally:
        opened.close()


STATE_INSERT = "INSERT INTO bot_state (binding_id, dm_slot_key, {}, observed_seq) VALUES (?, {}, 0)"
ATTEMPT_VALUES = "INSERT INTO attempt VALUES ({}, ?, 'bot-turn', 'k', 0, {}, NULL, NULL, NULL, {})"
GOOD_ID = "'att_000000000000000000000001'"


@pytest.mark.parametrize(
    "statement",
    [
        STATE_INSERT.format("extra_facts", "'k', 'nope'"),
        STATE_INSERT.format("extra_facts, running", "'k', '{}', 2"),
        STATE_INSERT.format("extra_facts", "'', '{}'"),
        ATTEMPT_VALUES.format("'att_short'", 1, 1),
        ATTEMPT_VALUES.format(GOOD_ID, 0, 1),
        ATTEMPT_VALUES.format(GOOD_ID, 1, 2),
        "INSERT INTO slot_seen VALUES (?, 'k', -1, NULL)",
        "INSERT INTO slot_seen VALUES ('bnd_unknown', 'k', 0, NULL), (?, 'k', 0, NULL)",
    ],
)
def test_the_projection_tables_refuse_bad_rows(store: Store, statement: str) -> None:
    binding = table(store, "SELECT binding_id FROM bot_binding ORDER BY binding_seq")[0][0]
    with pytest.raises(sqlite3.IntegrityError), store.write() as conn:
        conn.execute(statement, (binding,))
