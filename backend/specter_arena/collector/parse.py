from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import cast

from ..store import DmKey
from .identity import bot_dm_key, is_store_less_key, ref_key_ok, slot_key_ok
from .vocabulary import LIMITS

MAX_SLOT_ROWS = 2_000
MAX_SMALL_INT = 2**31 - 1
MAX_TOKEN_COUNT = 10**12

Fact = bool | int | str

_TYPE_PEEK = re.compile(r'\{\s*"type"\s*:\s*"([a-z][a-z0-9_]{0,63})"')
_HEX_GEN = re.compile(r"[0-9a-f]{1,16}")
_WORD = re.compile(r"[a-z][a-z0-9_-]{0,47}")
_TOOL_CALL_ID = re.compile(r"[A-Za-z0-9._:-]{1,128}")
_EPOCH_UTC = datetime(1970, 1, 1, tzinfo=UTC)
_ONE_MS = timedelta(milliseconds=1)


def _is_bool(value: object) -> bool:
    return isinstance(value, bool)


def _is_int(value: object, maximum: int) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= maximum


def _is_small_int(value: object) -> bool:
    return _is_int(value, MAX_SMALL_INT)


def _is_token_count(value: object) -> bool:
    return _is_int(value, MAX_TOKEN_COUNT)


def _is_hex_gen(value: object) -> bool:
    return isinstance(value, str) and _HEX_GEN.fullmatch(value) is not None


def _is_word(value: object) -> bool:
    return isinstance(value, str) and _WORD.fullmatch(value) is not None


def _is_tool_call_id(value: object) -> bool:
    return isinstance(value, str) and _TOOL_CALL_ID.fullmatch(value) is not None


# Crew field -> (wire name, validator). Anything not listed is dropped before queueing, logging
# or hashing. Never copied: title, messages, last_message, prompt_preview, welcome_message,
# options, todo, mcp_report, source_links, workspace, project, tags, attribution,
# pending_approval_info and every slack_* field.
ROW_FACTS: dict[str, tuple[str, Callable[[object], bool]]] = {
    "running": ("running", _is_bool),
    "turn": ("turn", _is_small_int),
    "turn_gen": ("turnGen", _is_hex_gen),
    "mode": ("slotMode", _is_word),
    "origin": ("slotOrigin", _is_word),
    "lineage_minted": ("lineageMinted", _is_bool),
    "pending_approval": ("pendingApproval", _is_bool),
    "needs_input": ("needsInput", _is_bool),
    "has_options": ("hasOptions", _is_bool),
    "waiting_for_input": ("waitingForInput", _is_bool),
    "interrupted": ("interrupted", _is_bool),
    "stopping": ("stopping", _is_bool),
    "admission_queued": ("admissionQueued", _is_bool),
    "queue_depth": ("queueDepth", _is_small_int),
    "compacting": ("compacting", _is_bool),
    "subagents_running": ("subagentsRunning", _is_small_int),
    "subagents_queued": ("subagentsQueued", _is_small_int),
    "stop_state": ("stopState", _is_word),
}

SLOT_ROW_KEYS = frozenset(
    {name for name, _ in ROW_FACTS.values()}
    | {"createdBy", "parentKey", "waitStatePresent", "lastActivityMs", "createdMs"}
)

# Event type -> (Crew `data` key, wire payload key, validator).
EVENT_FIELDS: dict[str, tuple[tuple[str, str, Callable[[object], bool]], ...]] = {
    "chat_done": (
        ("continuing", "continuing", _is_bool),
        ("needs_input", "needsInput", _is_bool),
    ),
    "tool_call": (("is_shell", "isShell", _is_bool),),
    "tool_result": (),
    "context_usage": (
        ("used_tokens", "usedTokens", _is_token_count),
        ("window_tokens", "windowTokens", _is_token_count),
    ),
    "chat_status": (),
}

EVENT_PAYLOAD_KEYS: dict[str, frozenset[str]] = {
    event_type: frozenset(wire for _, wire, _ in fields)
    for event_type, fields in EVENT_FIELDS.items()
}


@dataclass(frozen=True)
class RowFact:
    slot_key: str
    dm: DmKey | None
    created_by: str | None
    source_time_ms: int | None
    turn: int | None
    turn_gen: str | None
    facts: Mapping[str, Fact]
    fact_digest: str
    nulled: int = 0


@dataclass(frozen=True)
class SlotsParse:
    partial: bool
    bots: tuple[RowFact, ...]
    workers: tuple[RowFact, ...]
    store_less: tuple[str, ...]
    rejected: tuple[str, ...]
    other_rows: int
    frame_reason: str | None = None


@dataclass(frozen=True)
class EventParse:
    event_type: str
    slot_key: str
    turn: int | None
    turn_gen: str | None
    tool_call_id: str | None
    dedup_key: str | None
    payload: Mapping[str, Fact]
    nulled: int = 0


def _refuse_constant(_name: str) -> object:
    raise ValueError("non-finite number")


def load_frame(raw: object) -> tuple[dict[str, object] | None, str | None]:
    """Parse one socket message. Returns the frame or a reason code, never raises."""
    if not isinstance(raw, str):
        return None, "malformed-frame"
    if len(raw) > LIMITS.ws_max_size:
        return None, "oversize-frame"
    try:
        loaded = json.loads(raw, parse_constant=_refuse_constant)
    except (ValueError, RecursionError):
        return None, "malformed-frame"
    if not isinstance(loaded, dict) or not isinstance(loaded.get("type"), str):
        return None, "malformed-frame"
    return loaded, None


def peek_type(raw: str) -> str | None:
    """The frame type from the leading characters, without a JSON parse.

    None when `type` is not the first key; the caller then parses fully.
    """
    match = _TYPE_PEEK.match(raw[: LIMITS.frame_peek_chars + 16])
    return match.group(1) if match else None


def raw_within_cap(raw: str) -> bool:
    """Whether the raw text of one per-bot event frame is under the 64 KiB pre-parse cap."""
    return len(raw) <= LIMITS.raw_frame_max_chars


def aware_ms(value: object) -> int | None:
    """Epoch milliseconds for an aware ISO-8601 string; None for anything else.

    A naive, numeric or unparsable value is None, so a clock-less stamp is never compared.
    """
    if not isinstance(value, str):
        return None
    try:
        moment = datetime.fromisoformat(value)
        if moment.tzinfo is None or moment.utcoffset() is None:
            return None
        milliseconds = (moment - _EPOCH_UTC) // _ONE_MS
    except (ValueError, OverflowError):
        return None
    return milliseconds if 0 <= milliseconds <= 2**53 else None


def _canonical(facts: Mapping[str, Fact]) -> str:
    return json.dumps(facts, sort_keys=True, separators=(",", ":"))


def fact_digest(facts: Mapping[str, Fact]) -> str:
    """sha256 of the canonical facts without `lastActivityMs`, so activity alone is no change."""
    stable = {name: value for name, value in facts.items() if name != "lastActivityMs"}
    return hashlib.sha256(_canonical(stable).encode()).hexdigest()


def _raw_row_chars(row: Mapping[str, object]) -> int | None:
    try:
        return len(json.dumps(row, separators=(",", ":")))
    except (ValueError, RecursionError, TypeError):
        return None


def _row_facts(row: Mapping[str, object], *, worker: bool) -> tuple[dict[str, Fact], int] | None:
    """The allow-listed facts of a row, or None when a required fact is missing or mistyped."""
    if not _is_bool(row.get("running")):
        return None
    facts: dict[str, Fact] = {}
    nulled = 0
    for crew_name, (wire_name, valid) in ROW_FACTS.items():
        if crew_name not in row:
            continue
        value = row[crew_name]
        if valid(value):
            facts[wire_name] = cast(Fact, value)
        elif value is not None and value != "":
            nulled += 1
    if worker and ref_key_ok(row.get("created_by")):
        facts["createdBy"] = cast(str, row["created_by"])
    parent = row.get("parent")
    if isinstance(parent, dict) and ref_key_ok(parent.get("key")):
        facts["parentKey"] = parent["key"]
    if "wait_state" in row:
        facts["waitStatePresent"] = row["wait_state"] is not None
    for crew_name, wire_name in (("last_activity_ts", "lastActivityMs"), ("created", "createdMs")):
        stamp = aware_ms(row.get(crew_name))
        if stamp is not None:
            facts[wire_name] = stamp
    return facts, nulled


def _build_row(row: Mapping[str, object], dm: DmKey | None, *, worker: bool) -> RowFact | str:
    """A RowFact, or a reject reason code."""
    chars = _raw_row_chars(row)
    if chars is None:
        return "bad-row"
    if chars > LIMITS.raw_frame_max_chars:
        return "oversize-frame"
    built = _row_facts(row, worker=worker)
    if built is None:
        return "bad-row"
    facts, nulled = built
    if len(_canonical(facts).encode()) > LIMITS.payload_max_bytes:
        return "oversize"
    turn = facts.get("turn")
    turn_gen = facts.get("turnGen")
    source_time = facts.get("lastActivityMs")
    created_by = facts.get("createdBy")
    return RowFact(
        slot_key=str(row["key"]),
        dm=dm,
        created_by=created_by if isinstance(created_by, str) else None,
        source_time_ms=source_time if isinstance(source_time, int) else None,
        turn=turn if isinstance(turn, int) else None,
        turn_gen=turn_gen if isinstance(turn_gen, str) else None,
        facts=facts,
        fact_digest=fact_digest(facts),
        nulled=nulled,
    )


def _empty_slots(*, partial: bool, reason: str) -> SlotsParse:
    return SlotsParse(partial, (), (), (), (), 0, frame_reason=reason)


def _sha12(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:12]


def parse_slots(frame: Mapping[str, object], bound_keys: frozenset[str]) -> SlotsParse:
    """Reduce a `slots` frame to bot rows, attributed worker rows and counts.

    `bound_keys` holds the DM keys already bound; a worker is attributed only when its
    `created_by` equals one of them, or a bot row of this frame, exactly.
    """
    partial = frame.get("slotsPartial") is True
    data = frame.get("data")
    if not isinstance(data, list) or len(data) > MAX_SLOT_ROWS:
        return _empty_slots(partial=partial, reason="schema-mismatch")

    bots: list[RowFact] = []
    workers: list[RowFact] = []
    rejected: list[str] = []
    store_less: dict[str, None] = {}
    other_rows = 0
    bot_keys: set[str] = set()
    pending: list[Mapping[str, object]] = []

    for row in data:
        if not isinstance(row, dict):
            other_rows += 1
            continue
        key = row.get("key")
        dm = bot_dm_key(key)
        if isinstance(key, str) and dm is not None and row.get("mode") == "member":
            built = _build_row(row, dm, worker=False)
            if isinstance(built, str):
                rejected.append(built)
            else:
                bots.append(built)
                bot_keys.add(key)
            continue
        if isinstance(key, str) and dm is None and is_store_less_key(key):
            store_less[_sha12(key)] = None
            continue
        pending.append(row)

    known = bound_keys | bot_keys
    for row in pending:
        creator = row.get("created_by")
        if row.get("origin") != "user" or not isinstance(creator, str) or creator not in known:
            other_rows += 1
            continue
        if not slot_key_ok(row.get("key")):
            rejected.append("bad-worker-key")
            continue
        built = _build_row(row, None, worker=True)
        if isinstance(built, str):
            rejected.append(built)
        else:
            workers.append(built)

    return SlotsParse(
        partial=partial,
        bots=tuple(bots),
        workers=tuple(workers),
        store_less=tuple(store_less),
        rejected=tuple(rejected),
        other_rows=other_rows,
    )


def _dedup_key(event_type: str, slot_key: str, *parts: object) -> str | None:
    if any(part is None for part in parts):
        return None
    return ":".join([event_type, slot_key, *(str(part) for part in parts)])


def parse_event(event_type: str, frame: Mapping[str, object]) -> EventParse | str:
    """Reduce one per-bot event frame to its allow-listed payload; a str is a reason code."""
    fields = EVENT_FIELDS.get(event_type)
    if fields is None:
        return "unknown-event-type"
    data = frame.get("data")
    if not isinstance(data, dict):
        return "schema-mismatch"
    slot_key = data.get("slot")
    if not isinstance(slot_key, str) or not ref_key_ok(slot_key):
        return "schema-mismatch"

    payload: dict[str, Fact] = {}
    nulled = 0
    for crew_name, wire_name, valid in fields:
        if crew_name not in data:
            continue
        value = data[crew_name]
        if valid(value):
            payload[wire_name] = value
        else:
            nulled += 1

    turn: int | None = None
    turn_gen: str | None = None
    tool_call_id: str | None = None
    dedup: str | None = None
    if event_type == "chat_done":
        raw_turn, raw_gen = data.get("turn"), data.get("turn_gen")
        turn = raw_turn if _is_small_int(raw_turn) else None
        turn_gen = raw_gen if _is_hex_gen(raw_gen) else None
        dedup = _dedup_key(event_type, slot_key, turn_gen, turn)
    elif event_type in ("tool_call", "tool_result"):
        raw_id = data.get("tool_call_id")
        tool_call_id = raw_id if _is_tool_call_id(raw_id) else None
        dedup = _dedup_key(event_type, slot_key, tool_call_id)

    return EventParse(
        event_type=event_type,
        slot_key=slot_key,
        turn=turn,
        turn_gen=turn_gen,
        tool_call_id=tool_call_id,
        dedup_key=dedup,
        payload=payload,
        nulled=nulled,
    )
