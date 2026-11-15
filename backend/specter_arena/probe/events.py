# SPECTER-DIAGNOSTIC-ONLY
from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field

MARKER = "SPECTER-DIAGNOSTIC-ONLY"

# Every gateway frame type the probe names; an event row's `eventType` is always one of these.
EVENT_VOCABULARY: tuple[str, ...] = tuple(
    sorted(
        {
            "approval",
            "approval_resolved",
            "chat_chunk",
            "chat_done",
            "chat_status",
            "chat_thinking",
            "context_usage",
            "dashboard",
            "models_changed",
            "other",
            "question_card",
            "refresh",
            "slots",
            "subagent_batch_chunks",
            "subagent_batch_update",
            "subagent_chunk",
            "subagent_done",
            "subagent_injection_failed",
            "subagent_queued",
            "subagent_recovering",
            "subagent_resumed",
            "subagent_retrying",
            "subagent_snapshot",
            "subagent_spawn",
            "subagent_stalled",
            "subagent_status",
            "subagent_tool",
            "subagent_waiting",
            "tool_call",
            "tool_result",
            "update_progress",
        }
    )
)

# Content streams: counted and sized, never retained.
COUNT_ONLY = frozenset(
    {"chat_chunk", "chat_thinking", "subagent_chunk", "subagent_tool", "subagent_batch_chunks"}
)

_SUBAGENT_STATUS_FIELDS = frozenset({"id", "slot", "batch_id", "status"})
_SUBAGENT_STATUS_TYPES = (
    "subagent_batch_update",
    "subagent_injection_failed",
    "subagent_queued",
    "subagent_recovering",
    "subagent_resumed",
    "subagent_retrying",
    "subagent_snapshot",
    "subagent_stalled",
    "subagent_status",
    "subagent_waiting",
)

# The only `data` keys an event row keeps. Prose-bearing keys (status text on chat_status, tool
# names and inputs, task, agent, label, model, purpose) are absent on purpose: no slot keeps them.
EVENT_FIELDS: dict[str, frozenset[str]] = {
    "chat_status": frozenset({"slot"}),
    "chat_done": frozenset({"slot", "turn", "turn_gen", "continuing", "needs_input"}),
    "tool_call": frozenset({"slot", "kind", "is_shell", "tool_call_id"}),
    "tool_result": frozenset({"slot", "kind", "is_shell", "tool_call_id", "is_error"}),
    "context_usage": frozenset({"slot", "pct", "used_tokens", "window_tokens", "reset"}),
    "approval": frozenset({"id", "slot", "ts", "source"}),
    "approval_resolved": frozenset({"id", "slot", "approved"}),
    "question_card": frozenset({"slot"}),
    "subagent_spawn": frozenset({"id", "slot", "batch_id"}),
    "subagent_done": frozenset(
        {
            "id",
            "slot",
            "batch_id",
            "elapsed",
            "credits",
            "error",
            "stopped",
            "outcome",
            "stop_reason",
            "stop_class",
            "partial",
            "leaked_tool_call",
        }
    ),
    **{name: _SUBAGENT_STATUS_FIELDS for name in _SUBAGENT_STATUS_TYPES},
}

# Allow-listed keys whose short lower-case word values are kept on probe-slot events.
ENUM_FIELDS = frozenset({"kind", "source", "status", "outcome", "stop_reason", "stop_class"})

PENDING_LIMIT = 100
PENDING_TTL_SECONDS = 5.0
MAX_KEPT_ROWS = 2000


def percentile(values: list[int], fraction: float) -> int:
    """Nearest-rank percentile of `values`; 0 for an empty list."""
    if not values:
        return 0
    ordered = sorted(values)
    return ordered[max(0, math.ceil(fraction * len(ordered)) - 1)]


def burst_max_per_second(received_at_ms: list[int]) -> int:
    """The most frames that arrived within one wall-clock second."""
    counts: dict[int, int] = {}
    for stamp in received_at_ms:
        second = stamp // 1000
        counts[second] = counts.get(second, 0) + 1
    return max(counts.values(), default=0)


@dataclass
class EventLog:
    """Per-type counters, sizes and receive times for every frame seen, plus a bounded list of
    retained (already sanitised) event rows. Raw frame bytes are measured, never held."""

    max_rows: int = MAX_KEPT_ROWS
    rows: list[dict[str, object]] = field(default_factory=list)
    frames_seen: dict[str, int] = field(default_factory=dict)
    rows_kept: dict[str, int] = field(default_factory=dict)
    rows_dropped_by_cap: int = 0
    keys_seen: dict[str, set[str]] = field(default_factory=dict)
    _sizes: dict[str, list[int]] = field(default_factory=dict)
    _times: dict[str, list[int]] = field(default_factory=dict)
    _seq: int = 0

    def seen(self, event_type: str, size_bytes: int, received_at_ms: int) -> int:
        """Count one frame of any type and return its frame sequence number."""
        self._seq += 1
        self.frames_seen[event_type] = self.frames_seen.get(event_type, 0) + 1
        self._sizes.setdefault(event_type, []).append(size_bytes)
        self._times.setdefault(event_type, []).append(received_at_ms)
        return self._seq

    def keep(
        self,
        frame_seq: int,
        event_type: str,
        row_kind: str,
        received_at_ms: int,
        data: dict[str, object],
    ) -> bool:
        """Retain one sanitised event row unless its type is count-only or the cap is reached."""
        if event_type in COUNT_ONLY:
            return False
        if len(self.rows) >= self.max_rows:
            self.rows_dropped_by_cap += 1
            return False
        self.rows.append(
            {
                "frameSeq": frame_seq,
                "rowKind": row_kind,
                "eventType": event_type,
                "receivedAtMs": received_at_ms,
                "data": data,
            }
        )
        self.rows_kept[event_type] = self.rows_kept.get(event_type, 0) + 1
        self.keys_seen.setdefault(event_type, set()).update(data)
        return True

    def measurement(self) -> dict[str, dict[str, int]]:
        return {
            event_type: {
                "count": len(sizes),
                "bytesP50": percentile(sizes, 0.5),
                "bytesP95": percentile(sizes, 0.95),
                "bytesMax": max(sizes),
                "burstMaxPerSecond": burst_max_per_second(self._times[event_type]),
            }
            for event_type, sizes in sorted(self._sizes.items())
        }


@dataclass(frozen=True)
class PendingEvent:
    """An event whose slot is not yet a known probe slot, held in both sanitised forms."""

    slot: str
    held_at: float
    probe_form: dict[str, object]
    plain_form: dict[str, object]


class PendingEvents:
    """Events that arrived before their slot row. Bounded; each waits for the next `slots` frame
    or `ttl_seconds`, whichever comes first. Only sanitised forms are held."""

    def __init__(self, limit: int = PENDING_LIMIT, ttl_seconds: float = PENDING_TTL_SECONDS):
        self._items: deque[PendingEvent] = deque()
        self._limit = limit
        self._ttl = ttl_seconds

    def __len__(self) -> int:
        return len(self._items)

    def hold(self, event: PendingEvent) -> PendingEvent | None:
        """Hold an event; when full, the oldest is evicted and returned (write its plain form)."""
        evicted = self._items.popleft() if len(self._items) >= self._limit else None
        self._items.append(event)
        return evicted

    def resolve(self, probe_slots: frozenset[str]) -> tuple[list[PendingEvent], list[PendingEvent]]:
        """At a `slots` frame: (events whose slot is now a probe slot, every other held event).
        The buffer is empty afterwards."""
        promoted = [event for event in self._items if event.slot in probe_slots]
        unresolved = [event for event in self._items if event.slot not in probe_slots]
        self._items.clear()
        return promoted, unresolved

    def expire(self, now: float) -> list[PendingEvent]:
        """Remove and return the events held for `ttl_seconds` or longer."""
        expired: list[PendingEvent] = []
        while self._items and now - self._items[0].held_at >= self._ttl:
            expired.append(self._items.popleft())
        return expired
