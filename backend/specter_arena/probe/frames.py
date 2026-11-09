# SPECTER-DIAGNOSTIC-ONLY
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

MARKER = "SPECTER-DIAGNOSTIC-ONLY"

MAX_LINEAGE_DEPTH = 8
MAX_EVIDENCE_CHARS = 500

SignalKind = Literal["start", "progress", "terminal", "approval", "needs-input", "removed"]
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


def probe_keys(rows: list[Row], probe_slug: str) -> set[str]:
    """The probe bot's DM slot plus every slot whose `created_by` chain reaches it.

    Walks at most MAX_LINEAGE_DEPTH levels. Growth is monotonic, so a cycle in `created_by`
    ends the walk instead of looping.
    """
    if not probe_slug:
        return set()
    keys = {f"member-{probe_slug}"} & {_text(row, "key") for row in rows}
    for _ in range(MAX_LINEAGE_DEPTH):
        grown = {
            _text(row, "key")
            for row in rows
            if _text(row, "key") and _text(row, "created_by") in keys
        }
        if grown <= keys:
            break
        keys |= grown
    return keys


def slot_role(row: Row, probe_slug: str) -> SlotRole:
    if probe_slug and _text(row, "key") == f"member-{probe_slug}":
        return "bot-dm"
    return "worker" if _text(row, "created_by") else "other"


def _number(value: object) -> float | None:
    return float(value) if isinstance(value, int | float) and not isinstance(value, bool) else None


def diff_slots(prev: dict[str, Row], curr: dict[str, Row], *, at: str) -> list[Signal]:
    """Signals between two snapshots of the probe rows, from confirmed projection fields only.

    start: `running` false to true. progress: still `running` and `last_activity_ts` advanced.
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
            then, now = (
                _number(before.get("last_activity_ts")),
                _number(row.get("last_activity_ts")),
            )
            if then is not None and now is not None and now > then:
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
