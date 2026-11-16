from __future__ import annotations

import re

from ..store import DmKey, parse_dm_key

__all__ = [
    "DmKey",
    "bot_dm_key",
    "is_store_less_key",
    "parse_dm_key",
    "ref_key_ok",
    "slot_key_ok",
]

MAX_KEY_CHARS = 256

_STORE_LESS = re.compile(r"member-[A-Za-z0-9_-]{1,128}")
_WORKER_KEY = re.compile(r"[A-Za-z0-9._:-]{1,128}")
_REF_KEY = re.compile(r"[A-Za-z0-9._:-]{1,256}")


def bot_dm_key(key: object) -> DmKey | None:
    """A DmKey that can be bound: it parses and has a private memory store. None otherwise."""
    if not isinstance(key, str):
        return None
    parsed = parse_dm_key(key)
    return parsed if parsed is not None and parsed.memory_store != "" else None


def is_store_less_key(key: object) -> bool:
    """`member-<id>` with no `.memory-` part: counted for the roster note, never bound."""
    return (
        isinstance(key, str)
        and len(key) <= MAX_KEY_CHARS
        and _STORE_LESS.fullmatch(key) is not None
    )


def slot_key_ok(key: object) -> bool:
    """A worker slot key such as `chat-61-1794779966`."""
    return isinstance(key, str) and _WORKER_KEY.fullmatch(key) is not None


def ref_key_ok(key: object) -> bool:
    """A slot key used as a reference (event slot, `parentKey`), long enough for a bot DM key."""
    return (
        isinstance(key, str) and len(key) <= MAX_KEY_CHARS and _REF_KEY.fullmatch(key) is not None
    )
