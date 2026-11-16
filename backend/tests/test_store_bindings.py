import re
import sqlite3
import threading
from collections.abc import Iterator
from pathlib import Path

import pytest

from backend.specter_arena.store import (
    BindingSeen,
    DmKey,
    IngestBatch,
    IngestItem,
    IngestResult,
    RosterPoll,
    RosterRowIn,
    Store,
    StoreStatus,
    StoreUsageError,
    build_dm_key,
    get_binding,
    ingest,
    latest_version,
    open_store,
    parse_dm_key,
    record_rebind,
)
from backend.specter_arena.store.bindings import new_binding_id, store_id
from backend.specter_arena.store.migrate import (
    load_migrations,
    migrate,
    pending,
    verify_checksums,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "store"
FIXTURE_V1 = FIXTURES / "schema-v1.sql"
FIXTURE_V2 = FIXTURES / "schema-v2.sql"
FIXTURE_V2_STORE_ID = "00000000-0000-4000-8000-000000000002"
FIXTURE_V2_BINDING_ID = "bnd_000000000000000000000001"

ALPHA = DmKey("alpha-0123456789ab", "memory-alpha")
BETA = DmKey("beta-0123456789ab", "memory-beta")
T0 = 1_800_000_000_000


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    return tmp_path / "home" / "apps" / "specter-arena" / "data"


@pytest.fixture
def store(data_dir: Path) -> Iterator[Store]:
    opened = open_store(data_dir)
    try:
        yield opened
    finally:
        opened.close()


def installation(opened: Store) -> str:
    with opened.read() as conn:
        return store_id(conn)


def run(opened: Store, *items: IngestItem, installation_id: str | None = None) -> IngestResult:
    return ingest(
        opened,
        IngestBatch(
            run_id="run-00000001",
            installation_id=installation_id or installation(opened),
            items=items,
        ),
    )


def row(
    memory_store: str,
    name: str = "Alpha",
    display_name: str | None = "Alpha Bot",
    avatar_kind: str | None = "ghost",
    avatar_ref: str | None = None,
) -> RosterRowIn:
    return RosterRowIn(memory_store, name, display_name, avatar_kind, avatar_ref)


def poll(at_ms: int, *rows: RosterRowIn) -> RosterPoll:
    return RosterPoll(success=True, polled_at_ms=at_ms, rows=rows)


def count(opened: Store, sql: str, *params: object) -> int:
    with opened.read() as conn:
        return int(conn.execute(sql, params).fetchone()[0])


def place_fixture(data_dir: Path, fixture: Path) -> None:
    (data_dir / "store").mkdir(parents=True)
    conn = sqlite3.connect(data_dir / "store" / "specter-arena.db", isolation_level=None)
    conn.executescript(fixture.read_text(encoding="utf-8"))
    conn.close()


def names(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")
    return {name for (name,) in rows}


# FP-02-AC01 -----------------------------------------------------------------------------------


def test_ac01_an_empty_store_migrates_to_the_binding_schema(store: Store) -> None:
    assert store.status() == StoreStatus("ready", latest_version(), latest_version())
    assert latest_version() >= 2
    with store.read() as conn:
        assert {
            "bot_binding",
            "bot_display_revision",
            "bot_presence",
            "binding_rebind",
            "store_meta_store_id",
            "bot_binding_store",
        } <= names(conn)


def test_ac01_the_previous_test_schema_upgrades_and_keeps_the_installation(
    data_dir: Path,
) -> None:
    place_fixture(data_dir, FIXTURE_V1)
    opened = open_store(data_dir)
    try:
        assert opened.status() == StoreStatus("ready", latest_version(), latest_version())
        assert installation(opened) == "00000000-0000-4000-8000-000000000001"
        result = run(opened, BindingSeen(ALPHA, T0))
        assert result.counts["binding"].persisted == 1
    finally:
        opened.close()
    backups = sorted((data_dir / "store" / "backups").glob("pre-migrate-v1-to-v2-*.db"))
    assert len(backups) == 1


def test_ac01_the_frozen_v2_fixture_has_the_schema_the_migrations_create(tmp_path: Path) -> None:
    fixture = sqlite3.connect(tmp_path / "fixture.db", isolation_level=None)
    fixture.executescript(FIXTURE_V2.read_text(encoding="utf-8"))
    migrated = sqlite3.connect(tmp_path / "migrated.db", isolation_level=None)
    through_v2 = load_migrations()[:2]
    migrate(migrated, through_v2)
    try:
        query = "SELECT type, name, sql FROM sqlite_master ORDER BY type, name"

        def normalised(conn: sqlite3.Connection) -> list[tuple[str, str, str]]:
            return [(a, b, " ".join((c or "").split())) for a, b, c in conn.execute(query)]

        assert normalised(fixture) == normalised(migrated)
        verify_checksums(fixture, through_v2)
        assert pending(fixture, through_v2) == []
    finally:
        fixture.close()
        migrated.close()


def test_ac01_the_v2_fixture_upgrades_and_keeps_its_seeded_binding(data_dir: Path) -> None:
    place_fixture(data_dir, FIXTURE_V2)
    opened = open_store(data_dir)
    try:
        assert opened.status().state == "ready"
        record = get_binding(opened, FIXTURE_V2_BINDING_ID)
        assert record is not None
        assert (record.installation_id, record.member_id, record.memory_store) == (
            FIXTURE_V2_STORE_ID,
            "fixture-bot",
            "fixture-store",
        )
        assert (record.display_name, record.presence) == ("Fixture Bot", "present")
    finally:
        opened.close()


def test_ac01_bindings_and_history_survive_a_restart(data_dir: Path) -> None:
    first = open_store(data_dir)
    try:
        created = run(first, BindingSeen(ALPHA, T0), poll(T0 + 1, row("memory-alpha")))
        binding_id = created.bindings[0].binding_id
    finally:
        first.close()
    second = open_store(data_dir)
    try:
        record = get_binding(second, binding_id)
        assert record is not None
        assert (record.display_name, record.presence, record.created_at_ms) == (
            "Alpha Bot",
            "present",
            T0,
        )
        again = run(second, BindingSeen(ALPHA, T0 + 5))
        assert again.bindings[0].binding_id == binding_id
        assert again.bindings[0].created is False
    finally:
        second.close()


# FP-02-AC02 -----------------------------------------------------------------------------------


def test_ac02_the_same_source_identity_in_two_installations_does_not_collide(
    tmp_path: Path,
) -> None:
    left = open_store(tmp_path / "left")
    right = open_store(tmp_path / "right")
    try:
        assert installation(left) != installation(right)
        one = run(left, BindingSeen(ALPHA, T0)).bindings[0]
        two = run(right, BindingSeen(ALPHA, T0)).bindings[0]
        assert one.created and two.created
        assert one.dm_key == two.dm_key
        assert one.binding_id != two.binding_id
    finally:
        left.close()
        right.close()


def test_ac02_a_batch_for_another_installation_writes_nothing(store: Store) -> None:
    result = run(
        store,
        BindingSeen(ALPHA, T0),
        poll(T0, row("memory-alpha")),
        installation_id="11111111-1111-4111-8111-111111111111",
    )
    assert [r.reason for r in result.rejections] == ["wrong-installation"] * 2
    assert count(store, "SELECT count(*) FROM bot_binding") == 0
    assert count(store, "SELECT count(*) FROM bot_display_revision") == 0


def test_ac02_the_database_refuses_a_binding_for_an_unknown_installation(store: Store) -> None:
    with pytest.raises(sqlite3.IntegrityError), store.write() as conn:
        conn.execute(
            "INSERT INTO bot_binding"
            " (binding_id, installation_id, dm_key, member_id, memory_store, first_seen_ms)"
            " VALUES (?, ?, ?, ?, ?, 0)",
            (
                new_binding_id(),
                "22222222-2222-4222-8222-222222222222",
                build_dm_key(ALPHA),
                ALPHA.member_id,
                ALPHA.memory_store,
            ),
        )


def test_ac02_concurrent_sessions_create_one_binding(data_dir: Path) -> None:
    handles = [open_store(data_dir) for _ in range(4)]
    barrier = threading.Barrier(len(handles))
    results: list[IngestResult] = []

    def worker(handle: Store) -> None:
        barrier.wait()
        results.append(run(handle, BindingSeen(ALPHA, T0)))

    threads = [threading.Thread(target=worker, args=(handle,)) for handle in handles]
    try:
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        assert len(results) == 4
        assert sum(r.bindings[0].created for r in results) == 1
        assert len({r.bindings[0].binding_id for r in results}) == 1
        assert count(handles[0], "SELECT count(*) FROM bot_binding") == 1
    finally:
        for handle in handles:
            handle.close()


def test_ac02_a_rename_adds_a_revision_and_no_second_binding(store: Store) -> None:
    run(store, BindingSeen(ALPHA, T0), poll(T0 + 1, row("memory-alpha")))
    renamed = run(store, poll(T0 + 2, row("memory-alpha", "Alpha2", "Alpha Two", "image", "a.png")))
    assert renamed.counts["roster"].persisted == 1
    assert count(store, "SELECT count(*) FROM bot_binding") == 1
    with store.read() as conn:
        revisions = conn.execute(
            "SELECT revision_no, name, display_name, avatar_kind, avatar_ref"
            " FROM bot_display_revision ORDER BY revision_no"
        ).fetchall()
    assert revisions == [
        (1, "Alpha", "Alpha Bot", "ghost", None),
        (2, "Alpha2", "Alpha Two", "image", "a.png"),
    ]


def test_ac02_an_unchanged_roster_row_adds_no_revision(store: Store) -> None:
    run(store, BindingSeen(ALPHA, T0), poll(T0 + 1, row("memory-alpha")))
    again = run(store, poll(T0 + 2, row("memory-alpha")))
    assert again.counts["roster"].deduplicated == 1
    assert count(store, "SELECT count(*) FROM bot_display_revision") == 1
    assert count(store, "SELECT count(*) FROM bot_presence") == 1


def test_ac02_a_replacement_is_a_new_binding_and_never_merged(store: Store) -> None:
    replacement = DmKey("alpha-0123456789ab", "memory-alpha-replacement")
    old = run(store, BindingSeen(ALPHA, T0)).bindings[0]
    new = run(store, BindingSeen(replacement, T0 + 1)).bindings[0]
    assert new.created and new.binding_id != old.binding_id
    run(store, poll(T0 + 2, row("memory-alpha-replacement", "Alpha")))
    assert get_binding(store, old.binding_id) is not None
    assert get_binding(store, old.binding_id).presence == "absent"  # type: ignore[union-attr]
    assert get_binding(store, new.binding_id).presence == "present"  # type: ignore[union-attr]


def test_ac02_one_memory_store_under_two_keys_is_ambiguous_not_merged(store: Store) -> None:
    run(store, BindingSeen(ALPHA, T0))
    clash = run(store, BindingSeen(DmKey("other-0123456789ab", "memory-alpha"), T0 + 1))
    assert [r.reason for r in clash.rejections] == ["ambiguous-store"]
    assert clash.bindings == ()
    assert count(store, "SELECT count(*) FROM bot_binding") == 1


# FP-03-AC05 (store part) ----------------------------------------------------------------------


def test_ac05_presence_is_unknown_until_the_first_successful_poll(store: Store) -> None:
    binding_id = run(store, BindingSeen(ALPHA, T0)).bindings[0].binding_id
    record = get_binding(store, binding_id)
    assert record is not None and record.presence == "unknown" and record.display_name is None
    failed = run(store, RosterPoll(success=False, polled_at_ms=T0 + 1, reason="roster-unavailable"))
    assert failed.counts["roster"].deduplicated == 1
    assert count(store, "SELECT count(*) FROM bot_presence") == 0
    record = get_binding(store, binding_id)
    assert record is not None and record.presence == "unknown"


def test_ac05_a_failed_poll_after_a_good_one_changes_nothing(store: Store) -> None:
    binding_id = (
        run(store, BindingSeen(ALPHA, T0), poll(T0 + 1, row("memory-alpha"))).bindings[0].binding_id
    )
    run(store, RosterPoll(success=False, polled_at_ms=T0 + 2, reason="roster-unavailable"))
    record = get_binding(store, binding_id)
    assert record is not None and record.presence == "present"
    assert count(store, "SELECT count(*) FROM bot_presence") == 1


def test_ac05_deletion_and_reappearance_keep_one_binding_and_all_history(store: Store) -> None:
    binding_id = (
        run(store, BindingSeen(ALPHA, T0), poll(T0 + 1, row("memory-alpha"))).bindings[0].binding_id
    )
    run(store, poll(T0 + 2))
    gone = get_binding(store, binding_id)
    assert gone is not None and gone.presence == "absent" and gone.display_name == "Alpha Bot"
    run(store, poll(T0 + 3, row("memory-alpha")))
    back = get_binding(store, binding_id)
    assert back is not None and back.presence == "present"
    with store.read() as conn:
        states = conn.execute(
            "SELECT state, since_ms FROM bot_presence ORDER BY presence_id"
        ).fetchall()
    assert states == [("present", T0 + 1), ("absent", T0 + 2), ("present", T0 + 3)]
    assert count(store, "SELECT count(*) FROM bot_binding") == 1
    assert count(store, "SELECT count(*) FROM bot_display_revision") == 1


def test_ac05_a_roster_row_with_no_binding_is_counted_not_created(store: Store) -> None:
    run(store, BindingSeen(ALPHA, T0))
    result = run(store, poll(T0 + 1, row("memory-alpha"), row("memory-unseen"), row("")))
    assert result.roster_unmatched == 1
    assert count(store, "SELECT count(*) FROM bot_binding") == 1


def test_ac05_rebind_records_a_decision_and_never_moves_history(store: Store) -> None:
    old = run(store, BindingSeen(ALPHA, T0), poll(T0, row("memory-alpha"))).bindings[0]
    new = run(store, BindingSeen(BETA, T0 + 1)).bindings[0]
    record_rebind(
        store,
        from_binding_id=old.binding_id,
        to_binding_id=new.binding_id,
        decided_at_ms=T0 + 2,
        note="replaced",
    )
    assert count(store, "SELECT count(*) FROM binding_rebind") == 1
    assert (
        count(
            store, "SELECT count(*) FROM bot_display_revision WHERE binding_id = ?", old.binding_id
        )
        == 1
    )
    assert (
        count(
            store, "SELECT count(*) FROM bot_display_revision WHERE binding_id = ?", new.binding_id
        )
        == 0
    )


@pytest.mark.parametrize(
    "case",
    ["same", "unknown-from", "unknown-to", "again", "long-note", "negative-time"],
)
def test_ac05_rebind_refuses_bad_decisions(store: Store, case: str) -> None:
    old = run(store, BindingSeen(ALPHA, T0)).bindings[0].binding_id
    new = run(store, BindingSeen(BETA, T0)).bindings[0].binding_id
    args = {"from_binding_id": old, "to_binding_id": new, "decided_at_ms": T0, "note": None}
    if case == "same":
        args["to_binding_id"] = old
    elif case == "unknown-from":
        args["from_binding_id"] = "bnd_" + "0" * 24
    elif case == "unknown-to":
        args["to_binding_id"] = "bnd_" + "0" * 24
    elif case == "again":
        record_rebind(store, **args)  # type: ignore[arg-type]
    elif case == "long-note":
        args["note"] = "x" * 201
    else:
        args["decided_at_ms"] = -1
    with pytest.raises(StoreUsageError):
        record_rebind(store, **args)  # type: ignore[arg-type]


def test_get_binding_of_an_unknown_id_is_none(store: Store) -> None:
    assert get_binding(store, "bnd_" + "f" * 24) is None


# Bounds and append-only -----------------------------------------------------------------------


@pytest.mark.parametrize("length,accepted", [(128, True), (129, False)])
def test_name_and_display_name_are_bounded_at_128(
    store: Store, length: int, accepted: bool
) -> None:
    run(store, BindingSeen(ALPHA, T0))
    for field in ("name", "display_name"):
        text = "n" * length
        kwargs = {"name": "ok", "display_name": None, field: text}
        result = run(store, poll(T0 + 1, row("memory-alpha", **kwargs)))  # type: ignore[arg-type]
        if accepted:
            assert result.rejections == ()
        else:
            assert [r.reason for r in result.rejections] == ["bad-roster-row"]


@pytest.mark.parametrize(
    "kind,ref,accepted",
    [
        ("ghost", None, True),
        ("a" * 32, "x.png", True),
        ("a" * 33, None, False),
        ("Ghost", None, False),
        ("1ghost", None, False),
        ("ghost", "a" * 128, True),
        ("ghost", "a" * 129, False),
        ("ghost", "a/b.png", False),
        ("ghost", "", False),
    ],
)
def test_avatar_kind_and_ref_follow_their_patterns(
    store: Store, kind: str, ref: str | None, accepted: bool
) -> None:
    run(store, BindingSeen(ALPHA, T0))
    result = run(store, poll(T0 + 1, row("memory-alpha", avatar_kind=kind, avatar_ref=ref)))
    assert (result.rejections == ()) is accepted


def test_the_database_enforces_the_name_and_avatar_lengths(store: Store) -> None:
    binding_id = run(store, BindingSeen(ALPHA, T0)).bindings[0].binding_id
    insert = (
        "INSERT INTO bot_display_revision"
        " (binding_id, revision_no, name, display_name, avatar_kind, avatar_ref, observed_ms)"
        " VALUES (?, 1, ?, ?, ?, ?, 0)"
    )
    bad_rows = [
        ("n" * 129, None, None, None),
        ("n", "d" * 129, None, None),
        ("n", None, "k" * 33, None),
        ("n", None, "", None),
        ("n", None, None, "r" * 129),
    ]
    for fields in bad_rows:
        with pytest.raises(sqlite3.IntegrityError), store.write() as conn:
            conn.execute(insert, (binding_id, *fields))


@pytest.mark.parametrize(
    "member_id,accepted",
    [
        ("a", True),
        ("a-b", True),
        ("a" * 80, True),
        ("a" * 81, False),
        ("-a", False),
        ("a-", False),
        ("A", False),
        ("a.b", False),
        ("a b", False),
    ],
)
def test_the_database_enforces_the_member_id_shape(
    store: Store, member_id: str, accepted: bool
) -> None:
    insert = (
        "INSERT INTO bot_binding"
        " (binding_id, installation_id, dm_key, member_id, memory_store, first_seen_ms)"
        " VALUES (?, ?, ?, ?, 'store', 0)"
    )
    params = (new_binding_id(), installation(store), f"member-{member_id}.memory-store", member_id)
    if accepted:
        with store.write() as conn:
            conn.execute(insert, params)
    else:
        with pytest.raises(sqlite3.IntegrityError), store.write() as conn:
            conn.execute(insert, params)


def test_the_database_refuses_a_key_that_does_not_match_its_parts(store: Store) -> None:
    installation_id = installation(store)
    insert = (
        "INSERT INTO bot_binding"
        " (binding_id, installation_id, dm_key, member_id, memory_store, first_seen_ms)"
        " VALUES (?, ?, ?, ?, ?, 0)"
    )
    bad = [
        (new_binding_id(), installation_id, "member-x.memory-other", "x", "store"),
        (new_binding_id(), installation_id, "member-y", "x", ""),
        ("bnd_short", installation_id, "member-x.memory-store", "x", "store"),
        ("xxx_" + "0" * 24, installation_id, "member-x.memory-store", "x", "store"),
    ]
    for params in bad:
        with pytest.raises(sqlite3.IntegrityError), store.write() as conn:
            conn.execute(insert, params)


def test_binding_history_tables_are_append_only(store: Store) -> None:
    old = run(store, BindingSeen(ALPHA, T0), poll(T0, row("memory-alpha"))).bindings[0]
    new = run(store, BindingSeen(BETA, T0)).bindings[0]
    record_rebind(
        store,
        from_binding_id=old.binding_id,
        to_binding_id=new.binding_id,
        decided_at_ms=T0,
        note=None,
    )
    statements = [
        "UPDATE bot_binding SET first_seen_ms = 1",
        "DELETE FROM bot_binding",
        "UPDATE bot_display_revision SET name = 'x'",
        "DELETE FROM bot_display_revision",
        "UPDATE bot_presence SET state = 'absent'",
        "DELETE FROM bot_presence",
        "UPDATE binding_rebind SET note = 'x'",
        "DELETE FROM binding_rebind",
    ]
    for statement in statements:
        with pytest.raises(sqlite3.IntegrityError, match="append-only"), store.write() as conn:
            conn.execute(statement)


def test_a_rebind_cannot_point_a_binding_at_itself(store: Store) -> None:
    binding_id = run(store, BindingSeen(ALPHA, T0)).bindings[0].binding_id
    with pytest.raises(sqlite3.IntegrityError), store.write() as conn:
        conn.execute(
            "INSERT INTO binding_rebind (from_binding_id, to_binding_id, decided_at_ms)"
            " VALUES (?, ?, 0)",
            (binding_id, binding_id),
        )


def test_binding_ids_are_opaque_and_unique(store: Store) -> None:
    ids = {new_binding_id() for _ in range(200)}
    assert len(ids) == 200
    assert all(re.fullmatch(r"bnd_[0-9a-f]{24}", value) for value in ids)


# DM keys --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "key,expected",
    [
        ("member-alpha", DmKey("alpha", "")),
        ("member-alpha-0123456789ab.memory-m1", DmKey("alpha-0123456789ab", "m1")),
        ("member-a.memory-x.y_z-1", DmKey("a", "x.y_z-1")),
    ],
)
def test_dm_keys_parse_and_build_back(key: str, expected: DmKey) -> None:
    assert parse_dm_key(key) == expected
    assert build_dm_key(expected) == key


@pytest.mark.parametrize(
    "key",
    [
        "",
        "alpha",
        "member-",
        "member-Alpha",
        "member--a",
        "member-a-",
        "member-a.memory-",
        "member-a.other-x",
        "member-a.memory-bad/slash",
        "member-a.memory-" + "x" * 129,
        "member-" + "a" * 81,
        "member-a.memory-" + "x" * 250,
        "member-a b",
    ],
)
def test_malformed_dm_keys_do_not_parse(key: str) -> None:
    assert parse_dm_key(key) is None
