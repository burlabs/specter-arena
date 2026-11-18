from __future__ import annotations

import unicodedata
from dataclasses import dataclass

MAX_DISPLAY_NAME_CHARS = 128
MAX_FREE_TEXT_CHARS = 300
DEFAULT_DISPLAY_NAME = "an unnamed bot"
# Control, format (zero-width, bidirectional), surrogate, private-use, unassigned, separators.
_DROPPED_CATEGORIES = frozenset({"Cc", "Cf", "Cs", "Co", "Cn", "Zl", "Zp"})


class BriefRejected(ValueError):
    """User-typed brief text of the wrong type or too long; routes answer `invalid_body`."""


@dataclass(frozen=True, slots=True)
class BotCreativeBrief:
    """The only input the generator sees about a bot: three short strings, never memory, notes,
    goals, ledger items, transcripts, slot rows or attempts."""

    display_name: str
    purpose: str | None
    style: str | None


def clean_text(value: str) -> str:
    """NFC, every whitespace run as one space, invisible and control characters removed."""
    out: list[str] = []
    for char in unicodedata.normalize("NFC", value):
        if char.isspace():
            out.append(" ")
        elif unicodedata.category(char) not in _DROPPED_CATEGORIES:
            out.append(char)
    return " ".join("".join(out).split())


def _optional_text(value: object, field: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise BriefRejected(f"{field} must be a string")
    if len(value) > 4 * MAX_FREE_TEXT_CHARS:  # bound the work before cleaning
        raise BriefRejected(f"{field} is too long")
    text = clean_text(value)
    if len(text) > MAX_FREE_TEXT_CHARS:
        raise BriefRejected(f"{field} is too long")
    return text or None


def build_brief(display_name: str | None, purpose: object, style: object) -> BotCreativeBrief:
    """`display_name` is the store's newest bot display name (untrusted, so cleaned and cut);
    `purpose` and `style` are what the user typed in this app for this request."""
    name = clean_text(display_name or "")[:MAX_DISPLAY_NAME_CHARS].strip()
    return BotCreativeBrief(
        display_name=name or DEFAULT_DISPLAY_NAME,
        purpose=_optional_text(purpose, "purpose"),
        style=_optional_text(style, "style"),
    )
