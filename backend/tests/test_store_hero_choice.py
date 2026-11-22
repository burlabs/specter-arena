"""Choosing a hero: pick, random, idempotent replay and the lists (FP-23, WL)."""

import threading
from collections import Counter
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import pytest

from backend.specter_arena.store import (
    HERO_IDS,
    NoHero,
    Store,
    StoreUsageError,
    UnknownBinding,
    VersionConflict,
    choose_hero,
    get_assignment,
    get_hero,
    list_assignment,
    list_heroes,
    open_store,
    set_avatar,
)
from backend.specter_arena.store import specters as sp

from .specter_fakes import table_counts
from .test_store_heroes import T0, bind_many, count, rows, upload

NEVER = "bnd_" + "0" * 24


@pytest.fixture
def store(tmp_path: Path):  # type: ignore[no-untyped-def]
    opened = open_store(tmp_path / "data")
    try:
        yield opened
    finally:
        opened.close()


def first(candidates: Sequence[str]) -> str:
    return candidates[0]


def test_a_picked_hero_is_stored_with_ordinal_one_and_assigned_by_picked(store: Store) -> None:
    (binding,) = bind_many(store, 1, assign=False)
    made = choose_hero(store, binding, 0, "ember", T0 + 5)
    assert (made.hero_id, made.ordinal, made.assignment_no) == ("ember", 1, 0)
    assert (made.assigned_by, made.version, made.asset_id) == ("picked", 0, None)
    assert made.assigned_ms == made.updated_ms == T0 + 5
    assert get_hero(store, binding) == made


def test_a_held_hero_may_be_picked_again_and_takes_the_next_ordinal(store: Store) -> None:
    one, two, three = bind_many(store, 3, assign=False)
    assert choose_hero(store, one, 0, "vell", T0).ordinal == 1
    assert choose_hero(store, two, 0, "vell", T0 + 1).ordinal == 2
    other = choose_hero(store, three, 0, "bur", T0 + 2)
    assert (other.ordinal, other.assignment_no) == (1, 2)


def test_the_same_pick_again_returns_the_current_record_and_writes_nothing(store: Store) -> None:
    (binding,) = bind_many(store, 1, assign=False)
    made = choose_hero(store, binding, 0, "tide", T0)
    before = table_counts(store, except_prefixes=())
    again = choose_hero(store, binding, 0, "tide", T0 + 99)
    assert again == made and again.assigned_ms == T0
    assert table_counts(store, except_prefixes=()) == before


def test_a_replay_after_an_avatar_change_ignores_the_stale_expected_version(store: Store) -> None:
    (binding,) = bind_many(store, 1, assign=False)
    choose_hero(store, binding, 0, "tide", T0)
    set_avatar(store, binding, 0, upload(store), T0 + 1)
    again = choose_hero(store, binding, 0, "tide", T0 + 2)
    assert again.version == 1 and again.asset_id is not None and again.assigned_by == "picked"


def test_a_different_hero_on_an_assigned_binding_is_a_conflict(store: Store) -> None:
    (binding,) = bind_many(store, 1, assign=False)
    choose_hero(store, binding, 0, "tide", T0)
    set_avatar(store, binding, 0, upload(store), T0 + 1)
    with pytest.raises(VersionConflict) as caught:
        choose_hero(store, binding, 0, "vell", T0 + 2)
    assert caught.value.current_version == 1
    assert get_hero(store, binding).hero_id == "tide"


def test_a_random_request_on_an_assigned_binding_is_a_conflict(store: Store) -> None:
    (binding,) = bind_many(store, 1, assign=False)
    choose_hero(store, binding, 0, None, T0)
    with pytest.raises(VersionConflict):
        choose_hero(store, binding, 0, None, T0 + 1)
    assert count(store, "hero_assignment") == 1


@pytest.mark.parametrize("expected", [1, 7])
def test_assigning_with_a_nonzero_expected_version_is_a_conflict_that_names_zero(
    store: Store, expected: int
) -> None:
    (binding,) = bind_many(store, 1, assign=False)
    with pytest.raises(VersionConflict) as caught:
        choose_hero(store, binding, expected, "vell", T0)
    assert caught.value.current_version == 0
    assert count(store, "hero_assignment") == 0


def test_an_unknown_binding_is_refused_and_writes_nothing(store: Store) -> None:
    bind_many(store, 1, assign=False)
    with pytest.raises(UnknownBinding):
        choose_hero(store, NEVER, 0, "vell", T0)
    assert count(store, "hero_assignment") == 0


@pytest.mark.parametrize(
    "kwargs",
    [
        {"binding_id": "nope"},
        {"binding_id": 5},
        {"expected_version": -1},
        {"expected_version": True},
        {"expected_version": "0"},
        {"hero_id": "nova"},
        {"hero_id": "VELL"},
        {"hero_id": 3},
        {"now_ms": -1},
        {"now_ms": 1.5},
    ],
)
def test_malformed_arguments_are_usage_errors(store: Store, kwargs: dict[str, Any]) -> None:
    (binding,) = bind_many(store, 1, assign=False)
    arguments: dict[str, Any] = {
        "binding_id": binding,
        "expected_version": 0,
        "hero_id": "vell",
        "now_ms": T0,
    }
    arguments.update(kwargs)
    with pytest.raises(StoreUsageError):
        choose_hero(store, **arguments)
    assert count(store, "hero_assignment") == 0


def test_the_first_eleven_random_picks_are_eleven_different_heroes(store: Store) -> None:
    ids = bind_many(store, 22, assign=False)
    made = [choose_hero(store, binding, 0, None, T0 + n) for n, binding in enumerate(ids)]
    assert all(m.assigned_by == "random" for m in made)
    assert len({m.hero_id for m in made[:11]}) == 11
    assert len({m.hero_id for m in made[11:]}) == 11
    assert [m.ordinal for m in made] == [1] * 11 + [2] * 11
    assert [m.assignment_no for m in made] == list(range(22))


def test_a_random_pick_chooses_only_among_the_least_held_heroes(store: Store) -> None:
    held = bind_many(store, 4, assign=False)
    for n, hero in enumerate(("vell", "vell", "stitch", "reeve")):
        choose_hero(store, held[n], 0, hero, T0 + n)
    (target,) = bind_many(store, 1, first=4, assign=False)
    seen: list[list[str]] = []

    def record(candidates: Sequence[str]) -> str:
        seen.append(list(candidates))
        return candidates[-1]

    made = choose_hero(store, target, 0, None, T0 + 9, pick=record)
    assert seen == [[h for h in HERO_IDS if h not in ("vell", "stitch", "reeve")]]
    assert made.hero_id == "bur"


def test_a_random_pick_among_equals_can_land_on_every_candidate(store: Store) -> None:
    ids = bind_many(store, 11, assign=False)
    landed = Counter(choose_hero(store, binding, 0, None, T0).hero_id for binding in ids)
    assert set(landed) == set(HERO_IDS)


def test_random_after_all_heroes_are_held_once_starts_a_second_lap(store: Store) -> None:
    ids = bind_many(store, 12, assign=False)
    for n in range(11):
        choose_hero(store, ids[n], 0, HERO_IDS[n], T0 + n)
    made = choose_hero(store, ids[11], 0, None, T0 + 20, pick=first)
    assert (made.hero_id, made.ordinal) == ("vell", 2)


def test_choosing_writes_one_hero_row_and_nothing_else(store: Store) -> None:
    one, two = bind_many(store, 2, assign=False)
    before = table_counts(store, except_prefixes=("hero_assignment",))
    choose_hero(store, one, 0, "moss", T0)
    choose_hero(store, two, 0, None, T0 + 1)
    assert table_counts(store, except_prefixes=("hero_assignment",)) == before
    assert count(store, "hero_assignment") == 2


def test_a_failed_pick_writes_nothing(store: Store) -> None:
    (binding,) = bind_many(store, 1, assign=False)

    def broken(_: Sequence[str]) -> str:
        raise RuntimeError("no luck")

    with pytest.raises(RuntimeError):
        choose_hero(store, binding, 0, None, T0, pick=broken)
    assert count(store, "hero_assignment") == 0
    assert choose_hero(store, binding, 0, "vell", T0).assignment_no == 0


def test_two_threads_assigning_one_binding_write_one_row(store: Store) -> None:
    (binding,) = bind_many(store, 1, assign=False)
    results: list[Any] = []

    def one(hero: str) -> None:
        try:
            results.append(choose_hero(store, binding, 0, hero, T0))
        except VersionConflict as error:
            results.append(error)

    threads = [threading.Thread(target=one, args=(hero,)) for hero in ("vell", "stitch")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert count(store, "hero_assignment") == 1
    assert sorted(type(r).__name__ for r in results) == ["HeroRecord", "VersionConflict"]


def test_threads_assigning_the_same_hero_to_different_bindings_get_gapless_ordinals(
    store: Store,
) -> None:
    ids = bind_many(store, 8, assign=False)
    failures: list[BaseException] = []

    def one(binding: str) -> None:
        try:
            choose_hero(store, binding, 0, "vell", T0)
        except BaseException as error:  # noqa: BLE001 - collected and asserted below
            failures.append(error)

    threads = [threading.Thread(target=one, args=(binding,)) for binding in ids]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert failures == []
    heroes = list_heroes(store)
    assert [h.assignment_no for h in heroes] == list(range(8))
    assert sorted(h.ordinal for h in heroes) == list(range(1, 9))


def test_list_assignment_splits_the_bindings_into_assigned_and_unassigned(store: Store) -> None:
    ids = bind_many(store, 5, assign=False)
    choose_hero(store, ids[3], 0, "vell", T0)
    choose_hero(store, ids[1], 0, "stitch", T0 + 1)
    assigned, unassigned = list_assignment(store)
    assert [h.binding_id for h in assigned] == [ids[3], ids[1]]
    assert list(unassigned) == [ids[0], ids[2], ids[4]]
    assert set(unassigned).isdisjoint(h.binding_id for h in assigned)
    assert len(assigned) + len(unassigned) == count(store, "bot_binding")


def test_list_assignment_of_an_empty_store_is_empty(store: Store) -> None:
    assert list_assignment(store) == ((), ())


def test_list_assignment_is_capped_for_each_list(store: Store) -> None:
    total = sp.MAX_LISTED_HEROES + 3
    for start in range(0, total, 100):
        bind_many(store, min(100, total - start), start, assign=False)
    assigned, unassigned = list_assignment(store)
    assert assigned == () and len(unassigned) == sp.MAX_LISTED_HEROES


def test_get_assignment_tells_no_hero_from_an_unknown_binding(store: Store) -> None:
    one, two = bind_many(store, 2, assign=False)
    choose_hero(store, one, 0, "poly", T0)
    assert get_assignment(store, one).hero_id == "poly"
    with pytest.raises(NoHero):
        get_assignment(store, two)
    for bad in (NEVER, "nope", "", "bnd_" + "A" * 24):
        with pytest.raises(UnknownBinding):
            get_assignment(store, bad)


def test_the_avatar_of_an_unassigned_binding_is_no_hero_and_of_an_unknown_one_is_unknown(
    store: Store,
) -> None:
    (binding,) = bind_many(store, 1, assign=False)
    with pytest.raises(NoHero):
        set_avatar(store, binding, 0, None, T0)
    with pytest.raises(UnknownBinding):
        set_avatar(store, NEVER, 0, None, T0)


def test_assigned_by_is_auto_for_a_migrated_row_and_the_record_reads_it(store: Store) -> None:
    (binding,) = bind_many(store, 1, assign=False)
    with store.write() as conn:
        conn.execute(
            "INSERT INTO hero_assignment VALUES (?, 0, 'vell', 1, ?, 'auto')", (binding, T0)
        )
    assert get_hero(store, binding).assigned_by == "auto"
    assert rows(store, "SELECT assigned_by FROM hero_assignment") == [("auto",)]
