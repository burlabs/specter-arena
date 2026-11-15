# SPECTER-DIAGNOSTIC-ONLY
from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass, field

from .events import ENUM_FIELDS, EVENT_FIELDS, EVENT_VOCABULARY
from .frames import probe_keys, slot_rows

MARKER = "SPECTER-DIAGNOSTIC-ONLY"

# Keys whose string value is an identifier: kept comparable across rows as a salted digest.
ID_FIELDS = frozenset(
    {
        "key",
        "created_by",
        "folder_id",
        "linked_session_key",
        "forked_from",
        "instance_id",
        "session_id",
        "id",
        "batch_id",
        "child_session",
        "tool_call_id",
        "instance",
    }
)

# Prose a probe slot row carries; dropped before the row is retained.
DROPPED_ROW_FIELDS = frozenset(
    {"messages", "last_message", "prompt_preview", "welcome_message", "options"}
)

MAX_DEPTH = 32
MAX_FRAME_BYTES = 1024 * 1024
REDACTED_TEXT = "[redacted]"
SANITISED_PATTERN = r"^(sha256:[0-9a-f]{12}|<redacted type=(str|list|object) len=\d+>)$"

_TYPE_NAME = re.compile(r"[a-z][a-z0-9_.:-]{0,39}")
_ENUM_WORD = re.compile(r"[a-z][a-z0-9_-]{0,31}")

_SECRET_PATTERNS = (
    re.compile(r"(?i)\bbearer\s+[\w.~+/=-]{8,}"),
    re.compile(r"(?i)(x-app-secret|x-kirocrew-proxy[\w-]*)\s*[:=]\s*\S+"),
    re.compile(r"(?i)\bmc_token\w*\s*[:=]\s*[^\s;,]+"),
    re.compile(r"(?i)([?&]|\b)(access_)?token=[^\s&\"']+"),
    re.compile(r"(?i)\b(secret|password|api[_-]?key)\s*[:=]\s*\S+"),
    re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    re.compile(r"\b[0-9a-fA-F]{32,}\b"),
)


@dataclass
class SanitiseStats:
    """Counters a run keeps for what the sanitiser refused; no frame content is held here."""

    dropped: int = 0
    unknown_types: dict[str, int] = field(default_factory=dict)

    def count_unknown(self, frame_type: str) -> None:
        self.unknown_types[frame_type] = self.unknown_types.get(frame_type, 0) + 1


def redact_text(text: str) -> str:
    """Probe rows only: strip credential-shaped text and keep the rest."""
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub(REDACTED_TEXT, text)
    return text


def digest(salt: bytes, value: str) -> str:
    return "sha256:" + hashlib.sha256(salt + value.encode()).hexdigest()[:12]


def placeholder(value: object) -> str:
    if isinstance(value, str):
        return f"<redacted type=str len={len(value)}>"
    if isinstance(value, list | tuple):
        return f"<redacted type=list len={len(value)}>"
    if isinstance(value, dict):
        return f"<redacted type=object len={len(value)}>"
    raise TypeError(f"no placeholder for {type(value).__name__}")


def sanitise_value(value: object, salt: bytes, *, key: str | None = None, depth: int = 0) -> object:
    """Reduce a non-probe value to the FD-22 grammar. Raises for anything it cannot classify."""
    if depth > MAX_DEPTH:
        raise ValueError("value nested too deeply")
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("non-finite number")
        return value
    if isinstance(value, str):
        return digest(salt, value) if key in ID_FIELDS else placeholder(value)
    if isinstance(value, dict):
        return {
            str(child_key): sanitise_value(child, salt, key=str(child_key), depth=depth + 1)
            for child_key, child in value.items()
        }
    return placeholder(value)


def _redact_probe_value(value: object, depth: int = 0) -> object:
    if depth > MAX_DEPTH:
        raise ValueError("value nested too deeply")
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, dict):
        return {str(key): _redact_probe_value(child, depth + 1) for key, child in value.items()}
    if isinstance(value, list | tuple):
        return [_redact_probe_value(child, depth + 1) for child in value]
    if value is None or isinstance(value, bool | int):
        return value
    if isinstance(value, float) and math.isfinite(value):
        return value
    raise ValueError(f"unsupported value type {type(value).__name__}")


def sanitise_slot_row(row: dict[str, object], *, is_probe: bool, salt: bytes) -> dict[str, object]:
    """Probe rows keep their values after redaction, minus their prose fields; every other row
    keeps shape only."""
    if not isinstance(row, dict):
        raise TypeError("slot row must be an object")
    if is_probe:
        kept = {key: value for key, value in row.items() if key not in DROPPED_ROW_FIELDS}
        redacted = _redact_probe_value(kept)
        assert isinstance(redacted, dict)
        return redacted
    sanitised = sanitise_value(row, salt)
    assert isinstance(sanitised, dict)
    return sanitised


def _event_value(name: str, value: object, *, is_probe: bool, salt: bytes) -> object:
    if value is None or isinstance(value, bool | int):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("non-finite number")
        return value
    if isinstance(value, str):
        if name == "slot" and is_probe:
            return value
        if name == "slot" or name in ID_FIELDS:
            return digest(salt, value)
        if is_probe and name in ENUM_FIELDS and _ENUM_WORD.fullmatch(value):
            return value
    return placeholder(value)


def reduce_event(
    event_type: str, data: object, probe_slots: frozenset[str], salt: bytes
) -> dict[str, object]:
    """The allow-listed keys of an event's `data`, never any other key.

    A probe-slot event keeps its `slot` text and short enum words; every other string becomes a
    digest (identifiers) or a placeholder, whatever slot it belongs to. Nested values keep shape
    only.
    """
    if not isinstance(data, dict):
        return {}
    slot = data.get("slot")
    is_probe = isinstance(slot, str) and slot in probe_slots
    allowed = EVENT_FIELDS.get(event_type, frozenset())
    return {
        name: _event_value(name, data[name], is_probe=is_probe, salt=salt)
        for name in sorted(allowed)
        if name in data
    }


def sanitise_frame(
    frame: dict[str, object],
    probe_slug: str,
    salt: bytes,
    stats: SanitiseStats,
    probe_slots: frozenset[str] = frozenset(),
) -> dict[str, object] | None:
    """Sanitise one gateway frame. Fails closed: any error drops the frame and counts it.

    `probe_slots` is the probe key set from the latest `slots` frame; event frames need it
    because they carry a slot key but no lineage.
    """
    try:
        if len(json.dumps(frame)) > MAX_FRAME_BYTES:
            raise ValueError("frame too large")
        frame_type = frame.get("type")
        if frame_type != "slots":
            label = frame_type if isinstance(frame_type, str) else ""
            label = label if _TYPE_NAME.fullmatch(label) else "invalid"
            if label in EVENT_FIELDS:
                return {
                    "type": label,
                    "data": reduce_event(label, frame.get("data"), probe_slots, salt),
                }
            if label not in EVENT_VOCABULARY:
                stats.count_unknown(label)
            return {"type": label}
        data = frame.get("data")
        rows = slot_rows(frame)
        if not isinstance(data, list) or len(rows) != len(data):
            raise ValueError("slots frame holds a row that is not an object")
        probes = probe_keys(rows, probe_slug)
        sanitised = [
            sanitise_slot_row(row, is_probe=row.get("key") in probes, salt=salt) for row in rows
        ]
        return {"type": "slots", "data": sanitised}
    except Exception:
        stats.dropped += 1
        return None
