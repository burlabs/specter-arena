from __future__ import annotations

import re

from .dmkey import is_member_id, is_memory_store
from .records import MAX_NAME_CHARS, MAX_ROSTER_ROWS, BindingSeen, RosterPoll, RosterRowIn

AVATAR_KIND_PATTERN = r"[a-z][a-z0-9_-]{0,31}"
AVATAR_REF_PATTERN = r"[A-Za-z0-9._-]{1,128}"
ROSTER_REASON_PATTERN = r"[a-z][a-z0-9-]{0,63}"

_AVATAR_KIND = re.compile(AVATAR_KIND_PATTERN)
_AVATAR_REF = re.compile(AVATAR_REF_PATTERN)
_ROSTER_REASON = re.compile(ROSTER_REASON_PATTERN)


def is_time_ms(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _optional_time_ms(value: object) -> bool:
    return value is None or is_time_ms(value)


def binding_seen_reason(item: BindingSeen) -> str | None:
    key = item.key
    if not (isinstance(key.member_id, str) and isinstance(key.memory_store, str)):
        return "bad-field"
    if not is_time_ms(item.seen_at_ms) or not _optional_time_ms(item.source_time_ms):
        return "bad-field"
    if not is_member_id(key.member_id):
        return "bad-dm-key"
    if key.memory_store == "":
        return "store-less-bot"
    if not is_memory_store(key.memory_store):
        return "bad-dm-key"
    return None


def roster_row_reason(row: RosterRowIn) -> str | None:
    if not (isinstance(row.memory_store, str) and isinstance(row.name, str)):
        return "bad-roster-row"
    if row.memory_store != "" and not is_memory_store(row.memory_store):
        return "bad-roster-row"
    if len(row.name) > MAX_NAME_CHARS:
        return "bad-roster-row"
    if row.display_name is not None and (
        not isinstance(row.display_name, str) or len(row.display_name) > MAX_NAME_CHARS
    ):
        return "bad-roster-row"
    if row.avatar_kind is not None and (
        not isinstance(row.avatar_kind, str) or _AVATAR_KIND.fullmatch(row.avatar_kind) is None
    ):
        return "bad-roster-row"
    if row.avatar_ref is not None and (
        not isinstance(row.avatar_ref, str) or _AVATAR_REF.fullmatch(row.avatar_ref) is None
    ):
        return "bad-roster-row"
    return None


def roster_poll_reason(item: RosterPoll) -> str | None:
    if not isinstance(item.success, bool) or not is_time_ms(item.polled_at_ms):
        return "bad-field"
    if item.reason is not None and (
        not isinstance(item.reason, str) or _ROSTER_REASON.fullmatch(item.reason) is None
    ):
        return "bad-field"
    if not isinstance(item.rows, tuple) or len(item.rows) > MAX_ROSTER_ROWS:
        return "bad-field"
    if not item.success:
        return "bad-field" if item.rows else None
    for row in item.rows:
        reason = roster_row_reason(row)
        if reason is not None:
            return reason
    stores = [row.memory_store for row in item.rows if row.memory_store != ""]
    if len(stores) != len(set(stores)):
        return "bad-roster-row"
    return None
