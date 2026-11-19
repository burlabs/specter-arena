"""The fixed roster: names, ids, limits, text rules and the display-name composition."""

import json
import re
from pathlib import Path
from typing import Any

import pytest

from backend.specter_arena.specters import heroes as heroes_module
from backend.specter_arena.specters.bundled import BUNDLED
from backend.specter_arena.specters.heroes import (
    HEROES_PATH,
    LIMITS,
    ROSTER_SIZE,
    HeroRosterError,
    display_name,
    hero_by_id,
    load_heroes,
    parse_heroes,
    roman,
)

NAMES = [
    "Vell",
    "Stitch",
    "Reeve",
    "Rattle",
    "Ember",
    "Shard",
    "Poly",
    "Tide",
    "Lume",
    "Moss",
    "bur",
]
IDS = ["vell", "stitch", "reeve", "rattle", "ember", "shard", "poly", "tide", "lume", "moss", "bur"]
DENIED = {
    "class", "classes", "archetype", "archetypes", "species", "category", "categories",
    "taxonomy", "role", "roles", "rarity", "tier", "rank", "score", "scores", "rating",
    "classifier", "classification", "capability", "capabilities", "alignment", "element",
    "specialty", "specialization", "lane", "job", "agent", "bot",
}  # fmt: skip


def raw() -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads(HEROES_PATH.read_text(encoding="utf-8"))
    return loaded


def text_of(doc: Any) -> str:
    return json.dumps(doc)


def test_names_are_pinned() -> None:
    assert [hero.name for hero in load_heroes()] == NAMES
    assert "bur" in NAMES and "Bur" not in NAMES  # lowercase on purpose
    assert "Poly" in NAMES


def test_ids_are_pinned_and_lowercase() -> None:
    assert [hero.id for hero in load_heroes()] == IDS
    assert all(hero.id == hero.id.lower() for hero in load_heroes())
    assert len(load_heroes()) == ROSTER_SIZE == 11


def test_text_limits_hold_for_every_hero() -> None:
    for hero in load_heroes():
        assert 0 < len(hero.name) <= LIMITS["name"]
        assert 0 < len(hero.epithet) <= 60
        assert 0 < len(hero.personality) <= 220
        assert 0 < len(hero.appearance) <= 200


def test_no_markup_or_control_characters() -> None:
    for hero in load_heroes():
        for value in (hero.epithet, hero.personality, hero.appearance, hero.name):
            assert "<" not in value and ">" not in value
            assert all(ord(c) >= 32 and ord(c) != 127 for c in value)


def test_every_hero_portrait_slug_is_a_bundled_slug() -> None:
    bundled = {art.slug for art in BUNDLED}
    assert {hero.portrait_slug for hero in load_heroes()} == bundled


def test_keys_follow_the_pattern() -> None:
    for hero in load_heroes():
        assert hero.sprite_key == f"hero-{hero.id}-sprite"
        assert hero.thumbnail_key == f"hero-{hero.id}-thumbnail"


def test_hero_text_has_no_denied_token_or_role_word() -> None:
    for hero in load_heroes():
        words = set(
            re.findall(
                r"[a-z]+", " ".join([hero.epithet, hero.personality, hero.appearance]).lower()
            )
        )
        assert not words & DENIED, (hero.id, words & DENIED)


def mutated(change: Any) -> str:
    doc = raw()
    change(doc)
    return text_of(doc)


def _drop_last(doc: dict[str, Any]) -> None:
    doc["heroes"].pop()


def _add_one(doc: dict[str, Any]) -> None:
    doc["heroes"].append({**doc["heroes"][0]})


def _dup_id(doc: dict[str, Any]) -> None:
    doc["heroes"][1]["id"] = "vell"
    doc["heroes"][1]["portraitSlug"] = "vell"
    doc["heroes"][1]["spriteKey"] = "hero-vell-sprite"
    doc["heroes"][1]["thumbnailKey"] = "hero-vell-thumbnail"


def _dup_name(doc: dict[str, Any]) -> None:
    doc["heroes"][1]["name"] = "VELL"


def _extra_field(doc: dict[str, Any]) -> None:
    doc["heroes"][0]["role"] = "x"


def _missing_field(doc: dict[str, Any]) -> None:
    del doc["heroes"][0]["epithet"]


def _untrimmed(doc: dict[str, Any]) -> None:
    doc["heroes"][0]["epithet"] = " padded"


def _long_epithet(doc: dict[str, Any]) -> None:
    doc["heroes"][0]["epithet"] = "x" * 61


def _markup(doc: dict[str, Any]) -> None:
    doc["heroes"][0]["personality"] = "a <b>tag</b>"


def _control(doc: dict[str, Any]) -> None:
    doc["heroes"][0]["appearance"] = "a\u200bb"


def _key_mismatch(doc: dict[str, Any]) -> None:
    doc["heroes"][0]["spriteKey"] = "hero-stitch-sprite"


def _slug_mismatch(doc: dict[str, Any]) -> None:
    doc["heroes"][0]["portraitSlug"] = "stitch"


def _empty(doc: dict[str, Any]) -> None:
    doc["heroes"][0]["name"] = ""


def _not_string(doc: dict[str, Any]) -> None:
    doc["heroes"][0]["name"] = 7


def _extra_top(doc: dict[str, Any]) -> None:
    doc["extra"] = 1


def _entry_not_object(doc: dict[str, Any]) -> None:
    doc["heroes"][0] = "vell"


@pytest.mark.parametrize(
    "change",
    [
        _drop_last,
        _add_one,
        _dup_id,
        _dup_name,
        _extra_field,
        _missing_field,
        _untrimmed,
        _long_epithet,
        _markup,
        _control,
        _key_mismatch,
        _slug_mismatch,
        _empty,
        _not_string,
        _extra_top,
        _entry_not_object,
    ],
)
def test_parse_rejects_a_roster_that_breaks_a_rule(change: Any) -> None:
    with pytest.raises(HeroRosterError):
        parse_heroes(mutated(change))


@pytest.mark.parametrize("text", ["not json", "[]", "7", "null", '{"heroes": 5}', "{}"])
def test_parse_rejects_text_that_is_not_the_roster_shape(text: str) -> None:
    with pytest.raises(HeroRosterError):
        parse_heroes(text)


def test_a_bare_list_is_not_the_roster() -> None:
    with pytest.raises(HeroRosterError):
        parse_heroes(text_of(raw()["heroes"]))


@pytest.mark.parametrize(
    ("number", "expected"),
    [
        (1, "I"),
        (2, "II"),
        (3, "III"),
        (4, "IV"),
        (9, "IX"),
        (14, "XIV"),
        (40, "XL"),
        (90, "XC"),
        (400, "CD"),
        (3999, "MMMCMXCIX"),
    ],
)
def test_roman_values(number: int, expected: str) -> None:
    assert roman(number) == expected


def test_roman_falls_back_to_digits_above_3999() -> None:
    assert roman(4000) == "4000"
    assert roman(12345) == "12345"


@pytest.mark.parametrize("bad", [0, -1])
def test_roman_rejects_zero_and_below(bad: int) -> None:
    with pytest.raises(ValueError, match="ordinal"):
        roman(bad)


def test_display_name_ordinal_one_is_bare() -> None:
    assert [display_name(hero, 1) for hero in load_heroes()] == NAMES


def test_display_name_from_two_adds_roman() -> None:
    by_id = hero_by_id()
    assert display_name(by_id["vell"], 2) == "Vell II"
    assert display_name(by_id["bur"], 3) == "bur III"
    assert display_name(by_id["vell"], 4000) == "Vell 4000"


def test_longest_display_name_fits_the_40_char_contract() -> None:
    longest = max(load_heroes(), key=lambda hero: len(hero.name))
    assert len(display_name(longest, 3888)) <= 40
    assert len(display_name(longest, 10**15)) <= 40


def test_load_heroes_is_cached_and_immutable() -> None:
    assert load_heroes() is load_heroes()
    assert isinstance(load_heroes(), tuple)
    with pytest.raises(AttributeError):
        load_heroes()[0].name = "x"  # type: ignore[misc]


def test_hero_by_id_maps_every_hero() -> None:
    assert list(hero_by_id()) == IDS


def test_the_roster_path_sits_beside_the_loader() -> None:
    assert Path(heroes_module.__file__).with_name("heroes.json") == HEROES_PATH
