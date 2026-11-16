from __future__ import annotations

import re

from .records import DmKey

MAX_DM_KEY_CHARS = 256
MEMBER_ID_PATTERN = r"[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?"
MEMORY_STORE_PATTERN = r"[A-Za-z0-9._-]{1,128}"

_MEMBER_PREFIX = "member-"
_STORE_INFIX = ".memory-"
_MEMBER_ID = re.compile(MEMBER_ID_PATTERN)
_MEMORY_STORE = re.compile(MEMORY_STORE_PATTERN)


def is_member_id(value: str) -> bool:
    return _MEMBER_ID.fullmatch(value) is not None


def is_memory_store(value: str) -> bool:
    return _MEMORY_STORE.fullmatch(value) is not None


def parse_dm_key(key: str) -> DmKey | None:
    """Split `member-<id>[.memory-<store>]`; None for anything else.

    The member id never contains a dot, so the first dot ends it.
    """
    if len(key) > MAX_DM_KEY_CHARS or not key.startswith(_MEMBER_PREFIX):
        return None
    rest = key[len(_MEMBER_PREFIX) :]
    member_id, dot, tail = rest.partition(".")
    if not is_member_id(member_id):
        return None
    if not dot:
        return DmKey(member_id=member_id, memory_store="")
    if not (dot + tail).startswith(_STORE_INFIX):
        return None
    store = (dot + tail)[len(_STORE_INFIX) :]
    if not is_memory_store(store):
        return None
    return DmKey(member_id=member_id, memory_store=store)


def build_dm_key(parts: DmKey) -> str:
    suffix = f"{_STORE_INFIX}{parts.memory_store}" if parts.memory_store else ""
    return f"{_MEMBER_PREFIX}{parts.member_id}{suffix}"
