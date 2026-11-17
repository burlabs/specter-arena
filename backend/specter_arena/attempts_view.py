from __future__ import annotations

import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .store import ActivityWindow, AttemptsResult, AttemptView

CONTRACT_VERSION = 1

_KIND = re.compile(r"[a-z][a-z0-9-]{0,15}")
_STATE = re.compile(r"[a-z][a-z0-9-]{0,47}")
_REASON = re.compile(r"[a-z][a-z0-9-]{0,63}")
# Stored end signals (fold.py ROW_IDLE and CHAT_DONE) to their wire form. Anything else is null,
# so a value a later writer stores can never put free text or an underscore on the wire.
_END_SIGNAL_WIRE = {"row-idle": "row-idle", "chat_done": "chat-done"}
_WINDOW_KEYS = ("last24h", "last7d")


def end_signal_wire(stored: str | None) -> str | None:
    return None if stored is None else _END_SIGNAL_WIRE.get(stored)


def attempt_item_wire(view: AttemptView) -> dict[str, object]:
    """One `attempt-item.v1` body. Carries the opaque attempt id and no slot key or Crew id."""
    return {
        "contractVersion": CONTRACT_VERSION,
        "attemptId": view.attempt_id,
        "kind": view.kind if _KIND.fullmatch(view.kind) else "unknown",
        "startedMs": view.started_ms,
        "endedMs": view.ended_ms,
        "endSignal": end_signal_wire(view.end_signal),
        "condition": {
            "state": view.state if _STATE.fullmatch(view.state) else "unknown",
            "reasonCode": view.reason if _REASON.fullmatch(view.reason) else "no-coverage",
        },
    }


def window_wire(window: ActivityWindow) -> dict[str, object]:
    return {
        "fromMs": window.from_ms,
        "toMs": window.to_ms,
        "windowMs": window.window_ms,
        "observedFromMs": window.observed_from_ms,
        "coveredMs": window.covered_ms,
        "gapCount": window.gap_count,
        "botTurnsStarted": window.bot_turns_started,
        "workersStarted": window.workers_started,
        "sampleSize": window.sample_size,
        "ended": window.ended,
        "stillOpen": window.still_open,
        "unknown": window.unknown,
    }


def attempts_body(result: AttemptsResult, as_of_ms: int) -> dict[str, object]:
    """The `attempts.v1` body for one page, both windows and the revision of the same snapshot."""
    by_key = {window.key: window for window in result.activity}
    return {
        "contractVersion": CONTRACT_VERSION,
        "bindingId": result.binding_id,
        "items": [attempt_item_wire(view) for view in result.page.items],
        "nextCursor": result.page.next_cursor,
        "rosterRevision": result.revision,
        "asOfMs": as_of_ms,
        "activity": {key: window_wire(by_key[key]) for key in _WINDOW_KEYS},
    }
