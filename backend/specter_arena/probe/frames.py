# SPECTER-DIAGNOSTIC-ONLY
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal, TypeGuard

MARKER = "SPECTER-DIAGNOSTIC-ONLY"

MAX_LINEAGE_DEPTH = 8
MAX_EVIDENCE_CHARS = 500
DM_KEY_PREFIX = "member-"
MEMORY_STORE_SUFFIX = ".memory-"

SignalKind = Literal[
    "start",
    "progress",
    "terminal",
    "approval",
    "needs-input",
    "removed",
    "chat-status",
    "chat-done",
    "tool-call",
    "tool-result",
    "context-usage",
    "approval-resolved",
    "subagent-spawn",
    "subagent-status",
    "subagent-done",
    "reconnect",
    "resync",
]
SlotRole = Literal["bot-dm", "worker", "other"]
AttemptKind = Literal["bot-turn", "worker-session", "external-cli", "app-session"]

# Outcome text must never read as a verdict that work was taken as done: a finished model turn
# says nothing about whether anyone took the result. The stem is matched, not one spelling.
_VERDICT_STEM = re.compile(r"(?i)accept\w*")
VERDICT_MASK = "[withheld]"

Row = dict[str, object]


@dataclass(frozen=True)
class Signal:
    kind: SignalKind
    slot_key: str
    at: str


@dataclass
class Attempt:
    id: str
    kind: AttemptKind
    bot_ref: str | None = None
    signals: list[Signal] = field(default_factory=list)
    outcome_evidence: str | None = None


def slot_rows(frame: dict[str, object]) -> list[Row]:
    """Rows of a `{"type": "slots", "data": [...]}` frame; any other frame has none."""
    if frame.get("type") != "slots":
        return []
    data = frame.get("data")
    if not isinstance(data, list):
        return []
    return [row for row in data if isinstance(row, dict)]


def _text(row: Row, name: str) -> str:
    value = row.get(name)
    return value if isinstance(value, str) else ""


def is_bot_dm_key(key: str, probe_slug: str) -> bool:
    """A member DM slot key: `member-<slug>`, or `member-<slug>.memory-<store>` for a bot that
    has its own memory store. Nothing looser: `member-<slug>x` belongs to another bot."""
    if not probe_slug:
        return False
    dm_key = f"{DM_KEY_PREFIX}{probe_slug}"
    return key == dm_key or key.startswith(f"{dm_key}{MEMORY_STORE_SUFFIX}")


def probe_keys(rows: list[Row], probe_slug: str) -> set[str]:
    """The probe bot's DM slot plus every slot whose `created_by` chain reaches it.

    A worker counts when its `created_by` names either DM key form, whether or not that DM row
    is in the snapshot. Walks at most MAX_LINEAGE_DEPTH levels. Growth is monotonic, so a cycle
    in `created_by` ends the walk instead of looping.
    """
    if not probe_slug:
        return set()
    keys = {key for row in rows if is_bot_dm_key(key := _text(row, "key"), probe_slug)}
    for _ in range(MAX_LINEAGE_DEPTH):
        grown = {
            _text(row, "key")
            for row in rows
            if _text(row, "key")
            and (
                _text(row, "created_by") in keys
                or is_bot_dm_key(_text(row, "created_by"), probe_slug)
            )
        }
        if grown <= keys:
            break
        keys |= grown
    return keys


def slot_role(row: Row, probe_slug: str) -> SlotRole:
    if is_bot_dm_key(_text(row, "key"), probe_slug):
        return "bot-dm"
    return "worker" if _text(row, "created_by") else "other"


def _instant(value: str | int | float) -> tuple[float, bool] | None:
    """(epoch seconds, timezone-aware?) for a stamp, or None for text that is not ISO-8601.
    A bare number is an epoch value, so it compares with aware stamps."""
    if not isinstance(value, str):
        return float(value), True
    try:
        parsed = datetime.fromisoformat(value.strip())
    except ValueError:
        return None
    return parsed.timestamp(), parsed.tzinfo is not None


def _is_stamp(value: object) -> TypeGuard[str | int | float]:
    if isinstance(value, str):
        return bool(value.strip())
    return isinstance(value, int | float) and not isinstance(value, bool)


def _moved(then: object, now: object) -> bool:
    """Whether an activity stamp advanced. Stamps of the same kind compare by instant; otherwise
    any change between two present stamps counts, because the host mixes naive and offset-aware
    text in one field."""
    if then == now or not (_is_stamp(then) and _is_stamp(now)):
        return False
    a, b = _instant(then), _instant(now)
    if a is not None and b is not None and a[1] == b[1]:
        return b[0] > a[0]
    return True


def json_type_name(value: object) -> str:
    """The JSON type name of a value: str, number, bool, null, list or object."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int | float):
        return "number"
    if isinstance(value, str):
        return "str"
    return "list" if isinstance(value, list | tuple) else "object"


def diff_slots(prev: dict[str, Row], curr: dict[str, Row], *, at: str) -> list[Signal]:
    """Signals between two snapshots of the probe rows, from confirmed projection fields only.

    start: `running` false to true. progress: still `running` and `last_activity_ts` moved.
    terminal: `running` true to false. approval: `pending_approval` turned truthy.
    needs-input: `needs_input` turned truthy. removed: the slot left the snapshot.
    """
    signals: list[Signal] = []
    for key in sorted(curr):
        row = curr[key]
        before = prev.get(key, {})
        was_running = bool(before.get("running"))
        is_running = bool(row.get("running"))
        if is_running and not was_running:
            signals.append(Signal("start", key, at))
        elif is_running:
            if _moved(before.get("last_activity_ts"), row.get("last_activity_ts")):
                signals.append(Signal("progress", key, at))
        elif was_running:
            signals.append(Signal("terminal", key, at))
        if row.get("pending_approval") and not before.get("pending_approval"):
            signals.append(Signal("approval", key, at))
        if row.get("needs_input") and not before.get("needs_input"):
            signals.append(Signal("needs-input", key, at))
    signals.extend(Signal("removed", key, at) for key in sorted(set(prev) - set(curr)))
    return signals


def outcome_evidence(row: Row) -> str | None:
    """The literal `wait_state` text, else the last message text, else None (renders unknown)."""
    for name in ("wait_state", "last_message"):
        text = _text(row, name).strip()
        if text:
            return _VERDICT_STEM.sub(VERDICT_MASK, text)[:MAX_EVIDENCE_CHARS]
    return None
