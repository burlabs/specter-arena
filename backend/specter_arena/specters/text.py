from __future__ import annotations

import unicodedata

# Control, format (zero-width, bidirectional), surrogate, private-use, unassigned, separators.
_DROPPED_CATEGORIES = frozenset({"Cc", "Cf", "Cs", "Co", "Cn", "Zl", "Zp"})


def clean_text(value: str) -> str:
    """NFC, every whitespace run as one space, invisible and control characters removed."""
    out: list[str] = []
    for char in unicodedata.normalize("NFC", value):
        if char.isspace():
            out.append(" ")
        elif unicodedata.category(char) not in _DROPPED_CATEGORIES:
            out.append(char)
    return " ".join("".join(out).split())
