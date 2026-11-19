"""Hero, avatar and projection work never touch the work and XP ledger, and no monitoring
code reaches it (FP-09-AC04, FP-09-AC06, FP-08-AC06)."""

import re
from collections.abc import Iterator
from pathlib import Path

import pytest

import backend.specter_arena.store as store_package
from backend.specter_arena.store import (
    IngestBatch,
    RosterPoll,
    RosterRowIn,
    Store,
    get_work,
    ingest,
    rebuild_projection,
    record_rebind,
    xp_summaries,
    xp_summary,
)
from backend.specter_arena.store import specters as sp

from .test_store_isolation import identifiers_and_strings, resolve_imports
from .work_fakes import (
    LEDGER_TABLES,
    RUN,
    T0,
    Seeded,
    installation,
    ledger_hash,
    make_work,
    open_seeded,
    query,
    submit_and_accept,
)

BACKEND = Path(__file__).resolve().parents[1]
PACKAGE = BACKEND / "specter_arena"
STORE_PACKAGE = "backend.specter_arena.store"
PNG = sp.PNG_SIGNATURE + b"\x00" * 24
ERROR_NAMES = {
    "AttemptAlreadyLinked",
    "AttemptNotEligible",
    "AttemptsNotEnded",
    "ChildrenNotAccepted",
    "ContributorsFrozen",
    "InvalidTransition",
    "LimitReached",
    "NoEvidence",
    "ParentLocked",
    "RequestReused",
    "StaleEvidence",
    "UnknownAttempt",
    "UnknownWork",
}
LEDGER_NAMES = {
    "BOUNTY_XP",
    "CreatedWork",
    "LEVEL_FLOORS",
    "LEVEL_TABLE_VERSION",
    "MAX_ATTEMPTS_PER_WORK",
    "MAX_CONDITION",
    "MAX_CONTRIBUTORS",
    "MAX_DEPTH",
    "MAX_MILESTONES",
    "MAX_MILESTONE_LABEL",
    "MAX_NOTE",
    "MAX_TITLE",
    "POLICY_VERSION",
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
}
LEDGER_IDENTIFIERS = LEDGER_NAMES | set(LEDGER_TABLES)
FORBIDDEN_MODULE_PREFIXES = (
    f"{STORE_PACKAGE}.work",
    f"{STORE_PACKAGE}.xp",
)


@pytest.fixture
def ledger(tmp_path: Path) -> Iterator[tuple[Store, Seeded]]:
    opened, seeded = open_seeded(tmp_path, bots=3, per_bot=3)
    try:
        yield opened, seeded
    finally:
        opened.close()


def ledger_only(store: Store) -> dict[str, str]:
    return {name: digest for name, digest in ledger_hash(store).items() if name in LEDGER_TABLES}


def populate(store: Store, seeded: Seeded) -> None:
    done = make_work(store, [seeded.attempts[0][0], seeded.attempts[1][0]], 1)
    submit_and_accept(store, done, 1, at=T0 + 2000)
    make_work(store, [seeded.attempts[2][0]], 2, milestones=["a", "b"], at=T0 + 3000)


def change_avatars(store: Store, binding: str) -> None:
    """The whole avatar lifecycle: upload, choose it, choose another, reset to the hero portrait."""
    first = sp.insert_asset(
        store, data=PNG, width=8, height=8, origin="uploaded", label="a", now_ms=T0 + 104
    ).record
    second = sp.insert_asset(
        store, data=PNG + b"2", width=8, height=8, origin="uploaded", label="b", now_ms=T0 + 105
    ).record
    sp.set_avatar(store, binding, expected_version=0, asset_id=first.asset_id, now_ms=T0 + 106)
    sp.set_avatar(store, binding, expected_version=1, asset_id=second.asset_id, now_ms=T0 + 107)
    sp.set_avatar(store, binding, expected_version=2, asset_id=None, now_ms=T0 + 108)


def test_changing_avatars_alone_writes_zero_work_or_xp_rows(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    attempts_before = ledger_hash(store)["attempt"]
    change_avatars(store, seeded.bindings[0])
    for table in LEDGER_TABLES:
        assert query(store, f"SELECT count(*) FROM {table}") == [(0,)], table
    assert ledger_hash(store)["attempt"] == attempts_before
    assert query(store, "SELECT count(*) FROM avatar_revision")[0][0] == 3
    assert xp_summaries(store) == ()


def test_a_full_avatar_flow_leaves_a_populated_ledger_byte_identical(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    populate(store, seeded)
    before = ledger_only(store)
    summaries = xp_summaries(store)
    change_avatars(store, seeded.bindings[0])
    assert ledger_only(store) == before
    assert xp_summaries(store) == summaries
    assert xp_summary(store, seeded.bindings[0]).total_xp == 50


def test_a_bot_rename_leaves_the_ledger_byte_identical(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    populate(store, seeded)
    before = ledger_only(store)
    renamed = RosterPoll(
        True,
        T0 + 7000,
        (RosterRowIn("memory-bot0", "Renamed", "A Brand New Name", None, None),),
    )
    result = ingest(store, IngestBatch(RUN, installation(store), (renamed,)))
    assert result.counts["roster"].persisted == 1
    assert query(store, "SELECT count(*) FROM bot_display_revision")[0][0] >= 1
    assert ledger_only(store) == before
    assert xp_summary(store, seeded.bindings[0]).total_xp == 50


def test_a_rebind_record_moves_no_credit(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    populate(store, seeded)
    before = ledger_only(store)
    record_rebind(
        store,
        from_binding_id=seeded.bindings[0],
        to_binding_id=seeded.bindings[2],
        decided_at_ms=T0 + 8000,
        note="The old bot was replaced.",
    )
    assert ledger_only(store) == before
    assert xp_summary(store, seeded.bindings[0]).total_xp == 50
    assert xp_summary(store, seeded.bindings[2]).total_xp == 0
    assert [s.binding_id for s in xp_summaries(store)] == sorted(seeded.bindings[:2])


def test_rebuild_projection_leaves_the_ledger_alone(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    populate(store, seeded)
    before = ledger_only(store)
    revisions = {r.work_id: r.evidence_revision for r in [get_work(store, w) for w in works(store)]}
    rebuild_projection(store, as_of_ms=T0 + 9000)
    assert ledger_only(store) == before
    assert {w: get_work(store, w).evidence_revision for w in works(store)} == revisions


def works(store: Store) -> list[str]:
    return [str(r[0]) for r in query(store, "SELECT work_id FROM work_item ORDER BY created_ms")]


def test_the_ledger_has_no_reference_to_the_identity_tables(
    ledger: tuple[Store, Seeded],
) -> None:
    store, _ = ledger
    names = ("hero_assignment", "avatar_revision", "asset")
    with store.read() as conn:
        for table in LEDGER_TABLES:
            sql = conn.execute("SELECT sql FROM sqlite_master WHERE name = ?", (table,)).fetchone()[
                0
            ]
            assert not any(name in sql.lower() for name in names), table
            referenced = {str(r[2]) for r in conn.execute(f"PRAGMA foreign_key_list({table})")}
            assert not referenced & {"hero_assignment", "avatar_revision", "asset"}
        triggers = conn.execute(
            "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name IN"
            " ('work_item', 'work_attempt', 'work_milestone', 'work_decision', 'xp_entry')"
        ).fetchall()
    assert len(triggers) == 27
    for name, sql in triggers:
        assert not any(word in sql.lower() for word in names), name


def source_files(*relative: str) -> list[Path]:
    found: list[Path] = []
    for entry in relative:
        target = PACKAGE / entry
        found.extend(sorted(target.rglob("*.py")) if target.is_dir() else [target])
    return found


def ledger_import_violations(path: Path, root: Path = BACKEND) -> list[str]:
    """Imports that reach a work or XP module, or name one of its public objects from the store
    package. The prefix match keeps a later split of `store/work.py` covered."""
    problems: list[str] = []
    for name in sorted(resolve_imports(path, root)):
        if (
            name.startswith(FORBIDDEN_MODULE_PREFIXES)
            or name.rsplit(".", 1)[-1] in LEDGER_NAMES
            and name.startswith(f"{STORE_PACKAGE}.")
        ):
            problems.append(name)
    return problems


MONITORING_SOURCES = (
    "collector",
    "store/ingest.py",
    "store/projection.py",
    "store/fold.py",
)
IDENTITY_SOURCES = ("specters", "store/specters.py")


def test_collector_ingest_projection_and_fold_never_import_the_work_modules() -> None:
    files = source_files(*MONITORING_SOURCES)
    assert len(files) >= 12
    for path in files:
        assert ledger_import_violations(path) == [], path.name


def test_specters_modules_never_import_the_work_modules() -> None:
    files = source_files(*IDENTITY_SOURCES)
    assert len(files) >= 5
    for path in files:
        assert ledger_import_violations(path) == [], path.name


def test_the_guard_flags_a_module_that_reaches_the_ledger(tmp_path: Path) -> None:
    root = tmp_path / "backend"
    target = root / "specter_arena" / "collector"
    target.mkdir(parents=True)
    cases = {
        "relative.py": "from ..store.work import create_work\n",
        "absolute.py": "import backend.specter_arena.store.xp\n",
        "split.py": "from ..store.work_split import helper\n",
        "policy.py": "from ..store import xp_policy\n",
        "named.py": "from ..store import StoreError, get_work\n",
        "aliased.py": "from ..store import split_bounty as shares\n",
    }
    for name, source in cases.items():
        (target / name).write_text(source, encoding="utf-8")
        assert ledger_import_violations(target / name, root) != [], name
    (target / "clean.py").write_text(
        "from ..store import StoreError, ingest\nfrom ..store.fold import FoldObs\n",
        encoding="utf-8",
    )
    assert ledger_import_violations(target / "clean.py", root) == []


def test_collector_and_specters_have_no_work_or_xp_identifier() -> None:
    for path in source_files("collector", "specters", "store/specters.py"):
        found = identifiers_and_strings(path) & LEDGER_IDENTIFIERS
        assert not found, (path.name, found)


def test_every_public_ledger_name_is_listed_by_the_guard() -> None:
    exported = set(store_package.__all__)
    assert exported >= LEDGER_NAMES
    assert exported >= ERROR_NAMES
    assert len(LEDGER_NAMES) + len(ERROR_NAMES) == 48


TABLE_WRITERS = {
    "work_item": "work.py",
    "work_attempt": "work.py",
    "work_milestone": "work.py",
    "work_decision": "work.py",
    "xp_entry": "xp.py",
}


def test_only_the_work_and_xp_modules_write_the_ledger_tables() -> None:
    sources = sorted(PACKAGE.rglob("*.py"))
    assert len(sources) > 40
    for table, owner in TABLE_WRITERS.items():
        pattern = re.compile(rf"(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+{table}\b", re.IGNORECASE)
        writers = sorted(p.name for p in sources if pattern.search(p.read_text(encoding="utf-8")))
        assert writers == [owner], (table, writers)
