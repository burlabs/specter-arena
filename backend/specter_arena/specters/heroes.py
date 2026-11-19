from __future__ import annotations

import functools
import json
import re
import unicodedata
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

HEROES_PATH: Final = Path(__file__).with_name("heroes.json")
ROSTER_SIZE: Final = 11
MAX_ORDINAL_ROMAN: Final = 3999
LIMITS: Final[Mapping[str, int]] = {"name": 6, "epithet": 60, "personality": 220, "appearance": 200}
_ID: Final = re.compile(r"[a-z]{2,12}")
_KEY: Final = re.compile(r"hero-([a-z]{2,12})-(sprite|thumbnail)")
_FIELDS: Final = frozenset(
    {
        "id",
        "name",
        "epithet",
        "personality",
        "appearance",
        "portraitSlug",
        "spriteKey",
        "thumbnailKey",
    }
)
_ROMAN: Final = (
    (1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"),
    (50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I"),
)  # fmt: skip


class HeroRosterError(Exception):
    """`heroes.json` breaks the roster rules; the service does not start."""


@dataclass(frozen=True, slots=True)
class Hero:
    id: str
    name: str
    epithet: str
    personality: str
    appearance: str
    portrait_slug: str
    sprite_key: str
    thumbnail_key: str


def roman(number: int) -> str:
    """Roman numeral for 1..3999; the digits above that, so the label never fails."""
    if number < 1:
        raise ValueError("ordinal starts at 1")
    if number > MAX_ORDINAL_ROMAN:
        return str(number)
    out: list[str] = []
    for value, symbol in _ROMAN:
        count, number = divmod(number, value)
        out.append(symbol * count)
    return "".join(out)


def display_name(hero: Hero, ordinal: int) -> str:
    return hero.name if ordinal == 1 else f"{hero.name} {roman(ordinal)}"


def _text(entry: Mapping[str, Any], field: str) -> str:
    value = entry.get(field)
    if not isinstance(value, str) or value != value.strip() or value == "":
        raise HeroRosterError(f"{field} must be a non-empty trimmed string")
    if len(value) > LIMITS.get(field, 64):
        raise HeroRosterError(f"{field} is too long")
    if "<" in value or ">" in value or any(unicodedata.category(c) in {"Cc", "Cf"} for c in value):
        raise HeroRosterError(f"{field} has markup or control characters")
    return value


def parse_heroes(text: str) -> tuple[Hero, ...]:
    try:
        doc = json.loads(text)
    except ValueError as error:
        raise HeroRosterError("heroes.json is not JSON") from error
    items = doc.get("heroes") if isinstance(doc, dict) and set(doc) == {"heroes"} else None
    if not isinstance(items, list) or len(items) != ROSTER_SIZE:
        raise HeroRosterError(f"heroes.json must hold exactly {ROSTER_SIZE} heroes")
    out: list[Hero] = []
    for entry in items:
        if not isinstance(entry, dict) or set(entry) != _FIELDS:
            raise HeroRosterError("a hero has missing or extra fields")
        hero = Hero(
            id=_text(entry, "id"),
            name=_text(entry, "name"),
            epithet=_text(entry, "epithet"),
            personality=_text(entry, "personality"),
            appearance=_text(entry, "appearance"),
            portrait_slug=_text(entry, "portraitSlug"),
            sprite_key=_text(entry, "spriteKey"),
            thumbnail_key=_text(entry, "thumbnailKey"),
        )
        sprite, thumb = _KEY.fullmatch(hero.sprite_key), _KEY.fullmatch(hero.thumbnail_key)
        if (
            not _ID.fullmatch(hero.id)
            or hero.portrait_slug != hero.id
            or sprite is None
            or thumb is None
            or (sprite[1], sprite[2], thumb[1], thumb[2])
            != (hero.id, "sprite", hero.id, "thumbnail")
        ):
            raise HeroRosterError(f"hero {hero.id!r} has inconsistent id, slug or keys")
        out.append(hero)
    if len({h.id for h in out}) != ROSTER_SIZE or len({h.name.lower() for h in out}) != ROSTER_SIZE:
        raise HeroRosterError("hero ids and names must be unique")
    return tuple(out)


@functools.cache
def load_heroes() -> tuple[Hero, ...]:
    """The roster in assignment order. Read once per process; any violation raises."""
    return parse_heroes(HEROES_PATH.read_text(encoding="utf-8"))


def hero_by_id() -> Mapping[str, Hero]:
    return {hero.id: hero for hero in load_heroes()}
