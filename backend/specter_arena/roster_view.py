from __future__ import annotations

import re
from collections.abc import Mapping
from typing import TYPE_CHECKING, Protocol

from .condition import Condition, condition_rules_v1, condition_rules_v2

if TYPE_CHECKING:
    from .store import Page, RosterRow, TokenReading

CONTRACT_VERSION = 1
CONTRACT_VERSION_V2 = 2
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


def _item_wire(row: RosterRow, condition: Condition, version: int) -> dict[str, object]:
    return {
        "contractVersion": version,
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


def roster_item_wire(row: RosterRow, as_of_ms: int) -> dict[str, object]:
    """One `roster-item.v1` body. Carries the opaque binding id and no Crew identifier."""
    return _item_wire(row, condition_rules_v1(row, as_of_ms), CONTRACT_VERSION)


def token_reading_wire(reading: TokenReading | None, row: RosterRow) -> dict[str, object] | None:
    """The `tokenReading` of `roster-item.v2`: the bot's context window in use, or null.

    It is a gauge of the live turn's context window (`context_usage`: `used_tokens` of
    `window_tokens`), never spend and never a total. Null means "Not collected": no reading, a
    bot the collector is not covering, or a reading older than the coverage that began after it.
    """
    if reading is None or row.coverage.state != "covered":
        return None
    since = row.coverage.since_ms
    if since is not None and reading.observed_at_ms < since:
        return None
    if reading.used > reading.window or reading.window <= 0:
        return None
    return {
        "kind": "context",
        "used": reading.used,
        "window": reading.window,
        "observedAt": reading.observed_at_ms,
    }


def roster_item_v2_wire(
    row: RosterRow, as_of_ms: int, reading: TokenReading | None = None
) -> dict[str, object]:
    """One `roster-item.v2` body: v1 plus the `waiting` condition and `tokenReading`."""
    body = _item_wire(row, condition_rules_v2(row, as_of_ms), CONTRACT_VERSION_V2)
    body["tokenReading"] = token_reading_wire(reading, row)
    return body


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


def roster_v2_body(
    page: Page[RosterRow],
    revision: int,
    collector: CollectorLike | None,
    as_of_ms: int,
    readings: Mapping[str, TokenReading],
) -> dict[str, object]:
    """The `roster.v2` body: `roster.v1` with `roster-item.v2` items."""
    body = roster_body(page, revision, collector, as_of_ms)
    body["contractVersion"] = CONTRACT_VERSION_V2
    body["items"] = [
        roster_item_v2_wire(row, as_of_ms, readings.get(row.binding_id)) for row in page.items
    ]
    return body
