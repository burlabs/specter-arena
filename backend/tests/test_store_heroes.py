"""Hero assignment at binding creation, and the avatar as the only user choice (FP-16, WL)."""

import inspect
import json
import re
import sqlite3
import threading
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

import backend.specter_arena.store.bindings as bindings_module
from backend.specter_arena.store import (
    HERO_IDS,
    ROSTER_SIZE,
    BindingSeen,
    DmKey,
    IngestBatch,
    RosterPoll,
    RosterRowIn,
    Store,
    StoreUsageError,
    UnknownAsset,
    UnknownBinding,
    VersionConflict,
    get_hero,
    ingest,
    insert_asset,
    list_heroes,
    open_store,
    set_avatar,
    start_run,
)
from backend.specter_arena.store import specters as sp
from backend.specter_arena.store.bindings import insert_binding, store_id

T0 = 1_800_000_000_000
BACKEND = Path(__file__).resolve().parents[1] / "specter_arena"
HEROES_JSON = BACKEND / "specters" / "heroes.json"
MIGRATION_0007 = BACKEND / "store" / "migrations" / "0007_hero_roster.sql"
PNG = sp.PNG_SIGNATURE + b"\x00" * 24


def key(n: int) -> DmKey:
    return DmKey(f"bot{n:02d}-0123456789ab", f"memory-{n:02d}")


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    opened = open_store(tmp_path / "data")
    try:
        yield opened
    finally:
        opened.close()


def installation(opened: Store) -> str:
    with opened.read() as conn:
        return store_id(conn)


def bind_many(opened: Store, count: int, first: int = 0, *, seen: int = T0) -> list[str]:
    if first == 0:
        start_run(opened, run_id="run-00000001", now_ms=T0 - 1)
    items = tuple(BindingSeen(key(first + i), seen + i) for i in range(count))
    result = ingest(opened, IngestBatch("run-00000001", installation(opened), items))
    return [made.binding_id for made in result.bindings]


def upload(opened: Store, tail: int = 1) -> str:
    data = PNG + bytes([tail])
    return insert_asset(
        opened, data=data, width=8, height=8, origin="uploaded", label="mine", now_ms=T0
    ).record.asset_id


def count(opened: Store, table: str) -> int:
    with opened.read() as conn:
        return int(conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0])


def rows(opened: Store, sql: str) -> list[tuple[Any, ...]]:
    with opened.read() as conn:
        return [tuple(r) for r in conn.execute(sql)]


def case_ids(sql: str) -> list[str]:
    """The hero ids of the first `CASE ... END` in `sql`, in `WHEN`/`ELSE` order."""
    block = sql[sql.index("CASE") : sql.index("END")]
    return re.findall(r"'([a-z]+)'", block)


def roster_ids() -> list[str]:
    data = json.loads(HEROES_JSON.read_text(encoding="utf-8"))
    entries = data if isinstance(data, list) else data["heroes"]
    return [str(entry["id"]) for entry in entries]


# --- the roster order is written down in four places; they must agree ------------------------


def test_the_hero_ids_are_the_eleven_in_roster_order() -> None:
    assert HERO_IDS == (
        "vell",
        "stitch",
        "reeve",
        "rattle",
        "ember",
        "shard",
        "poly",
        "tide",
        "lume",
        "moss",
        "bur",
    )
    assert ROSTER_SIZE == 11


def test_heroes_json_lists_the_same_ids_in_the_same_order() -> None:
    assert roster_ids() == list(HERO_IDS)


def test_the_migration_check_and_backfill_list_the_same_ids_in_the_same_order(
    store: Store,
) -> None:
    table_sql = rows(store, "SELECT sql FROM sqlite_master WHERE name = 'hero_assignment'")[0][0]
    assert case_ids(table_sql) == list(HERO_IDS)
    file_sql = MIGRATION_0007.read_text(encoding="utf-8")
    backfill = file_sql[file_sql.index("INSERT INTO hero_assignment") :]
    assert case_ids(backfill) == list(HERO_IDS)


# --- assignment ---------------------------------------------------------------------------------


def test_a_new_binding_gets_the_first_hero_at_ordinal_one(store: Store) -> None:
    (binding,) = bind_many(store, 1)
    hero = get_hero(store, binding)
    assert (hero.hero_id, hero.ordinal, hero.assignment_no) == ("vell", 1, 0)
    assert (hero.version, hero.asset_id) == (0, None)
    assert hero.assigned_ms == hero.updated_ms == T0


def test_twenty_three_bindings_walk_the_roster_twice_then_start_a_third_lap(store: Store) -> None:
    ids = bind_many(store, 23)
    heroes = list_heroes(store)
    assert [h.binding_id for h in heroes] == ids
    assert [h.assignment_no for h in heroes] == list(range(23))
    assert [h.hero_id for h in heroes] == [HERO_IDS[n % 11] for n in range(23)]
    assert [h.ordinal for h in heroes] == [n // 11 + 1 for n in range(23)]
    assert (heroes[11].hero_id, heroes[11].ordinal) == ("vell", 2)
    assert (heroes[10].hero_id, heroes[10].ordinal) == ("bur", 1)
    assert (heroes[22].hero_id, heroes[22].ordinal) == ("vell", 3)


def test_a_repeat_sight_of_a_known_binding_adds_no_assignment(store: Store) -> None:
    bind_many(store, 2)
    again = ingest(
        store,
        IngestBatch("run-00000001", installation(store), (BindingSeen(key(0), T0 + 99),)),
    )
    assert again.counts["binding"].deduplicated == 1
    assert count(store, "hero_assignment") == 2 == count(store, "bot_binding")


def test_an_ambiguous_store_clash_creates_neither_binding_nor_assignment(store: Store) -> None:
    bind_many(store, 1)
    clash = DmKey("other0-0123456789ab", "memory-00")
    result = ingest(
        store, IngestBatch("run-00000001", installation(store), (BindingSeen(clash, T0),))
    )
    assert [r.reason for r in result.rejections] == ["ambiguous-store"]
    assert count(store, "bot_binding") == 1 == count(store, "hero_assignment")


def test_assignment_follows_creation_order_not_first_seen_time(store: Store) -> None:
    start_run(store, run_id="run-00000001", now_ms=T0 - 1)
    items = (BindingSeen(key(0), T0 + 500), BindingSeen(key(1), T0 + 100))
    result = ingest(store, IngestBatch("run-00000001", installation(store), items))
    first, second = (made.binding_id for made in result.bindings)
    assert (get_hero(store, first).hero_id, get_hero(store, second).hero_id) == ("vell", "stitch")
    assert get_hero(store, second).assigned_ms == T0 + 100


def test_a_rename_never_changes_the_hero(store: Store) -> None:
    (binding,) = bind_many(store, 1)
    before = get_hero(store, binding)
    for n, name in enumerate(("Renamed Bot", "Another Name")):
        poll = RosterPoll(True, T0 + 10 + n, (RosterRowIn("memory-00", name, name, None, None),))
        ingest(store, IngestBatch("run-00000001", installation(store), (poll,)))
    assert get_hero(store, binding) == before
    assert rows(store, "SELECT count(*) FROM bot_display_revision")[0][0] >= 2


def test_assignment_reads_no_observation_roster_or_presence_table(store: Store) -> None:
    bind_many(store, 1)
    touched: set[str] = set()

    def authorizer(action: int, arg1: str | None, *_rest: object) -> int:
        if action == sqlite3.SQLITE_READ and arg1:
            touched.add(arg1)
        return sqlite3.SQLITE_OK

    with store.write() as conn:
        conn.set_authorizer(authorizer)
        try:
            made = insert_binding(conn, installation(store), key(5), T0 + 5)
        finally:
            conn.set_authorizer(None)
    assert not isinstance(made, str) and made.created
    # `store_meta` and `avatar_revision` are read by SQLite's own foreign-key checks.
    assert {"bot_binding", "hero_assignment"} <= touched
    assert touched <= {"bot_binding", "hero_assignment", "store_meta", "avatar_revision"}
    assert "observation" not in inspect.getsource(sp.assign_hero)


def test_a_failed_assignment_rolls_the_binding_back_with_it(
    store: Store, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(conn: sqlite3.Connection, binding_id: str, assigned_ms: int) -> None:
        conn.execute("INSERT INTO hero_assignment VALUES (?, 99, 'vell', 1, 0)", (binding_id,))

    monkeypatch.setattr(bindings_module, "assign_hero", broken)
    start_run(store, run_id="run-00000001", now_ms=T0 - 1)
    result = ingest(
        store, IngestBatch("run-00000001", installation(store), (BindingSeen(key(0), T0),))
    )
    assert [(r.index, r.reason) for r in result.rejections] == [(0, "constraint")]
    assert count(store, "bot_binding") == 0 == count(store, "hero_assignment")


def test_concurrent_first_sights_leave_a_gapless_sequence(store: Store) -> None:
    start_run(store, run_id="run-00000001", now_ms=T0 - 1)
    install = installation(store)
    failures: list[BaseException] = []

    def one(n: int) -> None:
        try:
            batch = IngestBatch("run-00000001", install, (BindingSeen(key(n), T0 + n),))
            ingest(store, batch)
        except BaseException as error:  # noqa: BLE001 - collected and asserted below
            failures.append(error)

    threads = [threading.Thread(target=one, args=(n,)) for n in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert failures == []
    assert [h.assignment_no for h in list_heroes(store)] == list(range(8))


# --- the database itself enforces the rule -------------------------------------------------------


@pytest.mark.parametrize(
    "values",
    [
        (1, "vell", 1),  # out of sequence: the next number is 0
        (0, "stitch", 1),  # hero does not match the number
        (0, "vell", 2),  # ordinal does not match the number
        (-1, "vell", 1),
    ],
)
def test_the_table_rejects_a_row_that_breaks_the_roster_rule(
    store: Store, values: tuple[Any, ...]
) -> None:
    with store.write() as conn:
        conn.execute(
            "INSERT INTO bot_binding (binding_id, installation_id, dm_key, member_id,"
            " memory_store, first_seen_ms) VALUES ('bnd_" + "0" * 24 + "', ?, 'member-x"
            "-aaaa', 'x-aaaa', '', 0)",
            (installation(store),),
        )
    bound = "bnd_" + "0" * 24
    row = (bound, *values, 0)
    with pytest.raises(sqlite3.DatabaseError), store.write() as conn:
        conn.execute("INSERT INTO hero_assignment VALUES (?, ?, ?, ?, ?)", row)
    assert count(store, "hero_assignment") == 0


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE hero_assignment SET hero_id = 'vell'",
        "UPDATE hero_assignment SET assigned_ms = 1",
        "DELETE FROM hero_assignment",
        "UPDATE avatar_revision SET asset_id = NULL",
        "DELETE FROM avatar_revision",
    ],
)
def test_assignments_and_avatar_revisions_are_append_only(store: Store, statement: str) -> None:
    (binding,) = bind_many(store, 1)
    set_avatar(store, binding, expected_version=0, asset_id=upload(store), now_ms=T0 + 1)
    with pytest.raises(sqlite3.DatabaseError, match="append-only"), store.write() as conn:
        conn.execute(statement)


# --- reads --------------------------------------------------------------------------------------


@pytest.mark.parametrize("bad", ["bnd_" + "0" * 24, "nope", "", "bnd_" + "A" * 24])
def test_get_hero_of_an_unknown_or_malformed_binding_is_unknown_binding(
    store: Store, bad: str
) -> None:
    bind_many(store, 1)
    with pytest.raises(UnknownBinding):
        get_hero(store, bad)


def test_list_heroes_of_an_empty_store_is_empty(store: Store) -> None:
    assert list_heroes(store) == ()


def test_count_hero_assignments_of_an_empty_store_is_empty(store: Store) -> None:
    assert sp.count_hero_assignments(store) == {}


def test_count_hero_assignments_walks_the_roster_and_counts_each_lap(store: Store) -> None:
    bind_many(store, 13)
    counts = sp.count_hero_assignments(store)
    assert counts == {hero_id: 2 if hero_id in ("vell", "stitch") else 1 for hero_id in HERO_IDS}
    assert list(counts) != [] and set(counts) <= set(HERO_IDS)


def test_count_hero_assignments_leaves_out_a_hero_nobody_holds(store: Store) -> None:
    bind_many(store, 7)
    counts = sp.count_hero_assignments(store)
    assert counts == dict.fromkeys(HERO_IDS[:7], 1)
    assert "bur" not in counts


def test_count_hero_assignments_is_not_limited_by_the_listing_cap(store: Store) -> None:
    total = sp.MAX_LISTED_HEROES + 11
    for first in range(0, total, 100):
        bind_many(store, min(100, total - first), first)
    assert len(list_heroes(store)) == sp.MAX_LISTED_HEROES
    counts = sp.count_hero_assignments(store)
    assert sum(counts.values()) == total
    assert counts["vell"] == total // 11 + 1


def test_count_hero_assignments_counts_a_binding_that_left_the_roster(store: Store) -> None:
    bind_many(store, 3)
    with store.write() as conn:
        conn.execute(
            "INSERT INTO bot_presence (binding_id, state, since_ms)"
            " SELECT binding_id, 'absent', ? FROM bot_binding",
            (T0 + 1,),
        )
    assert sp.count_hero_assignments(store) == {"vell": 1, "stitch": 1, "reeve": 1}


def test_count_hero_assignments_writes_nothing(store: Store) -> None:
    bind_many(store, 4)
    before = rows(store, "SELECT * FROM hero_assignment ORDER BY assignment_no")
    sp.count_hero_assignments(store)
    assert rows(store, "SELECT * FROM hero_assignment ORDER BY assignment_no") == before


# --- avatar -------------------------------------------------------------------------------------


def test_choosing_an_avatar_appends_one_revision_and_changes_nothing_else(store: Store) -> None:
    (binding,) = bind_many(store, 1)
    asset = upload(store)
    fixed = "SELECT binding_id, assignment_no, hero_id, ordinal, assigned_ms FROM hero_assignment"
    before = rows(store, fixed), rows(store, "SELECT * FROM bot_binding")
    xp_before = rows(store, "SELECT * FROM xp_entry")
    chosen = set_avatar(store, binding, expected_version=0, asset_id=asset, now_ms=T0 + 7)
    assert (chosen.version, chosen.asset_id, chosen.updated_ms) == (1, asset, T0 + 7)
    assert (chosen.hero_id, chosen.ordinal, chosen.assigned_ms) == ("vell", 1, T0)
    assert (rows(store, fixed), rows(store, "SELECT * FROM bot_binding")) == before
    assert rows(store, "SELECT * FROM xp_entry") == xp_before
    assert get_hero(store, binding) == chosen
    assert count(store, "avatar_revision") == 1


def test_choosing_the_current_avatar_again_appends_nothing(store: Store) -> None:
    (binding,) = bind_many(store, 1)
    asset = upload(store)
    first = set_avatar(store, binding, expected_version=0, asset_id=asset, now_ms=T0 + 1)
    again = set_avatar(store, binding, expected_version=1, asset_id=asset, now_ms=T0 + 2)
    assert again == first
    assert count(store, "avatar_revision") == 1


def test_resetting_to_the_hero_portrait_appends_a_null_revision(store: Store) -> None:
    (binding,) = bind_many(store, 1)
    set_avatar(store, binding, expected_version=0, asset_id=upload(store), now_ms=T0 + 1)
    reset = set_avatar(store, binding, expected_version=1, asset_id=None, now_ms=T0 + 2)
    assert (reset.version, reset.asset_id, reset.updated_ms) == (2, None, T0 + 2)
    assert rows(store, "SELECT revision_no, asset_id FROM avatar_revision ORDER BY revision_no")[
        1
    ] == (2, None)


def test_resetting_when_already_on_the_hero_portrait_appends_nothing(store: Store) -> None:
    (binding,) = bind_many(store, 1)
    same = set_avatar(store, binding, expected_version=0, asset_id=None, now_ms=T0 + 1)
    assert same.version == 0 and count(store, "avatar_revision") == 0


def test_a_stale_expected_version_is_a_conflict_that_names_the_current_one(store: Store) -> None:
    (binding,) = bind_many(store, 1)
    set_avatar(store, binding, expected_version=0, asset_id=upload(store), now_ms=T0 + 1)
    with pytest.raises(VersionConflict) as caught:
        set_avatar(store, binding, expected_version=0, asset_id=None, now_ms=T0 + 2)
    assert caught.value.current_version == 1
    assert count(store, "avatar_revision") == 1


def test_an_unknown_asset_is_refused_and_writes_nothing(store: Store) -> None:
    (binding,) = bind_many(store, 1)
    with pytest.raises(UnknownAsset):
        set_avatar(store, binding, expected_version=0, asset_id="ast_" + "a" * 24, now_ms=T0)
    assert count(store, "avatar_revision") == 0


def test_an_unknown_binding_is_refused(store: Store) -> None:
    bind_many(store, 1)
    with pytest.raises(UnknownBinding):
        set_avatar(store, "bnd_" + "0" * 24, expected_version=0, asset_id=None, now_ms=T0)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"binding_id": "nope"},
        {"expected_version": -1},
        {"expected_version": True},
        {"asset_id": "ast_short"},
        {"now_ms": -1},
    ],
)
def test_malformed_arguments_are_usage_errors(store: Store, kwargs: dict[str, Any]) -> None:
    (binding,) = bind_many(store, 1)
    args: dict[str, Any] = {
        "binding_id": binding,
        "expected_version": 0,
        "asset_id": None,
        "now_ms": T0,
    }
    args.update(kwargs)
    with pytest.raises(StoreUsageError):
        set_avatar(
            store,
            args["binding_id"],
            args["expected_version"],
            args["asset_id"],
            args["now_ms"],
        )


def test_an_avatar_revision_must_reference_a_real_asset_at_the_sql_level(store: Store) -> None:
    (binding,) = bind_many(store, 1)
    with pytest.raises(sqlite3.IntegrityError), store.write() as conn:
        conn.execute(
            "INSERT INTO avatar_revision (binding_id, revision_no, asset_id, created_ms)"
            " VALUES (?, 1, 'ast_" + "b" * 24 + "', 0)",
            (binding,),
        )


def test_avatar_revisions_must_be_gapless_per_binding(store: Store) -> None:
    first, second = bind_many(store, 2)
    set_avatar(store, first, expected_version=0, asset_id=upload(store), now_ms=T0)
    with pytest.raises(sqlite3.DatabaseError, match="out of sequence"), store.write() as conn:
        conn.execute(
            "INSERT INTO avatar_revision (binding_id, revision_no, asset_id, created_ms)"
            " VALUES (?, 2, NULL, 0)",
            (second,),
        )


def test_each_binding_keeps_its_own_avatar_history(store: Store) -> None:
    first, second = bind_many(store, 2)
    set_avatar(store, first, expected_version=0, asset_id=upload(store, 1), now_ms=T0 + 1)
    set_avatar(store, second, expected_version=0, asset_id=upload(store, 2), now_ms=T0 + 2)
    heroes = {h.binding_id: h for h in list_heroes(store)}
    assert (heroes[first].version, heroes[second].version) == (1, 1)
    assert heroes[first].asset_id != heroes[second].asset_id


def test_set_avatar_takes_its_arguments_by_position_or_by_keyword(store: Store) -> None:
    first, second = bind_many(store, 2)
    asset = upload(store)
    by_position = set_avatar(store, first, 0, asset, T0 + 1)
    by_keyword = set_avatar(store, second, expected_version=0, asset_id=asset, now_ms=T0 + 1)
    assert (by_position.version, by_position.asset_id) == (by_keyword.version, by_keyword.asset_id)
