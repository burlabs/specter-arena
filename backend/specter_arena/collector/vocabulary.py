from __future__ import annotations

from dataclasses import dataclass

HANDLED_TYPES = frozenset(
    {"slots", "chat_done", "chat_status", "tool_call", "tool_result", "context_usage"}
)

# Known frames the collector deliberately does not use: counted, never queued, never parsed.
# Equals the event vocabulary's ignore list, the 12 extra types seen on Crew 0.12.2 (one of
# them `heartbeat`), and nothing else, so an unknown name can only be quarantined.
IGNORED_TYPES = frozenset(
    {
        "approval",
        "approval_resolved",
        "question_card",
        "chat_chunk",
        "chat_thinking",
        "dashboard",
        "models_changed",
        "refresh",
        "update_progress",
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
        "heartbeat",
        "activity_event",
        "chat_message",
        "chat_message_update",
        "chat_segment",
        "session_health_changed",
        "notification",
        "queue_push",
        "queue_pop",
        "autonudge_state",
        "subagent_snapshot_batch",
        "mcp_report_update",
    }
)

IGNORE_REASONS = frozenset({"worker-event", "unbound-expired"})

PARSE_REJECT_REASONS = frozenset({"bad-row", "bad-worker-key", "oversize-frame", "oversize"})

STORE_REJECT_REASONS = frozenset(
    {
        "wrong-installation",
        "unknown-binding",
        "binding-mismatch",
        "store-less-bot",
        "bad-dm-key",
        "ambiguous-store",
        "bad-field",
        "bad-origin",
        "bad-dedup",
        "unknown-event-type",
        "payload-shape",
        "payload-too-large",
        "worker-not-attributable",
        "bad-roster-row",
        "bad-reason",
        "bad-coverage-mark",
        "unknown-run",
        "constraint",
    }
)

REJECT_REASONS = PARSE_REJECT_REASONS | STORE_REJECT_REASONS

QUARANTINE_REASONS = frozenset(
    {"unknown-event-type", "malformed-frame", "oversize-frame", "schema-mismatch"}
)


@dataclass(frozen=True)
class Limits:
    event_queue_max: int = 1_000
    batch_max: int = 100
    flush_interval_s: float = 0.25
    raw_frame_max_chars: int = 64 * 1024
    frame_peek_chars: int = 64
    ws_max_size: int = 2 * 1024 * 1024
    heartbeat_interval_s: float = 10.0
    roster_interval_s: float = 60.0
    roster_refresh_min_s: float = 10.0
    token_renew_s: float = 45 * 60
    partial_resnapshot_s: float = 30.0
    backoff_s: tuple[float, ...] = (1, 2, 4, 8, 16, 30)
    jitter: float = 0.2
    quarantine_window_s: float = 60.0
    pending_event_max: int = 100
    pending_event_ttl_s: float = 5.0
    known_binding_max: int = 500
    roster_rows_max: int = 2_000
    roster_poll_rows_max: int = 200
    http_body_max_bytes: int = 1024 * 1024


LIMITS = Limits()


def classify_type(name: str) -> str:
    """`handled`, `ignored` or `quarantine`; a name in neither closed list is never ignored."""
    if name in HANDLED_TYPES:
        return "handled"
    if name in IGNORED_TYPES:
        return "ignored"
    return "quarantine"
