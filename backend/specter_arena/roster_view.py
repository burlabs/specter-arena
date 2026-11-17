from __future__ import annotations

import re
from typing import TYPE_CHECKING, Protocol

from .condition import condition_rules_v1

if TYPE_CHECKING:
    from .store import Page, RosterRow

CONTRACT_VERSION = 1
MAX_NAME_CHARS = 128
MAX_NOTES = 8
STANDING_NOTE = "cron-turns-not-observable"

_AVATAR_KIND = re.compile(r"[a-z][a-z0-9_-]{0,31}")
_AVATAR_REF = re.compile(r"[A-Za-z0-9._-]{1,128}")
_REASON = re.compile(r"[a-z][a-z0-9-]{0,63}")
_STATE = re.compile(r"[a-z][a-z0-9-]{0,47}")


class CollectorStatusLike(Protocol):
    @property
    def state(self) -> str: ...
    @property
    def reason_code(self) -> str | None: ...
    @property
    def since_ms(self) -> int: ...
    @property
    def notes(self) -> tuple[tuple[str, int | None], ...]: ...


class CollectorLike(Protocol):
    def status(self) -> CollectorStatusLike: ...


def _reason_or(value: str | None, fallback: str | None) -> str | None:
    return value if value is not None and _REASON.fullmatch(value) else fallback


def _display_name(row: RosterRow) -> str | None:
    name = row.display_name if row.display_name else row.name
    return name[:MAX_NAME_CHARS] if name else None


def _avatar(row: RosterRow) -> dict[str, object] | None:
    kind = row.avatar_kind
    if kind is None or not _AVATAR_KIND.fullmatch(kind):
        return None
    ref = row.avatar_ref
    return {"kind": kind, "ref": ref if ref is not None and _AVATAR_REF.fullmatch(ref) else None}


def roster_item_wire(row: RosterRow, as_of_ms: int) -> dict[str, object]:
    """One `roster-item.v1` body. Carries the opaque binding id and no Crew identifier."""
    condition = condition_rules_v1(row, as_of_ms)
    return {
        "contractVersion": CONTRACT_VERSION,
        "bindingId": row.binding_id,
        "displayName": _display_name(row),
        "avatar": _avatar(row),
        "presence": row.presence,
        "condition": {
            "state": condition.state,
            "reasonCode": _reason_or(condition.reason_code, "no-coverage"),
            "basis": condition.basis,
            "sourceTimeMs": condition.source_time_ms,
            "observedAtMs": condition.observed_at_ms,
            "signals": dict(condition.signals),
        },
        "coverage": {
            "state": row.coverage.state,
            "sinceMs": row.coverage.since_ms,
            "reasonCode": _reason_or(row.coverage.reason, None),
            "openGapCount": row.coverage.open_gap_count,
        },
        "lastObservedAtMs": row.last_observed_ms,
        "workers": {
            "running": row.workers_running,
            "seen": row.workers_seen,
            "unknown": row.workers_unknown,
        },
    }


def _collector_wire(status: CollectorStatusLike | None, as_of_ms: int) -> dict[str, object]:
    if status is None:
        return {"state": "unavailable", "reasonCode": "collector-not-started", "sinceMs": as_of_ms}
    state = status.state if _STATE.fullmatch(status.state) else "unavailable"
    return {
        "state": state,
        "reasonCode": _reason_or(status.reason_code, None),
        "sinceMs": status.since_ms,
    }


def roster_body(
    page: Page[RosterRow],
    revision: int,
    collector: CollectorLike | None,
    as_of_ms: int,
) -> dict[str, object]:
    """The `roster.v1` body for one page, the projection revision and the collector state."""
    status = collector.status() if collector is not None else None
    notes: list[dict[str, object]] = [{"code": STANDING_NOTE, "count": None}]
    for code, count in status.notes if status is not None else ():
        if _REASON.fullmatch(code):
            notes.append({"code": code, "count": count})
    return {
        "contractVersion": CONTRACT_VERSION,
        "items": [roster_item_wire(row, as_of_ms) for row in page.items],
        "nextCursor": page.next_cursor,
        "rosterRevision": revision,
        "collector": _collector_wire(status, as_of_ms),
        "notes": notes[:MAX_NOTES],
    }
