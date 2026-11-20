import itertools
import sqlite3
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

import backend.specter_arena.store as store_package
from backend.specter_arena.store import (
    SchemaNewer,
    StoreStatus,
    WorkProgress,
    decide_work,
    get_work,
    latest_version,
    open_store,
    rebuild_projection,
    xp_summary,
)
from backend.specter_arena.store.migrate import (
    check_sequence,
    load_migrations,
    migrate,
    pending,
    verify_checksums,
)
from backend.specter_arena.store.work import ACTIONS, STATES, TRANSITIONS

from .work_fakes import T0, ledger_hash, make_work, open_seeded, query, submit_and_accept

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "store"
FIXTURE_V5 = FIXTURES / "schema-v5.sql"
FIXTURE_V6 = FIXTURES / "schema-v6.sql"
FIXTURE_BINDING = "bnd_000000000000000000000001"
FIXTURE_ACCEPTED = "wrk_000000000000000000000001"
FIXTURE_OPEN = "wrk_000000000000000000000002"
FIXTURE_REVISION = "50583c64149211559a9f6ecc"
LEDGER_TABLES = ("work_item", "work_attempt", "work_milestone", "work_decision", "xp_entry")
IDENTITY_TABLES = ("asset", "hero_assignment", "avatar_revision")
NEW_INDEXES = {
    "work_item_by_created",
    "work_item_by_parent",
    "work_attempt_by_work",
    "work_attempt_by_binding",
    "xp_entry_by_binding",
    "xp_entry_by_work",
}
PACKAGED = load_migrations()
ALL = check_sequence(PACKAGED)


def place(data_dir: Path, fixture: Path) -> None:
    (data_dir / "store").mkdir(parents=True)
    conn = sqlite3.connect(data_dir / "store" / "specter-arena.db", isolation_level=None)
    conn.executescript(fixture.read_text(encoding="utf-8"))
    conn.close()


def normalised(conn: sqlite3.Connection) -> list[tuple[str, str, str]]:
    query_text = "SELECT type, name, sql FROM sqlite_master ORDER BY type, name"
    return [(a, b, " ".join((c or "").split())) for a, b, c in conn.execute(query_text)]


def trigger_names(conn: sqlite3.Connection) -> set[str]:
    return {
        str(n)
        for (n,) in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name IN"
            " ('work_item', 'work_attempt', 'work_milestone', 'work_decision', 'xp_entry')"
        )
    }


def test_the_sixth_migration_names_the_work_tables() -> None:
    assert latest_version() >= 6
    assert PACKAGED[5].name == "work_xp"


def test_a_fresh_store_has_the_work_tables_triggers_and_indexes(tmp_path: Path) -> None:
    opened = open_store(tmp_path / "data")
    try:
        assert opened.status() == StoreStatus("ready", latest_version(), latest_version())
        with opened.read() as conn:
            names = {str(n) for (n,) in conn.execute("SELECT name FROM sqlite_master")}
            for table in LEDGER_TABLES:
                assert conn.execute(f"SELECT count(*) FROM {table}").fetchone() == (0,)
            assert len(trigger_names(conn)) == 27
        assert names >= NEW_INDEXES
        assert set(LEDGER_TABLES) <= names
    finally:
        opened.close()


def test_the_frozen_v6_fixture_has_the_schema_the_migrations_create(tmp_path: Path) -> None:
    fixture = sqlite3.connect(tmp_path / "fixture.db", isolation_level=None)
    fixture.executescript(FIXTURE_V6.read_text(encoding="utf-8"))
    migrated = sqlite3.connect(tmp_path / "migrated.db", isolation_level=None)
    through_v6 = load_migrations()[:6]
    migrate(migrated, through_v6)
    try:
        assert normalised(fixture) == normalised(migrated)
        verify_checksums(fixture, through_v6)
        assert pending(fixture, through_v6) == []
        assert fixture.execute("PRAGMA foreign_key_check").fetchall() == []
    finally:
        fixture.close()
        migrated.close()


def test_the_v5_fixture_upgrades_with_empty_work_tables_and_one_backup(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    place(data_dir, FIXTURE_V5)
    opened = open_store(data_dir)
    try:
        assert opened.status().state == "ready"
        with opened.read() as conn:
            assert conn.execute("PRAGMA user_version").fetchone() == (latest_version(),)
            assert conn.execute("SELECT count(*) FROM hero_assignment").fetchone() == (1,)
            assert conn.execute("SELECT count(*) FROM bot_binding").fetchone() == (1,)
            for table in LEDGER_TABLES:
                assert conn.execute(f"SELECT count(*) FROM {table}").fetchone() == (0,)
    finally:
        opened.close()
    assert list(
        (data_dir / "store" / "backups").glob(f"pre-migrate-v5-to-v{latest_version()}-*.db")
    )


def test_the_v6_fixture_opens_and_serves_its_work(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    place(data_dir, FIXTURE_V6)
    opened = open_store(data_dir)
    try:
        assert opened.status().state == "ready"
        accepted = get_work(opened, FIXTURE_ACCEPTED)
        assert (accepted.state, accepted.version, accepted.bounty_xp) == ("accepted", 3, 100)
        assert [(c.binding_id, c.xp_net) for c in accepted.contributors] == [(FIXTURE_BINDING, 100)]
        recorded = accepted.decisions[-1]
        assert (recorded.action, recorded.evidence_revision) == ("accept", FIXTURE_REVISION)
        assert accepted.evidence_revision == FIXTURE_REVISION
        open_item = get_work(opened, FIXTURE_OPEN)
        assert (open_item.state, open_item.version) == ("open", 2)
        assert open_item.progress == WorkProgress(done=1, total=2)
        summary = xp_summary(opened, FIXTURE_BINDING)
        assert (summary.total_xp, summary.level, summary.accepted_work_count) == (100, 2, 1)
    finally:
        opened.close()


def test_code_that_knows_only_schema_five_refuses_a_version_six_store(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    place(data_dir, FIXTURE_V6)
    db = data_dir / "store" / "specter-arena.db"
    before = db.read_bytes()
    with pytest.raises(SchemaNewer):
        open_store(data_dir, migrations=load_migrations()[:5])
    assert db.read_bytes() == before
    assert not (data_dir / "store" / "backups").exists()


@pytest.fixture
def bare(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    """The v6 schema and seed rows with every ledger trigger dropped: only CHECK, UNIQUE, NOT
    NULL and foreign-key constraints remain, so each bad row below is refused by the table."""
    db = sqlite3.connect(tmp_path / "store.db", isolation_level=None)
    db.execute("PRAGMA foreign_keys = ON")
    db.executescript(FIXTURE_V6.read_text(encoding="utf-8"))
    for name in trigger_names(db):
        db.execute(f"DROP TRIGGER {name}")
    yield db
    db.close()


def work_item_sql(
    work_id: str = "wrk_" + "a" * 24,
    title: str = "t",
    rewardable: int = 1,
    bounty: int = 100,
    state: str = "open",
    token: str = "token-aaaa",
    parent: str = "NULL",
    policy: str = "xp-policy-1",
) -> str:
    return (
        "INSERT INTO work_item (work_id, parent_id, title, acceptance_condition, rewardable,"
        " bounty_xp, policy_version, state, version, request_token, created_ms, updated_ms)"
        f" VALUES ('{work_id}', {parent}, '{title}', 'c', {rewardable}, {bounty}, '{policy}',"
        f" '{state}', 1, '{token}', 10, 10)"
    )


def attempt_sql(
    attempt_id: str = "att_" + "b" * 24, binding: str = FIXTURE_BINDING, kind: str = "worker"
) -> str:
    return (
        "INSERT INTO work_attempt (attempt_id, work_id, binding_id, kind, linked_ms)"
        f" VALUES ('{attempt_id}', '{FIXTURE_OPEN}', '{binding}', '{kind}', 11)"
    )


def milestone_sql(position: int = 3, label: str = "x") -> str:
    return (
        "INSERT INTO work_milestone (work_id, position, label)"
        f" VALUES ('{FIXTURE_OPEN}', {position}, '{label}')"
    )


def decision_sql(
    action: str = "block",
    actor: str = "app-owner",
    revision: str = "NULL",
    evidence: str = "NULL",
    token: str = "token-dddd",
    decision_id: str = "dec_" + "d" * 24,
    seq: int = 1,
    work: str = FIXTURE_OPEN,
) -> str:
    return (
        "INSERT INTO work_decision (decision_id, work_id, seq, action, from_state, to_state,"
        " actor, at_ms, evidence_revision, evidence_json, request_token) VALUES"
        f" ('{decision_id}', '{work}', {seq}, '{action}', 'open', 'blocked', '{actor}',"
        f" 50, {revision}, {evidence}, '{token}')"
    )


def xp_sql(
    kind: str = "award",
    amount: int = 5,
    entry_id: str = "xpe_" + "e" * 24,
    binding: str = FIXTURE_BINDING,
    seq: int = 5,
) -> str:
    return (
        "INSERT INTO xp_entry (entry_id, work_id, binding_id, seq, kind, amount, policy_version,"
        f" decision_id, created_ms) VALUES ('{entry_id}', '{FIXTURE_OPEN}', '{binding}', {seq},"
        f" '{kind}', {amount}, 'xp-policy-1', 'dec_000000000000000000000001', 50)"
    )


BAD_ROWS = {
    "work id shape": (work_item_sql(work_id="wrk_xyz"), "CHECK"),
    "work id upper hex": (work_item_sql(work_id="wrk_" + "A" * 24), "CHECK"),
    "empty title": (work_item_sql(title=""), "CHECK"),
    "title of 121 characters": (work_item_sql(title="x" * 121), "CHECK"),
    "bounty without rewardable": (work_item_sql(rewardable=0, bounty=100), "CHECK"),
    "bounty over the cap": (work_item_sql(bounty=100001), "CHECK"),
    "state outside the seven": (work_item_sql(state="paused"), "CHECK"),
    "request token shape": (work_item_sql(token="bad token!"), "CHECK"),
    "parent is itself": (
        work_item_sql(parent="'wrk_" + "a" * 24 + "'"),
        "FOREIGN KEY|CHECK",
    ),
    "unknown parent": (work_item_sql(parent="'wrk_" + "f" * 24 + "'"), "FOREIGN KEY"),
    "attempt id shape": (attempt_sql("att_xyz"), "CHECK"),
    "attempt kind outside the two": (attempt_sql(kind="specter"), "CHECK"),
    "attempt unknown binding": (attempt_sql(binding="bnd_" + "f" * 24), "FOREIGN KEY"),
    "attempt linked twice": (attempt_sql("att_000000000000000000000002"), "UNIQUE"),
    "milestone position nine": (milestone_sql(9), "CHECK"),
    "milestone position zero": (milestone_sql(0), "CHECK"),
    "milestone empty label": (milestone_sql(3, ""), "CHECK"),
    "milestone duplicate position": (milestone_sql(1), "UNIQUE"),
    "decision actor other than the owner": (decision_sql(actor="alice"), "CHECK"),
    "accept without evidence": (decision_sql(action="accept"), "CHECK"),
    "reject without evidence": (decision_sql(action="reject"), "CHECK"),
    "block with evidence": (
        decision_sql(revision="'" + "a" * 24 + "'", evidence="'[]'"),
        "CHECK",
    ),
    "evidence revision shape": (
        decision_sql(action="accept", revision="'xyz'", evidence="'[]'"),
        "CHECK",
    ),
    "evidence is not json": (
        decision_sql(action="accept", revision="'" + "a" * 24 + "'", evidence="'{'"),
        "CHECK",
    ),
    "decision action outside the seven": (decision_sql(action="approve"), "CHECK"),
    "decision token shape": (decision_sql(token="no spaces!"), "CHECK"),
    "decision sequence reused": (
        decision_sql(seq=1, decision_id="dec_" + "9" * 24, work=FIXTURE_ACCEPTED),
        "UNIQUE",
    ),
    "xp amount zero": (xp_sql(amount=0), "CHECK"),
    "xp award with a negative amount": (xp_sql(kind="award", amount=-5), "CHECK"),
    "xp correction with a positive amount": (xp_sql(kind="correction", amount=5), "CHECK"),
    "xp kind outside the three": (xp_sql(kind="bonus"), "CHECK"),
    "xp unknown binding": (xp_sql(binding="bnd_" + "f" * 24), "FOREIGN KEY"),
    "xp entry id shape": (xp_sql(entry_id="xpe_xyz"), "CHECK"),
}


@pytest.mark.parametrize("name", sorted(BAD_ROWS))
def test_the_schema_refuses_a_bad_row(bare: sqlite3.Connection, name: str) -> None:
    statement, kind = BAD_ROWS[name]
    with pytest.raises(sqlite3.IntegrityError, match=kind):
        bare.execute(statement)


def test_a_request_token_cannot_repeat_within_an_item_or_across_items(
    bare: sqlite3.Connection,
) -> None:
    item_token = bare.execute("SELECT request_token FROM work_item LIMIT 1").fetchone()[0]
    with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
        bare.execute(work_item_sql(token=item_token))
    decision_token = bare.execute(
        "SELECT request_token FROM work_decision WHERE work_id = ? AND seq = 1", (FIXTURE_ACCEPTED,)
    ).fetchone()[0]
    with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
        bare.execute(decision_sql(seq=3, token=decision_token, work=FIXTURE_ACCEPTED))


def test_the_bad_rows_are_good_apart_from_their_fault(bare: sqlite3.Connection) -> None:
    bare.execute(work_item_sql())
    bare.execute(attempt_sql())
    bare.execute(milestone_sql())
    bare.execute(decision_sql())
    bare.execute(xp_sql())


W1 = FIXTURE_ACCEPTED
W2 = FIXTURE_OPEN


@pytest.mark.parametrize(
    "statement, message",
    [
        ("UPDATE work_item SET title = 'x'", "illegal work update"),
        ("UPDATE work_item SET title = 'x', version = version + 1", "illegal work update"),
        ("UPDATE work_item SET bounty_xp = 5, version = version + 1", "illegal work update"),
        ("UPDATE work_item SET request_token = 'other'", "illegal work update"),
        ("UPDATE work_item SET parent_id = NULL, work_id = 'wrk_" + "f" * 24 + "'", "illegal"),
        (
            f"UPDATE work_item SET state = 'open', version = version + 1 WHERE work_id = '{W1}'",
            "state changes only through a decision",
        ),
        ("DELETE FROM work_item", "append-only"),
        ("UPDATE work_attempt SET binding_id = binding_id", "append-only"),
        ("DELETE FROM work_attempt", "append-only"),
        ("UPDATE work_milestone SET label = 'y'", "illegal milestone update"),
        ("UPDATE work_milestone SET position = 4", "illegal milestone update"),
        ("DELETE FROM work_milestone", "append-only"),
        ("UPDATE work_decision SET note = 'x'", "append-only"),
        ("DELETE FROM work_decision", "append-only"),
        ("UPDATE xp_entry SET amount = 1", "append-only"),
        ("DELETE FROM xp_entry", "append-only"),
    ],
)
def test_history_and_guarded_rows_cannot_be_rewritten(
    tmp_path: Path, statement: str, message: str
) -> None:
    db = sqlite3.connect(tmp_path / "store.db", isolation_level=None)
    db.execute("PRAGMA foreign_keys = ON")
    db.executescript(FIXTURE_V6.read_text(encoding="utf-8"))
    try:
        with pytest.raises(sqlite3.IntegrityError, match=message):
            db.execute(statement)
    finally:
        db.close()


def test_a_milestone_can_still_be_ticked_and_unticked(tmp_path: Path) -> None:
    db = sqlite3.connect(tmp_path / "store.db", isolation_level=None)
    db.executescript(FIXTURE_V6.read_text(encoding="utf-8"))
    try:
        db.execute("UPDATE work_milestone SET done_ms = NULL WHERE position = 1")
        db.execute("UPDATE work_milestone SET done_ms = 1767225680000 WHERE position = 2")
    finally:
        db.close()


CANDIDATES = [
    ("award", 34),
    ("award", 35),
    ("correction", -34),
    ("correction", -35),
    ("reinstatement", 34),
    ("reinstatement", 35),
]


def chain_oracle(history: list[tuple[str, int]], kind: str, amount: int) -> bool:
    """The rule of the shared contract (SC8-3) for one (work, binding) sequence."""
    if not history:
        return kind == "award" and amount > 0
    previous_kind, previous_amount = history[-1]
    if kind == "correction":
        return previous_kind in ("award", "reinstatement") and amount == -previous_amount
    if kind == "reinstatement":
        return previous_kind == "correction" and amount == history[0][1]
    return False


def test_the_xp_chain_triggers_agree_with_the_oracle_on_every_short_sequence() -> None:
    base = sqlite3.connect(":memory:", isolation_level=None)
    migrate(base, ALL)
    base.execute("PRAGMA foreign_keys = OFF")
    for (name,) in base.execute(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'xp_entry'"
    ).fetchall():
        if name not in ("xp_entry_sequence", "xp_entry_chain"):
            base.execute(f"DROP TRIGGER {name}")
    compared = 0
    mismatches: list[tuple[Any, ...]] = []
    for length in range(1, 6):
        for combo in itertools.product(CANDIDATES, repeat=length):
            base.execute("DELETE FROM xp_entry")
            history: list[tuple[str, int]] = []
            for i, (kind, amount) in enumerate(combo):
                expected = chain_oracle(history, kind, amount)
                try:
                    base.execute(
                        "INSERT INTO xp_entry (entry_id, work_id, binding_id, seq, kind, amount,"
                        " policy_version, decision_id, created_ms) VALUES (?,?,?,?,?,?,'p',?,1)",
                        (
                            f"xpe_{i:024x}",
                            "wrk_" + "0" * 24,
                            "bnd_" + "1" * 24,
                            len(history) + 1,
                            kind,
                            amount,
                            f"dec_{i:024x}",
                        ),
                    )
                    got = True
                except sqlite3.IntegrityError:
                    got = False
                compared += 1
                if got != expected:
                    mismatches.append((combo[: i + 1], got, expected))
                if not got:
                    break
                history.append((kind, amount))
    base.close()
    assert mismatches == []
    assert compared == 13_050


def transition_database(tmp_path: Path) -> sqlite3.Connection:
    db = sqlite3.connect(tmp_path / "transitions.db", isolation_level=None)
    migrate(db, ALL)
    db.execute("PRAGMA foreign_keys = OFF")
    for name in trigger_names(db):
        if name != "work_decision_transition":
            db.execute(f"DROP TRIGGER {name}")
    return db


@pytest.mark.parametrize("action", ACTIONS)
def test_the_sql_transition_table_equals_the_python_one(tmp_path: Path, action: str) -> None:
    db = transition_database(tmp_path)
    allowed_from, target = TRANSITIONS[action]
    evidence = action in ("accept", "reject")
    count = 0
    try:
        for state in STATES:
            count += 1
            work_id = f"wrk_{count:024x}"
            db.execute(
                "INSERT INTO work_item (work_id, title, acceptance_condition, rewardable,"
                " bounty_xp, policy_version, state, version, request_token, created_ms,"
                " updated_ms) VALUES (?, 't', 'c', 1, 100, 'xp-policy-1', ?, 1, ?, 10, 10)",
                (work_id, state, f"token-{count:08d}"),
            )
            for to_state in STATES:
                legal = state in allowed_from and to_state == target
                statement = (
                    "INSERT INTO work_decision (decision_id, work_id, seq, action, from_state,"
                    " to_state, actor, at_ms, evidence_revision, evidence_json, request_token)"
                    " VALUES (?, ?, ?, ?, ?, ?, 'app-owner', 20, ?, ?, ?)"
                )
                seq = (
                    1
                    + (
                        db.execute(
                            "SELECT count(*) FROM work_decision WHERE work_id=?", (work_id,)
                        ).fetchone()[0]
                    )
                )
                params = (
                    f"dec_{count:012x}{seq:012x}",
                    work_id,
                    seq,
                    action,
                    state,
                    to_state,
                    "a" * 24 if evidence else None,
                    "[]" if evidence else None,
                    f"tok-{count:04d}{seq:04d}",
                )
                if legal:
                    db.execute(statement, params)
                else:
                    with pytest.raises(sqlite3.IntegrityError, match="illegal transition"):
                        db.execute(statement, params)
    finally:
        db.close()


def test_the_state_and_action_lists_are_the_seven_of_the_shared_contract() -> None:
    assert STATES == (
        "open",
        "awaiting-review",
        "blocked",
        "rejected",
        "cancelled",
        "accepted",
        "reopened",
    )
    assert ACTIONS == ("submit", "accept", "reject", "block", "unblock", "cancel", "reopen")
    assert set(TRANSITIONS) == set(ACTIONS)
    for allowed_from, target in TRANSITIONS.values():
        assert target in STATES and allowed_from <= set(STATES)


@dataclass(frozen=True)
class Probe:
    trigger: str
    setup: Callable[[sqlite3.Connection], object]
    sql: str
    params: tuple[Any, ...]
    message: str


def work_id(n: int) -> str:
    return f"wrk_{n:024x}"


def attempt_id(n: int) -> str:
    return f"att_{n:024x}"


def binding_id(n: int) -> str:
    return f"bnd_{n:024x}"


def decision_id(n: int) -> str:
    return f"dec_{n:024x}"


def entry_id(n: int) -> str:
    return f"xpe_{n:024x}"


ITEM = (
    "INSERT INTO work_item (work_id, parent_id, title, acceptance_condition, rewardable,"
    " bounty_xp, policy_version, state, version, request_token, created_ms, updated_ms)"
    " VALUES (?, ?, 't', 'c', ?, ?, 'xp-policy-1', 'open', 1, ?, 10, 10)"
)
ATT = (
    "INSERT INTO work_attempt (attempt_id, work_id, binding_id, kind, linked_ms)"
    " VALUES (?,?,?,?,11)"
)
DEC = (
    "INSERT INTO work_decision (decision_id, work_id, seq, action, from_state, to_state, actor,"
    " at_ms, evidence_revision, evidence_json, request_token)"
    " VALUES (?,?,?,?,?,?,'app-owner',?,?,?,?)"
)
XP = (
    "INSERT INTO xp_entry (entry_id, work_id, binding_id, seq, kind, amount, policy_version,"
    " decision_id, created_ms) VALUES (?,?,?,?,?,?,'xp-policy-1',?,?)"
)


def probe_database(tmp_path: Path, name: str) -> sqlite3.Connection:
    db = sqlite3.connect(tmp_path / f"{name}.db", isolation_level=None)
    db.execute("PRAGMA foreign_keys = ON")
    migrate(db, ALL)
    installation = db.execute("SELECT store_id FROM store_meta").fetchone()[0]
    for n in (1, 2, 3):
        db.execute(
            "INSERT INTO bot_binding (binding_id, installation_id, dm_key, member_id,"
            " memory_store, first_seen_ms) VALUES (?, ?, ?, ?, ?, 1)",
            (binding_id(n), installation, f"member-b{n}.memory-m{n}", f"b{n}", f"m{n}"),
        )
    for n in range(1, 21):
        db.execute(
            "INSERT INTO attempt (attempt_id, binding_id, kind, slot_key, started_ms, started_seq,"
            " running) VALUES (?, ?, 'bot-turn', 'slot', ?, ?, 0)",
            (attempt_id(n), binding_id((n - 1) % 3 + 1), n, n),
        )
    return db


def item(db: sqlite3.Connection, n: int, parent: int | None = None, rewardable: int = 1) -> None:
    db.execute(
        ITEM,
        (
            work_id(n),
            None if parent is None else work_id(parent),
            rewardable,
            100 if rewardable else 0,
            f"tok-item-{n:04d}",
        ),
    )


def link(db: sqlite3.Connection, w: int, a: int) -> None:
    db.execute(ATT, (attempt_id(a), work_id(w), binding_id((a - 1) % 3 + 1), "bot-turn"))


def decide(
    db: sqlite3.Connection, w: int, seq: int, action: str, frm: str, to: str, at: int = 20
) -> None:
    evidence = action in ("accept", "reject")
    db.execute(
        DEC,
        (
            decision_id(w * 100 + seq),
            work_id(w),
            seq,
            action,
            frm,
            to,
            at,
            "a" * 24 if evidence else None,
            "[]" if evidence else None,
            f"tok-dec-{w:04d}{seq:04d}",
        ),
    )
    db.execute(
        "UPDATE work_item SET state=?, version=version+1, updated_ms=? WHERE work_id=?",
        (to, at, work_id(w)),
    )


def award(
    db: sqlite3.Connection,
    w: int,
    a: int,
    seq: int = 1,
    kind: str = "award",
    amount: int = 100,
    decision: int = 2,
    at: int = 30,
) -> None:
    b = (a - 1) % 3 + 1
    db.execute(
        XP,
        (
            entry_id(w * 1000 + b * 10 + seq),
            work_id(w),
            binding_id(b),
            seq,
            kind,
            amount,
            decision_id(w * 100 + decision),
            at,
        ),
    )


def accepted_leaf(db: sqlite3.Connection, w: int = 1, attempts: tuple[int, ...] = (1,)) -> None:
    item(db, w)
    for a in attempts:
        link(db, w, a)
    decide(db, w, 1, "submit", "open", "awaiting-review")
    decide(db, w, 2, "accept", "awaiting-review", "accepted", 30)


def leaf_with_child(db: sqlite3.Connection) -> None:
    accepted_leaf(db)
    db.execute("DROP TRIGGER work_item_parent_open")
    item(db, 2, parent=1)


def not_rewardable_leaf(db: sqlite3.Connection) -> None:
    item(db, 1, rewardable=0)
    link(db, 1, 1)
    decide(db, 1, 1, "submit", "open", "awaiting-review")
    decide(db, 1, 2, "accept", "awaiting-review", "accepted", 30)


def two_decisions(db: sqlite3.Connection) -> None:
    accepted_leaf(db, 1, attempts=(1, 2))
    award(db, 1, 1, amount=50)
    decide(db, 1, 3, "reopen", "accepted", "reopened", 40)
    decide(db, 1, 4, "submit", "reopened", "awaiting-review", 50)
    decide(db, 1, 5, "accept", "awaiting-review", "accepted", 60)


def eight_contributors(db: sqlite3.Connection) -> None:
    installation = db.execute("SELECT store_id FROM store_meta").fetchone()[0]
    for n in range(4, 11):
        db.execute(
            "INSERT INTO bot_binding (binding_id, installation_id, dm_key, member_id,"
            " memory_store, first_seen_ms) VALUES (?, ?, ?, ?, ?, 1)",
            (binding_id(n), installation, f"member-b{n}.memory-m{n}", f"b{n}", f"m{n}"),
        )
    for i in range(1, 11):
        db.execute(
            "INSERT INTO attempt (attempt_id, binding_id, kind, slot_key, started_ms,"
            " started_seq, running) VALUES (?, ?, 'bot-turn', 'slot', ?, ?, 0)",
            (attempt_id(20 + i), binding_id(i), 20 + i, 20 + i),
        )
    item(db, 1)
    for i in range(1, 9):
        db.execute(ATT, (attempt_id(20 + i), work_id(1), binding_id(i), "bot-turn"))


def milestone_after_a_bump(db: sqlite3.Connection) -> None:
    item(db, 1)
    db.execute("UPDATE work_item SET version=2, updated_ms=11 WHERE work_id=?", (work_id(1),))


def milestone_present(db: sqlite3.Connection) -> None:
    item(db, 1)
    db.execute(
        "INSERT INTO work_milestone (work_id, position, label) VALUES (?,1,'x')", (work_id(1),)
    )


def blocked_after_one(db: sqlite3.Connection) -> None:
    item(db, 1)
    decide(db, 1, 1, "block", "open", "blocked", 50)


def award_after_accept(db: sqlite3.Connection) -> None:
    accepted_leaf(db)
    award(db, 1, 1)


def frozen_contributors(db: sqlite3.Connection) -> None:
    award_after_accept(db)
    db.execute("DROP TRIGGER work_attempt_open")


def three_deep(db: sqlite3.Connection) -> None:
    item(db, 1)
    item(db, 2, 1)
    item(db, 3, 2)


def sixteen_attempts(db: sqlite3.Connection) -> None:
    item(db, 1)
    for a in range(1, 17):
        link(db, 1, a)


def linked_attempt(db: sqlite3.Connection) -> None:
    item(db, 1)
    link(db, 1, 1)


def only_item(db: sqlite3.Connection) -> None:
    item(db, 1)


def milestone_ticked(db: sqlite3.Connection) -> None:
    milestone_present(db)
    db.execute("UPDATE work_item SET version=2, updated_ms=11 WHERE work_id=?", (work_id(1),))


def accepted_item(db: sqlite3.Connection) -> None:
    accepted_leaf(db)


def cancelled_with_milestone(db: sqlite3.Connection) -> None:
    milestone_present(db)
    decide(db, 1, 1, "cancel", "open", "cancelled")


PROBES = [
    Probe(
        "xp_entry_sequence",
        accepted_item,
        XP,
        (entry_id(1), work_id(1), binding_id(1), 2, "award", 100, decision_id(102), 30),
        "xp entry out of sequence",
    ),
    Probe(
        "xp_entry_chain",
        accepted_item,
        XP,
        (entry_id(1), work_id(1), binding_id(1), 1, "correction", -100, decision_id(102), 30),
        "illegal xp entry",
    ),
    Probe(
        "xp_entry_chain",
        award_after_accept,
        XP,
        (entry_id(2), work_id(1), binding_id(1), 2, "reinstatement", 100, decision_id(102), 30),
        "illegal xp entry",
    ),
    Probe(
        "xp_entry_contributor",
        accepted_item,
        XP,
        (entry_id(1), work_id(1), binding_id(2), 1, "award", 100, decision_id(102), 30),
        "beneficiary is not a contributor",
    ),
    Probe(
        "xp_entry_cap",
        accepted_item,
        XP,
        (entry_id(1), work_id(1), binding_id(1), 1, "award", 100000, decision_id(102), 30),
        "award exceeds the bounty",
    ),
    Probe(
        "xp_entry_decision",
        accepted_item,
        XP,
        (entry_id(1), work_id(1), binding_id(1), 1, "award", 100, decision_id(101), 20),
        "xp entry does not match its decision",
    ),
    Probe(
        "xp_entry_leaf",
        leaf_with_child,
        XP,
        (entry_id(1), work_id(1), binding_id(1), 1, "award", 100, decision_id(102), 30),
        "only a rewardable leaf can be awarded",
    ),
    Probe(
        "xp_entry_leaf",
        not_rewardable_leaf,
        XP,
        (entry_id(1), work_id(1), binding_id(1), 1, "award", 1, decision_id(102), 30),
        "only a rewardable leaf can be awarded",
    ),
    Probe(
        "xp_entry_cap",
        two_decisions,
        XP,
        (entry_id(9), work_id(1), binding_id(2), 1, "award", 50, decision_id(105), 60),
        "award exceeds the bounty",
    ),
    Probe(
        "xp_entry_immutable", award_after_accept, "UPDATE xp_entry SET amount=1", (), "append-only"
    ),
    Probe("xp_entry_keep", award_after_accept, "DELETE FROM xp_entry", (), "append-only"),
    Probe(
        "work_item_new",
        lambda db: None,
        ITEM.replace("'open', 1", "'accepted', 1"),
        (work_id(1), None, 1, 100, "tok-item-0001"),
        "work item must start open at version 1",
    ),
    Probe(
        "work_item_parent_open",
        award_after_accept,
        ITEM,
        (work_id(2), work_id(1), 1, 100, "tok-item-0002"),
        "parent locked",
    ),
    Probe(
        "work_item_parent_open",
        accepted_item,
        ITEM,
        (work_id(2), work_id(1), 1, 100, "tok-item-0002"),
        "parent locked",
    ),
    Probe(
        "work_item_depth",
        three_deep,
        ITEM,
        (work_id(4), work_id(3), 1, 100, "tok-item-0004"),
        "work tree too deep",
    ),
    Probe(
        "work_item_guard",
        only_item,
        "UPDATE work_item SET title='x', version=2 WHERE work_id=?",
        (work_id(1),),
        "illegal work update",
    ),
    Probe(
        "work_item_guard",
        only_item,
        "UPDATE work_item SET version=3 WHERE work_id=?",
        (work_id(1),),
        "illegal work update",
    ),
    Probe(
        "work_item_state",
        only_item,
        "UPDATE work_item SET state='accepted', version=2, updated_ms=11 WHERE work_id=?",
        (work_id(1),),
        "state changes only through a decision",
    ),
    Probe(
        "work_item_keep",
        only_item,
        "DELETE FROM work_item WHERE work_id=?",
        (work_id(1),),
        "append-only",
    ),
    Probe(
        "work_attempt_eligible",
        only_item,
        ATT,
        (attempt_id(999), work_id(1), binding_id(1), "bot-turn"),
        "attempt not eligible",
    ),
    Probe(
        "work_attempt_eligible",
        only_item,
        ATT,
        (attempt_id(7), work_id(1), binding_id(2), "bot-turn"),
        "attempt not eligible",
    ),
    Probe(
        "work_attempt_open",
        accepted_item,
        ATT,
        (attempt_id(4), work_id(1), binding_id(1), "bot-turn"),
        "work item is closed to new attempts",
    ),
    Probe(
        "work_attempt_limit",
        sixteen_attempts,
        ATT,
        (attempt_id(17), work_id(1), binding_id(2), "bot-turn"),
        "attempt or contributor limit reached",
    ),
    Probe(
        "work_attempt_limit",
        eight_contributors,
        ATT,
        (attempt_id(29), work_id(1), binding_id(9), "bot-turn"),
        "attempt or contributor limit reached",
    ),
    Probe(
        "work_attempt_frozen",
        frozen_contributors,
        ATT,
        (attempt_id(2), work_id(1), binding_id(2), "bot-turn"),
        "contributors are frozen once XP exists",
    ),
    Probe(
        "work_attempt_immutable",
        linked_attempt,
        "UPDATE work_attempt SET linked_ms=1",
        (),
        "append-only",
    ),
    Probe("work_attempt_keep", linked_attempt, "DELETE FROM work_attempt", (), "append-only"),
    Probe(
        "work_milestone_new",
        milestone_after_a_bump,
        "INSERT INTO work_milestone (work_id, position, label) VALUES (?,1,'x')",
        (work_id(1),),
        "milestones are set at creation",
    ),
    Probe(
        "work_milestone_guard",
        milestone_present,
        "UPDATE work_milestone SET label='y' WHERE work_id=?",
        (work_id(1),),
        "illegal milestone update",
    ),
    Probe(
        "work_milestone_guard",
        cancelled_with_milestone,
        "UPDATE work_milestone SET done_ms=5 WHERE work_id=?",
        (work_id(1),),
        "illegal milestone update",
    ),
    Probe("work_milestone_keep", milestone_ticked, "DELETE FROM work_milestone", (), "append-only"),
    Probe(
        "work_decision_sequence",
        only_item,
        DEC,
        (
            decision_id(1),
            work_id(1),
            2,
            "block",
            "open",
            "blocked",
            20,
            None,
            None,
            "tok-dec-00000001",
        ),
        "decision out of sequence",
    ),
    Probe(
        "work_decision_sequence",
        blocked_after_one,
        DEC,
        (
            decision_id(2),
            work_id(1),
            2,
            "unblock",
            "blocked",
            "open",
            20,
            None,
            None,
            "tok-dec-00000002",
        ),
        "decision out of sequence",
    ),
    Probe(
        "work_decision_transition",
        only_item,
        DEC,
        (
            decision_id(1),
            work_id(1),
            1,
            "unblock",
            "blocked",
            "open",
            20,
            None,
            None,
            "tok-dec-00000001",
        ),
        "illegal transition",
    ),
    Probe(
        "work_decision_transition",
        only_item,
        DEC,
        (
            decision_id(1),
            work_id(1),
            1,
            "block",
            "awaiting-review",
            "blocked",
            20,
            None,
            None,
            "tok-dec-00000001",
        ),
        "illegal transition",
    ),
    Probe(
        "work_decision_immutable",
        blocked_after_one,
        "UPDATE work_decision SET note='x'",
        (),
        "append-only",
    ),
    Probe("work_decision_keep", blocked_after_one, "DELETE FROM work_decision", (), "append-only"),
]


def test_every_trigger_has_at_least_one_probe(tmp_path: Path) -> None:
    db = probe_database(tmp_path, "names")
    try:
        assert {probe.trigger for probe in PROBES} == trigger_names(db)
    finally:
        db.close()


@pytest.mark.parametrize("index", range(len(PROBES)))
def test_every_trigger_refuses_its_own_violation_alone(tmp_path: Path, index: int) -> None:
    probe = PROBES[index]
    db = probe_database(tmp_path, f"probe{index}")
    try:
        probe.setup(db)
        table = db.execute(
            "SELECT tbl_name FROM sqlite_master WHERE name = ?", (probe.trigger,)
        ).fetchone()[0]
        siblings = db.execute(
            "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? AND name <> ?",
            (table, probe.trigger),
        ).fetchall()
        for (name,) in siblings:
            db.execute(f"DROP TRIGGER IF EXISTS {name}")
        with pytest.raises(sqlite3.IntegrityError, match=f"^{probe.message}$"):
            db.execute(probe.sql, probe.params)
    finally:
        db.close()


def test_the_ledger_tables_reference_only_each_other_and_bot_binding(tmp_path: Path) -> None:
    opened = open_store(tmp_path / "data")
    try:
        with opened.read() as conn:
            references = {
                table: sorted(
                    {str(r[2]) for r in conn.execute(f"PRAGMA foreign_key_list({table})")}
                )
                for table in LEDGER_TABLES
            }
            referencing = {
                str(name)
                for (name,) in conn.execute(
                    "SELECT m.name FROM sqlite_master m, pragma_foreign_key_list(m.name) f"
                    " WHERE m.type = 'table' AND f.\"table\" IN"
                    " ('work_item', 'work_attempt', 'work_milestone', 'work_decision', 'xp_entry')"
                )
            }
    finally:
        opened.close()
    assert references == {
        "work_item": ["work_item"],
        "work_attempt": ["bot_binding", "work_item"],
        "work_milestone": ["work_item"],
        "work_decision": ["work_item"],
        "xp_entry": ["bot_binding", "work_decision", "work_item"],
    }
    assert referencing <= set(LEDGER_TABLES)
    assert not referencing & set(IDENTITY_TABLES)


def test_rebuild_projection_is_not_blocked_by_linked_work(tmp_path: Path) -> None:
    opened, seeded = open_seeded(tmp_path, bots=2, per_bot=2)
    try:
        record = make_work(opened, [seeded.attempts[0][0], seeded.attempts[1][0]])
        accepted = submit_and_accept(opened, record, 1, at=T0 + 2000)
        before = ledger_hash(opened)
        report = rebuild_projection(opened, as_of_ms=T0 + 9000)
        assert report.attempts >= 4
        assert ledger_hash(opened) == before
        assert get_work(opened, accepted.work_id).evidence_revision == accepted.evidence_revision
        assert query(opened, "SELECT count(*) FROM attempt")[0][0] >= 4
    finally:
        opened.close()


def test_a_decision_can_still_be_made_after_a_rebuild(tmp_path: Path) -> None:
    opened, seeded = open_seeded(tmp_path, bots=1, per_bot=1)
    try:
        record = make_work(opened, [seeded.attempts[0][0]])
        rebuild_projection(opened, as_of_ms=T0 + 9000)
        after = get_work(opened, record.work_id)
        submitted = decide_work(
            opened,
            record.work_id,
            action="submit",
            expected_version=after.version,
            request_token="submit-00000001",
            evidence_revision=None,
            note=None,
            now_ms=T0 + 3000,
        )
        assert submitted.record.state == "awaiting-review"
    finally:
        opened.close()


NEW_NAMES = [
    "AttemptAlreadyLinked",
    "AttemptNotEligible",
    "AttemptsNotEnded",
    "BOUNTY_XP",
    "ChildrenNotAccepted",
    "ContributorsFrozen",
    "CreatedWork",
    "InvalidTransition",
    "LEVEL_FLOORS",
    "LEVEL_TABLE_VERSION",
    "LimitReached",
    "MAX_ATTEMPTS_PER_WORK",
    "MAX_CONDITION",
    "MAX_CONTRIBUTORS",
    "MAX_DEPTH",
    "MAX_MILESTONES",
    "MAX_MILESTONE_LABEL",
    "MAX_NOTE",
    "MAX_TITLE",
    "NoEvidence",
    "POLICY_VERSION",
    "ParentLocked",
    "RequestReused",
    "StaleEvidence",
    "UnknownAttempt",
    "UnknownWork",
    "WorkAttemptView",
    "WorkContributorView",
    "WorkDecisionResult",
    "WorkDecisionView",
    "WorkMilestoneView",
    "WorkProgress",
    "WorkRecord",
    "WorkReview",
    "XpEntryView",
    "XpHistory",
    "XpSummary",
    "create_work",
    "decide_work",
    "get_work",
    "level_for",
    "link_attempt",
    "list_work",
    "set_milestone",
    "split_bounty",
    "xp_history",
    "xp_summaries",
    "xp_summary",
]


def test_every_public_store_name_is_exported_once() -> None:
    assert len(NEW_NAMES) == 48
    exported = list(store_package.__all__)
    assert len(exported) == len(set(exported))
    for name in NEW_NAMES:
        assert exported.count(name) == 1, name
        assert hasattr(store_package, name), name
    assert all(hasattr(store_package, name) for name in exported)
