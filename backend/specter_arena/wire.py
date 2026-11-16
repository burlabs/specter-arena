from __future__ import annotations

import math
import re
from collections.abc import Callable
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .store import BindingRecord, ObservationIn, QuarantineRecord

MAX_JSON_INT = 9_007_199_254_740_991
CONTRACT_VERSION = 1

ROW_FACT_KEYS = frozenset(
    {
        "running",
        "slotMode",
        "slotOrigin",
        "turn",
        "turnGen",
        "lastActivityMs",
        "createdMs",
        "createdBy",
        "lineageMinted",
        "parentKey",
        "pendingApproval",
        "needsInput",
        "hasOptions",
        "waitingForInput",
        "interrupted",
        "stopping",
        "admissionQueued",
        "queueDepth",
        "compacting",
        "subagentsRunning",
        "subagentsQueued",
        "waitStatePresent",
        "stopState",
    }
)

EVENT_PAYLOAD_KEYS: dict[str, frozenset[str]] = {
    "chat_done": frozenset({"continuing", "needsInput"}),
    "tool_call": frozenset({"isShell"}),
    "tool_result": frozenset(),
    "context_usage": frozenset({"usedTokens", "windowTokens"}),
    "chat_status": frozenset(),
}

_BINDING_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
_DEDUP_KEY = re.compile(r"[A-Za-z0-9:._=-]{1,512}")
_DIGEST = re.compile(r"[0-9a-f]{64}")
_SLOT_KEY = re.compile(r"[A-Za-z0-9_.:-]{1,256}")
_TOOL_CALL_ID = re.compile(r"[A-Za-z0-9_.:-]{1,200}")
_TOKEN = re.compile(r"[a-z][a-z0-9_-]{0,47}")
_TURN_GEN = re.compile(r"[0-9a-f]{1,16}")
_AVATAR_KIND = re.compile(r"[a-z][a-z0-9_-]{0,31}")
_AVATAR_REF = re.compile(r"[A-Za-z0-9._-]{1,128}")
_REASON = re.compile(r"[a-z][a-z0-9-]{0,63}")
_STATE = re.compile(r"[a-z][a-z0-9-]{0,47}")
_CURSOR = re.compile(r"[A-Za-z0-9_-]+")
_MEMBER_ID = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?")
_MEMORY_STORE = re.compile(r"[A-Za-z0-9_-]{1,200}")
_FRAME_TYPE = re.compile(r"[a-z][a-z0-9_]{0,63}")
_QUARANTINE_DIGEST = re.compile(r"sha256:[0-9a-f]{12}")

_SIGNAL_KEYS = ("needsInput", "hasOptions", "pendingApproval", "waitingForInput")


class ContractViolation(ValueError):
    """The only exception a reader raises for bad input."""


def _fail(where: str, why: str) -> ContractViolation:
    return ContractViolation(f"{where}: {why}")


def _object(
    value: object, where: str, required: frozenset[str], optional: frozenset[str]
) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise _fail(where, "not an object")
    keys = set(value)
    if not required <= keys:
        raise _fail(where, "missing required property")
    if not keys <= required | optional:
        raise _fail(where, "unexpected property")
    return value


def _integer(value: object, where: str, low: int = 0, high: int = MAX_JSON_INT) -> int:
    """An integer, or a float that is a whole finite number (JSON Schema `integer`)."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise _fail(where, "not an integer")
    if isinstance(value, float):
        if not math.isfinite(value) or not value.is_integer():
            raise _fail(where, "not an integer")
        value = int(value)
    if not low <= value <= high:
        raise _fail(where, "integer out of range")
    return value


def _nullable_integer(value: object, where: str, high: int = MAX_JSON_INT) -> int | None:
    return None if value is None else _integer(value, where, 0, high)


def _boolean(value: object, where: str) -> bool:
    if not isinstance(value, bool):
        raise _fail(where, "not a boolean")
    return value


def _nullable_boolean(value: object, where: str) -> bool | None:
    return None if value is None else _boolean(value, where)


def _text(value: object, where: str, pattern: re.Pattern[str]) -> str:
    if not isinstance(value, str) or pattern.fullmatch(value) is None:
        raise _fail(where, "string does not match its pattern")
    return value


def _nullable_text(value: object, where: str, pattern: re.Pattern[str]) -> str | None:
    return None if value is None else _text(value, where, pattern)


def _const(value: object, where: str, expected: int | str) -> None:
    if isinstance(expected, int):
        if _integer(value, where) != expected:
            raise _fail(where, "wrong constant")
    elif value != expected:
        raise _fail(where, "wrong constant")


def _one_of(value: object, where: str, allowed: tuple[str, ...]) -> str:
    if not isinstance(value, str) or value not in allowed:
        raise _fail(where, "not an allowed value")
    return value


_ROW_FACT_CHECKS: dict[str, Callable[[object, str], object]] = {
    "running": _boolean,
    "slotMode": lambda v, w: _text(v, w, _TOKEN),
    "slotOrigin": lambda v, w: _text(v, w, _TOKEN),
    "turn": lambda v, w: _integer(v, w),
    "turnGen": lambda v, w: _text(v, w, _TURN_GEN),
    "lastActivityMs": lambda v, w: _integer(v, w),
    "createdMs": lambda v, w: _integer(v, w),
    "createdBy": lambda v, w: _text(v, w, _SLOT_KEY),
    "lineageMinted": _boolean,
    "parentKey": lambda v, w: _text(v, w, _SLOT_KEY),
    "pendingApproval": _boolean,
    "needsInput": _boolean,
    "hasOptions": _boolean,
    "waitingForInput": _boolean,
    "interrupted": _boolean,
    "stopping": _boolean,
    "admissionQueued": _boolean,
    "queueDepth": lambda v, w: _integer(v, w),
    "compacting": _boolean,
    "subagentsRunning": lambda v, w: _integer(v, w),
    "subagentsQueued": lambda v, w: _integer(v, w),
    "waitStatePresent": _boolean,
    "stopState": lambda v, w: _text(v, w, _TOKEN),
}

_EVENT_PAYLOAD_CHECKS: dict[str, Callable[[object, str], object]] = {
    "continuing": _boolean,
    "needsInput": _boolean,
    "isShell": _boolean,
    "usedTokens": lambda v, w: _integer(v, w),
    "windowTokens": lambda v, w: _integer(v, w),
}


def _row_payload(value: object) -> None:
    payload = _object(value, "payload", frozenset({"running"}), ROW_FACT_KEYS - {"running"})
    for key, item in payload.items():
        _ROW_FACT_CHECKS[key](item, f"payload.{key}")


def _event_payload(value: object, event_type: str) -> None:
    allowed = EVENT_PAYLOAD_KEYS[event_type]
    payload = _object(value, "payload", frozenset(), allowed)
    for key, item in payload.items():
        _EVENT_PAYLOAD_CHECKS[key](item, f"payload.{key}")


def _source_ref(value: object, kind: str) -> str:
    """Validate `sourceRef` against the one shape its `eventType` allows; return the type."""
    if not isinstance(value, dict):
        raise _fail("sourceRef", "not an object")
    event_type = value.get("eventType")
    shape = frozenset({"slotKey", "eventType"})
    optional: frozenset[str] = frozenset()
    if kind == "row-change":
        expected = "slot-row"
    else:
        expected = event_type if isinstance(event_type, str) else ""
        if expected not in EVENT_PAYLOAD_KEYS:
            raise _fail("sourceRef.eventType", "not a listed event type")
        if expected == "chat_done":
            optional = frozenset({"turn", "turnGen"})
        elif expected in ("tool_call", "tool_result"):
            shape = shape | {"toolCallId"}
    ref = _object(value, "sourceRef", shape, optional)
    _const(ref["eventType"], "sourceRef.eventType", expected)
    _text(ref["slotKey"], "sourceRef.slotKey", _SLOT_KEY)
    if "turn" in ref:
        _integer(ref["turn"], "sourceRef.turn")
    if "turnGen" in ref:
        _text(ref["turnGen"], "sourceRef.turnGen", _TURN_GEN)
    if "toolCallId" in ref:
        _text(ref["toolCallId"], "sourceRef.toolCallId", _TOOL_CALL_ID)
    return expected


_OBSERVATION_KEYS = frozenset(
    {
        "contractVersion",
        "bindingId",
        "installationId",
        "source",
        "sourceRef",
        "dedupKey",
        "factDigest",
        "receivedAtMs",
        "sourceTimeMs",
        "origin",
        "kind",
        "payload",
    }
)


def read_observation(value: object) -> dict[str, object]:
    """Validate an `observation.v1` body and return it."""
    body = _object(value, "observation", _OBSERVATION_KEYS, frozenset())
    _const(body["contractVersion"], "contractVersion", CONTRACT_VERSION)
    _text(body["bindingId"], "bindingId", _BINDING_ID)
    _text(body["installationId"], "installationId", _BINDING_ID)
    _const(body["source"], "source", "crew-ws")
    dedup_key = _nullable_text(body["dedupKey"], "dedupKey", _DEDUP_KEY)
    digest = _nullable_text(body["factDigest"], "factDigest", _DIGEST)
    _integer(body["receivedAtMs"], "receivedAtMs")
    _nullable_integer(body["sourceTimeMs"], "sourceTimeMs")
    _one_of(body["origin"], "origin", ("live", "recorded", "fixture"))
    kind = _one_of(body["kind"], "kind", ("row-change", "event"))
    event_type = _source_ref(body["sourceRef"], kind)
    if kind == "row-change":
        if dedup_key is not None or digest is None:
            raise _fail("dedupKey", "a row-change has a null dedupKey and a factDigest")
        _row_payload(body["payload"])
    else:
        if digest is not None:
            raise _fail("factDigest", "an event has a null factDigest")
        _event_payload(body["payload"], event_type)
    return body


def read_roster_item(value: object) -> dict[str, object]:
    """Validate a `roster-item.v1` body and return it."""
    item = _object(
        value,
        "roster-item",
        frozenset(
            {
                "contractVersion",
                "bindingId",
                "displayName",
                "avatar",
                "presence",
                "condition",
                "coverage",
                "lastObservedAtMs",
                "workers",
            }
        ),
        frozenset(),
    )
    _const(item["contractVersion"], "contractVersion", CONTRACT_VERSION)
    _text(item["bindingId"], "bindingId", _BINDING_ID)
    name = item["displayName"]
    if name is not None and (not isinstance(name, str) or len(name) > 128):
        raise _fail("displayName", "not a string of at most 128 characters")
    avatar = item["avatar"]
    if avatar is not None:
        parts = _object(avatar, "avatar", frozenset({"kind", "ref"}), frozenset())
        _text(parts["kind"], "avatar.kind", _AVATAR_KIND)
        _nullable_text(parts["ref"], "avatar.ref", _AVATAR_REF)
    _one_of(item["presence"], "presence", ("present", "absent", "unknown"))
    _read_condition(item["condition"])
    _read_coverage(item["coverage"])
    _nullable_integer(item["lastObservedAtMs"], "lastObservedAtMs")
    workers = _object(item["workers"], "workers", frozenset({"running", "seen"}), frozenset())
    _integer(workers["running"], "workers.running", 0, 1_000_000)
    _integer(workers["seen"], "workers.seen", 0, 1_000_000)
    return item


def _read_condition(value: object) -> None:
    condition = _object(
        value,
        "condition",
        frozenset({"state", "reasonCode", "basis", "sourceTimeMs", "observedAtMs", "signals"}),
        frozenset(),
    )
    _text(condition["state"], "condition.state", _STATE)
    _text(condition["reasonCode"], "condition.reasonCode", _REASON)
    basis = condition["basis"]
    if basis is not None:
        _one_of(basis, "condition.basis", ("row", "event"))
    _nullable_integer(condition["sourceTimeMs"], "condition.sourceTimeMs")
    _nullable_integer(condition["observedAtMs"], "condition.observedAtMs")
    signals = _object(condition["signals"], "signals", frozenset(_SIGNAL_KEYS), frozenset())
    for key in _SIGNAL_KEYS:
        _nullable_boolean(signals[key], f"signals.{key}")


def _read_coverage(value: object) -> None:
    coverage = _object(
        value,
        "coverage",
        frozenset({"state", "sinceMs", "reasonCode", "openGapCount"}),
        frozenset(),
    )
    _one_of(coverage["state"], "coverage.state", ("covered", "gap", "unknown"))
    _nullable_integer(coverage["sinceMs"], "coverage.sinceMs")
    _nullable_text(coverage["reasonCode"], "coverage.reasonCode", _REASON)
    _integer(coverage["openGapCount"], "coverage.openGapCount", 0, 1_000_000)


def read_roster(value: object) -> dict[str, object]:
    """Validate a `roster.v1` body, every item included, and return it."""
    body = _object(
        value,
        "roster",
        frozenset(
            {"contractVersion", "items", "nextCursor", "rosterRevision", "collector", "notes"}
        ),
        frozenset(),
    )
    _const(body["contractVersion"], "contractVersion", CONTRACT_VERSION)
    items = body["items"]
    if not isinstance(items, list) or len(items) > 200:
        raise _fail("items", "not an array of at most 200 items")
    for item in items:
        read_roster_item(item)
    cursor = body["nextCursor"]
    if cursor is not None:
        if not isinstance(cursor, str) or not 1 <= len(cursor) <= 512:
            raise _fail("nextCursor", "not a string of 1 to 512 characters")
        _text(cursor, "nextCursor", _CURSOR)
    _integer(body["rosterRevision"], "rosterRevision")
    collector = _object(
        body["collector"], "collector", frozenset({"state", "reasonCode", "sinceMs"}), frozenset()
    )
    _text(collector["state"], "collector.state", _STATE)
    _nullable_text(collector["reasonCode"], "collector.reasonCode", _REASON)
    _nullable_integer(collector["sinceMs"], "collector.sinceMs")
    notes = body["notes"]
    if not isinstance(notes, list) or len(notes) > 8:
        raise _fail("notes", "not an array of at most 8 notes")
    for note in notes:
        parts = _object(note, "note", frozenset({"code", "count"}), frozenset())
        _text(parts["code"], "note.code", _REASON)
        _nullable_integer(parts["count"], "note.count", 1_000_000)
    return body


def read_bot_binding(value: object) -> dict[str, object]:
    """Validate a `bot-binding.v1` body and return it."""
    body = _object(
        value,
        "bot-binding",
        frozenset(
            {
                "contractVersion",
                "bindingId",
                "installationId",
                "memberId",
                "memoryStore",
                "displayName",
                "presence",
                "createdAtMs",
                "lastSeenAtMs",
            }
        ),
        frozenset(),
    )
    _const(body["contractVersion"], "contractVersion", CONTRACT_VERSION)
    _text(body["bindingId"], "bindingId", _BINDING_ID)
    _text(body["installationId"], "installationId", _BINDING_ID)
    _text(body["memberId"], "memberId", _MEMBER_ID)
    _text(body["memoryStore"], "memoryStore", _MEMORY_STORE)
    name = body["displayName"]
    if name is not None and (not isinstance(name, str) or len(name) > 128):
        raise _fail("displayName", "not a string of at most 128 characters")
    _one_of(body["presence"], "presence", ("present", "absent", "unknown"))
    _integer(body["createdAtMs"], "createdAtMs")
    _nullable_integer(body["lastSeenAtMs"], "lastSeenAtMs")
    return body


def read_quarantine_record(value: object) -> dict[str, object]:
    """Validate a `quarantine-record.v1` body and return it."""
    body = _object(
        value,
        "quarantine-record",
        frozenset(
            {
                "contractVersion",
                "installationId",
                "bindingId",
                "reasonCode",
                "frameType",
                "sizeBytes",
                "digest",
                "count",
                "firstReceivedAtMs",
                "receivedAtMs",
                "sourceTimeMs",
            }
        ),
        frozenset(),
    )
    _const(body["contractVersion"], "contractVersion", CONTRACT_VERSION)
    _text(body["installationId"], "installationId", _BINDING_ID)
    _nullable_text(body["bindingId"], "bindingId", _BINDING_ID)
    _text(body["reasonCode"], "reasonCode", _REASON)
    _text(body["frameType"], "frameType", _FRAME_TYPE)
    _integer(body["sizeBytes"], "sizeBytes", 0, 4_294_967_295)
    _nullable_text(body["digest"], "digest", _QUARANTINE_DIGEST)
    _integer(body["count"], "count", 1, 2_147_483_647)
    _nullable_integer(body["firstReceivedAtMs"], "firstReceivedAtMs")
    _integer(body["receivedAtMs"], "receivedAtMs")
    _nullable_integer(body["sourceTimeMs"], "sourceTimeMs")
    return body


READERS: dict[str, Callable[[object], dict[str, object]]] = {
    "observation": read_observation,
    "roster-item": read_roster_item,
    "roster": read_roster,
    "bot-binding": read_bot_binding,
    "quarantine-record": read_quarantine_record,
}


def _source_ref_of(item: ObservationIn) -> dict[str, object]:
    ref: dict[str, object] = {"slotKey": item.slot_key, "eventType": item.event_type}
    if item.kind == "event":
        if item.event_type == "chat_done":
            if item.turn is not None:
                ref["turn"] = item.turn
            if item.turn_gen is not None:
                ref["turnGen"] = item.turn_gen
        elif item.tool_call_id is not None:
            ref["toolCallId"] = item.tool_call_id
    return ref


def to_wire(item: ObservationIn, *, binding_id: str) -> dict[str, object]:
    """The `observation.v1` body for a collector item.

    `binding_id` is passed in because the collector addresses a bot by its DM key; the wire
    carries only the opaque binding id.
    """
    return {
        "contractVersion": item.contract_version,
        "bindingId": binding_id,
        "installationId": item.installation_id,
        "source": item.source,
        "sourceRef": _source_ref_of(item),
        "dedupKey": item.dedup_key,
        "factDigest": item.fact_digest,
        "receivedAtMs": item.received_at_ms,
        "sourceTimeMs": item.source_time_ms,
        "origin": item.origin,
        "kind": item.kind,
        "payload": dict(item.payload),
    }


def bot_binding_to_wire(record: BindingRecord) -> dict[str, object]:
    """The `bot-binding.v1` body for a stored binding.

    The body is read back through its own reader, so a stored value the wire cannot carry (a
    memory store id with a dot, say) raises `ContractViolation` instead of reaching a client.
    """
    return read_bot_binding(
        {
            "contractVersion": CONTRACT_VERSION,
            "bindingId": record.binding_id,
            "installationId": record.installation_id,
            "memberId": record.member_id,
            "memoryStore": record.memory_store,
            "displayName": record.display_name,
            "presence": record.presence,
            "createdAtMs": record.created_at_ms,
            "lastSeenAtMs": record.last_seen_ms,
        }
    )


def quarantine_record_to_wire(record: QuarantineRecord) -> dict[str, object]:
    """The `quarantine-record.v1` body. The store keeps no binding on a quarantine row."""
    return read_quarantine_record(
        {
            "contractVersion": CONTRACT_VERSION,
            "installationId": record.installation_id,
            "bindingId": None,
            "reasonCode": record.reason,
            "frameType": record.frame_type,
            "sizeBytes": record.size_bytes,
            "digest": record.digest,
            "count": record.count,
            "firstReceivedAtMs": record.first_received_at_ms,
            "receivedAtMs": record.received_at_ms,
            "sourceTimeMs": None,
        }
    )
