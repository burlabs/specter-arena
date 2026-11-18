import random
from typing import Any

import pytest

from backend.specter_arena.store import (
    BOUNTY_XP,
    LEVEL_FLOORS,
    LEVEL_TABLE_VERSION,
    MAX_ATTEMPTS_PER_WORK,
    MAX_CONDITION,
    MAX_CONTRIBUTORS,
    MAX_DEPTH,
    MAX_MILESTONE_LABEL,
    MAX_MILESTONES,
    MAX_NOTE,
    MAX_TITLE,
    POLICY_VERSION,
    StoreUsageError,
    level_for,
    split_bounty,
)


def ids(count: int) -> list[str]:
    return [f"bnd_{n:024x}" for n in range(1, count + 1)]


def test_the_policy_constants_are_the_approved_ones() -> None:
    assert POLICY_VERSION == "xp-policy-1"
    assert BOUNTY_XP == 100
    assert (MAX_CONTRIBUTORS, MAX_ATTEMPTS_PER_WORK, MAX_MILESTONES) == (8, 16, 8)
    assert (MAX_TITLE, MAX_CONDITION, MAX_NOTE, MAX_MILESTONE_LABEL) == (120, 280, 280, 80)
    assert MAX_DEPTH == 3
    assert LEVEL_TABLE_VERSION == "levels-1"
    assert LEVEL_FLOORS == (0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200)


def test_the_documented_example_splits_100_among_three() -> None:
    assert split_bounty(100, ["c", "a", "b"]) == {"a": 34, "b": 33, "c": 33}
    assert level_for(100) == (2, 100, 250)


def test_split_bounty_sums_to_the_bounty_for_every_size() -> None:
    for bounty in range(0, 251):
        for count in range(1, 9):
            assert sum(split_bounty(bounty, ids(count)).values()) == bounty, (bounty, count)


def test_split_bounty_gives_the_remainder_to_the_smallest_ids() -> None:
    for bounty in range(0, 251):
        for count in range(1, 9):
            shares = split_bounty(bounty, ids(count))
            base, extra = divmod(bounty, count)
            ordered = [shares[i] for i in sorted(shares)]
            assert ordered == [base + 1] * extra + [base] * (count - extra), (bounty, count)


def test_split_bounty_is_even_within_one() -> None:
    for bounty in range(0, 251):
        for count in range(1, 9):
            values = split_bounty(bounty, ids(count)).values()
            assert max(values) - min(values) <= 1


def test_split_bounty_is_independent_of_input_order() -> None:
    rnd = random.Random(20261118)
    for _ in range(200):
        chosen = ids(rnd.randint(1, 8))
        bounty = rnd.randint(0, 250)
        shuffled = chosen[:]
        rnd.shuffle(shuffled)
        assert split_bounty(bounty, shuffled) == split_bounty(bounty, chosen)


@pytest.mark.parametrize(
    "bounty, contributors",
    [
        (100, []),
        (100, ids(9)),
        (100, ["a", "a"]),
        (100, ["a", ""]),
        (100, ["a", 1]),
        (-1, ["a"]),
        (True, ["a"]),
        (1.5, ["a"]),
        ("100", ["a"]),
    ],
)
def test_split_bounty_refuses_duplicates_empty_nine_negative_and_bools(
    bounty: Any, contributors: list[Any]
) -> None:
    with pytest.raises(StoreUsageError):
        split_bounty(bounty, contributors)


def test_level_for_at_every_floor_and_one_below() -> None:
    for number, floor in enumerate(LEVEL_FLOORS, start=1):
        following = LEVEL_FLOORS[number] if number < len(LEVEL_FLOORS) else None
        assert level_for(floor) == (number, floor, following)
        if floor > 0:
            below = number - 1
            previous = LEVEL_FLOORS[below - 1]
            assert level_for(floor - 1) == (below, previous, floor)


def test_level_for_is_monotonic_and_caps_at_ten() -> None:
    levels = [level_for(total)[0] for total in range(0, 4000)]
    assert levels == sorted(levels)
    assert levels[0] == 1 and levels[-1] == 10
    assert level_for(10**9) == (10, 3200, None)


@pytest.mark.parametrize("total", [-1, True, 1.5, "3", None])
def test_level_for_refuses_negative_and_non_integers(total: Any) -> None:
    with pytest.raises(StoreUsageError):
        level_for(total)


def test_the_level_table_is_ordered_versioned_and_starts_at_zero() -> None:
    assert LEVEL_FLOORS[0] == 0
    assert list(LEVEL_FLOORS) == sorted(set(LEVEL_FLOORS))
    assert LEVEL_TABLE_VERSION.startswith("levels-")
