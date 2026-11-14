from __future__ import annotations

import base64
import binascii
import json
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass

from .errors import InvalidCursor

DEFAULT_LIMIT = 50
MAX_LIMIT = 200
MAX_CURSOR_CHARS = 512
MAX_CURSOR_VALUES = 8
MAX_CURSOR_TEXT = 128
CURSOR_PATTERN = r"^[A-Za-z0-9_-]+$"
PAGE_CONTRACT_VERSION = 1

CursorValue = int | str

_TOKEN = re.compile(CURSOR_PATTERN)


def clamp_limit(
    requested: int | None, default: int = DEFAULT_LIMIT, maximum: int = MAX_LIMIT
) -> int:
    if isinstance(requested, bool):
        raise TypeError("limit must be an int")
    return min(max(default if requested is None else requested, 1), maximum)


def _is_cursor_value(value: object) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, str):
        return len(value) <= MAX_CURSOR_TEXT
    return isinstance(value, int)


def encode_cursor(values: Sequence[CursorValue]) -> str:
    if not 1 <= len(values) <= MAX_CURSOR_VALUES:
        raise InvalidCursor
    if not all(_is_cursor_value(value) for value in values):
        raise InvalidCursor
    canonical = json.dumps(list(values), separators=(",", ":"), ensure_ascii=True)
    token = base64.urlsafe_b64encode(canonical.encode("ascii")).rstrip(b"=").decode("ascii")
    if len(token) > MAX_CURSOR_CHARS:
        raise InvalidCursor
    return token


def decode_cursor(token: str, arity: int) -> tuple[CursorValue, ...]:
    """The strict inverse of `encode_cursor`: any token it would not have produced is rejected.

    The token is untrusted request input; the values are only ever used as bind parameters.
    """
    if not token or len(token) > MAX_CURSOR_CHARS or not _TOKEN.fullmatch(token):
        raise InvalidCursor
    try:
        raw = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4))
        decoded = json.loads(raw.decode("ascii"))
    except (binascii.Error, UnicodeDecodeError, ValueError, RecursionError) as error:
        raise InvalidCursor from error
    if not isinstance(decoded, list) or len(decoded) != arity:
        raise InvalidCursor
    if not all(_is_cursor_value(value) for value in decoded):
        raise InvalidCursor
    values: tuple[CursorValue, ...] = tuple(decoded)
    if encode_cursor(values) != token:
        raise InvalidCursor
    return values


@dataclass(frozen=True)
class Page[T]:
    items: tuple[T, ...]
    next_cursor: str | None

    def to_wire(self, item_to_wire: Callable[[T], Mapping[str, object]]) -> dict[str, object]:
        """The `page.v1` wire object; the caller converts each item to its own wire shape."""
        return {
            "contractVersion": PAGE_CONTRACT_VERSION,
            "items": [dict(item_to_wire(item)) for item in self.items],
            "nextCursor": self.next_cursor,
        }


def build_page[T](
    rows: Sequence[T], limit: int, cursor_of: Callable[[T], Sequence[CursorValue]]
) -> Page[T]:
    """Build a page from rows fetched with `LIMIT limit + 1`; a surplus row means more exist."""
    if limit < 1:
        raise ValueError("limit must be at least 1")
    if len(rows) <= limit:
        return Page(tuple(rows), None)
    kept = tuple(rows[:limit])
    return Page(kept, encode_cursor(cursor_of(kept[-1])))
