from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping

from .dmkey import is_member_id, is_memory_store, parse_dm_key
from .records import (
    COVERAGE_REASONS,
    EVENT_PAYLOAD_KEYS,
    EVENT_TYPES,
    MAX_COUNT,
    MAX_JSON_INT,
    MAX_NAME_CHARS,
    MAX_PAYLOAD_BYTES,
    MAX_PAYLOAD_VALUE_CHARS,
    MAX_ROSTER_ROWS,
    MAX_SLOT_KEY_CHARS,
    OBSERVATION_SOURCE,
    ORIGINS,
    ROW_EVENT_TYPE,
    ROW_FACT_KEYS,
    ROW_REQUIRED_KEYS,
    BindingSeen,
    CoverageMark,
    ObservationIn,
    QuarantineIn,
    RosterPoll,
    RosterRowIn,
)

AVATAR_KIND_PATTERN = r"[a-z][a-z0-9_-]{0,31}"
AVATAR_REF_PATTERN = r"[A-Za-z0-9._-]{1,128}"
ROSTER_REASON_PATTERN = r"[a-z][a-z0-9-]{0,39}"

_AVATAR_KIND = re.compile(AVATAR_KIND_PATTERN)
_AVATAR_REF = re.compile(AVATAR_REF_PATTERN)
_ROSTER_REASON = re.compile(ROSTER_REASON_PATTERN)
_TOKEN = re.compile(r"[A-Za-z0-9._-]{1,128}")
_HEX_GEN = re.compile(r"[0-9a-f]{1,16}")
_FACT_DIGEST = re.compile(r"[0-9a-f]{64}")
_QUARANTINE_REASON = re.compile(r"[a-z][a-z0-9-]{0,39}")
_FRAME_TYPE = re.compile(r"[a-z][a-z0-9_]{0,63}")
_QUARANTINE_DIGEST = re.compile(r"sha256:[0-9a-f]{12}")
_DROPPED_KEY = re.compile(r"[a-z][a-z0-9-]{0,23}")
_RUN_ID = re.compile(r"[A-Za-z0-9-]{8,64}")

MAX_TOOL_CALL_ID_CHARS = 128
MAX_DEDUP_KEY_CHARS = 512
MAX_DROPPED_KEYS = 8
INVALID_FRAME_TYPE = "invalid"


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


def is_run_id(value: object) -> bool:
    return isinstance(value, str) and _RUN_ID.fullmatch(value) is not None


def _is_int(value: object, upper: int = MAX_JSON_INT) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= upper


def _fact_ok(kind: str, value: object) -> bool:
    if kind == "bool":
        return isinstance(value, bool)
    if kind == "int":
        return _is_int(value)
    if not isinstance(value, str):
        return False
    if kind == "token":
        return _TOKEN.fullmatch(value) is not None
    if kind == "hex":
        return _HEX_GEN.fullmatch(value) is not None
    if kind == "slot":
        return 1 <= len(value) <= MAX_SLOT_KEY_CHARS
    return False


def row_fact_digest(payload: Mapping[str, object]) -> str:
    """sha256 hex of the canonical JSON of the payload keys, excluding `lastActivityMs`.

    Canonical JSON is sorted keys, `(",", ":")` separators and UTF-8 without ASCII escaping. The
    collector computes the same value; the store recomputes it and rejects a mismatch.
    """
    facts = {key: value for key, value in payload.items() if key != "lastActivityMs"}
    text = json.dumps(facts, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def canonical_payload(payload: Mapping[str, object]) -> str:
    return json.dumps(dict(payload), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _payload_reason(item: ObservationIn) -> str | None:
    payload = item.payload
    if not isinstance(payload, Mapping) or not all(isinstance(key, str) for key in payload):
        return "payload-shape"
    try:
        size = len(canonical_payload(payload).encode("utf-8"))
    except (TypeError, ValueError):
        return "payload-shape"
    if size > MAX_PAYLOAD_BYTES:
        return "payload-too-large"
    allowed = ROW_FACT_KEYS if item.kind == "row-change" else EVENT_PAYLOAD_KEYS[item.event_type]
    if not set(payload) <= set(allowed):
        return "payload-shape"
    if item.kind == "row-change" and not set(payload) >= ROW_REQUIRED_KEYS:
        return "payload-shape"
    for key, value in payload.items():
        if not _fact_ok(allowed[key], value):
            return "payload-shape"
        if (
            isinstance(value, str)
            and allowed[key] != "slot"
            and len(value) > MAX_PAYLOAD_VALUE_CHARS
        ):
            return "payload-shape"
    if item.kind == "row-change":
        if "turn" in payload and payload["turn"] != item.turn:
            return "payload-shape"
        if "turnGen" in payload and payload["turnGen"] != item.turn_gen:
            return "payload-shape"
    return None


def _observation_fields_reason(item: ObservationIn) -> str | None:
    if item.origin not in ORIGINS:
        return "bad-origin"
    if item.source != OBSERVATION_SOURCE or item.contract_version != 1:
        return "bad-field"
    if item.kind not in ("row-change", "event"):
        return "bad-field"
    if not isinstance(item.dm_key, str) or parse_dm_key(item.dm_key) is None:
        return "bad-dm-key"
    if not isinstance(item.slot_key, str) or not 1 <= len(item.slot_key) <= MAX_SLOT_KEY_CHARS:
        return "bad-field"
    if not isinstance(item.event_type, str):
        return "bad-field"
    if not is_time_ms(item.received_at_ms) or not _optional_time_ms(item.source_time_ms):
        return "bad-field"
    if item.turn is not None and not _is_int(item.turn):
        return "bad-field"
    if item.turn_gen is not None and (
        not isinstance(item.turn_gen, str) or _HEX_GEN.fullmatch(item.turn_gen) is None
    ):
        return "bad-field"
    if item.tool_call_id is not None and (
        not isinstance(item.tool_call_id, str)
        or not 1 <= len(item.tool_call_id) <= MAX_TOOL_CALL_ID_CHARS
    ):
        return "bad-field"
    if item.binding_id is not None and not isinstance(item.binding_id, str):
        return "bad-field"
    return None


def _dedup_reason(item: ObservationIn) -> str | None:
    if item.kind == "row-change":
        if item.dedup_key is not None:
            return "bad-dedup"
        digest = item.fact_digest
        if not isinstance(digest, str) or _FACT_DIGEST.fullmatch(digest) is None:
            return "bad-dedup"
        return "bad-dedup" if digest != row_fact_digest(item.payload) else None
    if item.fact_digest is not None:
        return "bad-dedup"
    key = item.dedup_key
    if key is not None and (not isinstance(key, str) or not 1 <= len(key) <= MAX_DEDUP_KEY_CHARS):
        return "bad-dedup"
    return None


def observation_reason(item: ObservationIn, installation_id: str) -> str | None:
    """The reject reason for one observation, or None. Pure: no SQL, no clock."""
    if item.installation_id != installation_id:
        return "wrong-installation"
    reason = _observation_fields_reason(item)
    if reason is not None:
        return reason
    if item.kind == "row-change":
        if item.event_type != ROW_EVENT_TYPE:
            return "unknown-event-type"
    elif item.event_type not in EVENT_TYPES:
        return "unknown-event-type"
    reason = _payload_reason(item) or _dedup_reason(item)
    if reason is not None:
        return reason
    is_worker_row = item.kind == "row-change" and item.slot_key != item.dm_key
    if is_worker_row and item.payload.get("createdBy") != item.dm_key:
        return "worker-not-attributable"
    return None


def quarantine_frame_type(value: object) -> str:
    if isinstance(value, str) and _FRAME_TYPE.fullmatch(value) is not None:
        return value
    return INVALID_FRAME_TYPE


def quarantine_reason(item: QuarantineIn) -> str | None:
    if not is_time_ms(item.received_at_ms):
        return "bad-field"
    if not isinstance(item.reason, str) or _QUARANTINE_REASON.fullmatch(item.reason) is None:
        return "bad-field"
    if not _is_int(item.size_bytes, MAX_COUNT) or not _is_int(item.count, MAX_COUNT):
        return "bad-field"
    if item.count < 1:
        return "bad-field"
    if item.digest is not None and (
        not isinstance(item.digest, str) or _QUARANTINE_DIGEST.fullmatch(item.digest) is None
    ):
        return "bad-field"
    first = item.first_received_at_ms
    if first is not None and (not is_time_ms(first) or first > item.received_at_ms):
        return "bad-field"
    return None


def _dropped_ok(dropped: object) -> bool:
    if not isinstance(dropped, Mapping) or len(dropped) > MAX_DROPPED_KEYS:
        return False
    return all(
        isinstance(key, str)
        and _DROPPED_KEY.fullmatch(key) is not None
        and _is_int(value, MAX_COUNT)
        for key, value in dropped.items()
    )


def coverage_mark_reason(item: CoverageMark) -> str | None:
    if item.action not in ("open-covered", "close", "gap"):
        return "bad-field"
    if not is_time_ms(item.at_ms):
        return "bad-field"
    if item.action != "open-covered" and (
        not isinstance(item.reason, str) or item.reason not in COVERAGE_REASONS
    ):
        return "bad-reason"
    if not _dropped_ok(item.dropped):
        return "bad-coverage-mark"
    if item.from_ms is not None and (
        item.action != "gap" or not is_time_ms(item.from_ms) or item.from_ms > item.at_ms
    ):
        return "bad-coverage-mark"
    for edge in (item.source_from_ms, item.source_to_ms):
        if not _optional_time_ms(edge):
            return "bad-coverage-mark"
    if (
        item.source_from_ms is not None
        and item.source_to_ms is not None
        and item.source_from_ms > item.source_to_ms
    ):
        return "bad-coverage-mark"
    return None
