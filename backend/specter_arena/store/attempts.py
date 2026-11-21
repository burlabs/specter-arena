from __future__ import annotations

import re
import sqlite3
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, Literal

from .errors import InvalidCursor, StoreUsageError, UnknownBinding
from .fold import BOT_TURN, CHAT_DONE, ROW_IDLE, WORKER
from .guard import translate_errors
from .lifecycle import purge_horizon, with_purged_gap
from .paging import Page, build_page, clamp_limit, decode_cursor
from .records import HEARTBEAT_STALE_MS
from .roster import NO_CUT, Feed, feed_coverage, staleness_cut
from .store import Store
from .validate import is_time_ms

AttemptState = Literal["working", "ended", "unknown"]

MAX_ATTEMPTS_PAGE = 50
WINDOWS: tuple[tuple[str, int], ...] = (("last24h", 86_400_000), ("last7d", 604_800_000))

_ATTEMPT_ID = re.compile(r"att_[0-9a-f]{24}")
_ENDED_REASONS = {ROW_IDLE: "ended-row-idle", CHAT_DONE: "ended-chat-done"}


@dataclass(frozen=True, slots=True)
class AttemptView:
    """One attempt as the wire needs it. The slot key is read for the rule and never returned."""

    attempt_id: str
    kind: str
    started_ms: int
    ended_ms: int | None
    end_signal: str | None
    state: AttemptState
    reason: str


@dataclass(frozen=True, slots=True)
class ActivityWindow:
    key: str
    from_ms: int
    to_ms: int
    window_ms: int
    observed_from_ms: int
    covered_ms: int
    gap_count: int
    bot_turns_started: int
    workers_started: int
    sample_size: int
    ended: int
    still_open: int
    unknown: int


@dataclass(frozen=True, slots=True)
class AttemptsResult:
    binding_id: str
    page: Page[AttemptView]
    activity: tuple[ActivityWindow, ...]
    revision: int


def attempt_state(
    running: bool, end_signal: str | None, slot_last_seen_ms: int | None, feed: Feed
) -> tuple[AttemptState, str]:
    """The per-attempt rule (SC4-2). Presence is not an input; `roster_page` counts the same way."""
    if not running:
        return "ended", _ENDED_REASONS.get(end_signal or "", "ended-other")
    cut = staleness_cut(feed)
    if cut == NO_CUT:
        return "unknown", feed.reason or "no-coverage"
    if slot_last_seen_ms is None:
        return "unknown", "no-slot-yet"
    if slot_last_seen_ms < cut:
        return "unknown", "feed-absent"
    return "working", "running"


def covered_ms(spans: Iterable[tuple[int, int]], from_ms: int, to_ms: int) -> int:
    """Length of the union of `spans` clipped to `[from_ms, to_ms]`; overlaps count once."""
    total = 0
    reached = from_ms
    for start, end in sorted(spans):
        start, end = max(start, reached), min(end, to_ms)
        if end > start:
            total += end - start
            reached = end
    return total


def gap_count(spans: Iterable[tuple[int, int]], from_ms: int, to_ms: int) -> int:
    """Gaps that overlap `[from_ms, to_ms]`, plus point gaps (start == end) inside it.

    The window passes `observedFromMs` as `from_ms`, the span `covered_ms` uses, so a bot first
    seen mid-window shows no gaps that predate it."""
    return sum(
        1
        for start, end in spans
        if (start < to_ms and end > from_ms) or (start == end and from_ms <= start <= to_ms)
    )


def _effective_end(
    state: str, start_ms: int, end_ms: int | None, heartbeat_ms: int, as_of_ms: int
) -> int:
    """Where an interval ends for reading. An open covered one stops at its last heartbeat once
    that is stale, so a dead collector never accrues covered time (`runs._recover` closes it
    there)."""
    if end_ms is not None:
        return end_ms
    if state == "gap" or as_of_ms - heartbeat_ms <= HEARTBEAT_STALE_MS:
        return as_of_ms
    return max(start_ms, heartbeat_ms)


_PAGE_SQL = """
SELECT a.attempt_id, a.kind, a.started_ms, a.ended_ms, a.end_signal, a.running, k.last_seen_ms
FROM attempt a LEFT JOIN slot_seen k
  ON k.binding_id = a.binding_id AND k.slot_key = a.slot_key
WHERE a.binding_id = :binding AND a.kind IN ('bot-turn', 'worker')
  AND (:after_ms IS NULL OR a.started_ms < :after_ms
       OR (a.started_ms = :after_ms AND a.attempt_id < :after_id))
ORDER BY a.started_ms DESC, a.attempt_id DESC
LIMIT :n
"""

_COUNT_SQL = """
SELECT a.kind,
  CASE WHEN a.running = 0 THEN 'ended'
       WHEN k.last_seen_ms >= :cut THEN 'working'
       ELSE 'unknown' END,
  count(*)
FROM attempt a LEFT JOIN slot_seen k
  ON k.binding_id = a.binding_id AND k.slot_key = a.slot_key
WHERE a.binding_id = :binding AND a.kind IN ('bot-turn', 'worker')
  AND a.started_ms >= :from AND a.started_ms <= :to
GROUP BY 1, 2
"""

_INTERVAL_SQL = """
SELECT ci.state, ci.start_ms, ci.end_ms, r.last_heartbeat_ms
FROM coverage_interval ci JOIN collector_run r ON r.run_id = ci.run_id
WHERE ci.start_ms <= :to AND (ci.end_ms IS NULL OR ci.end_ms >= :from)
"""


def _after(cursor: str | None) -> tuple[int | None, str | None]:
    if cursor is None:
        return None, None
    started_ms, attempt_id = decode_cursor(cursor, 2)
    if (
        not isinstance(started_ms, int)
        or started_ms < 0
        or not isinstance(attempt_id, str)
        or _ATTEMPT_ID.fullmatch(attempt_id) is None
    ):
        raise InvalidCursor
    return started_ms, attempt_id


def _window(
    conn: sqlite3.Connection,
    key: str,
    length_ms: int,
    *,
    binding_id: str,
    first_seen_ms: int,
    as_of_ms: int,
    cut: int,
    intervals: list[tuple[str, int, int]],
) -> ActivityWindow:
    from_ms = max(0, as_of_ms - length_ms)
    observed_from_ms = min(max(from_ms, first_seen_ms), as_of_ms)
    counts: dict[tuple[str, str], int] = {}
    params = {"binding": binding_id, "cut": cut, "from": from_ms, "to": as_of_ms}
    for kind, state, count in conn.execute(_COUNT_SQL, params):
        counts[(kind, state)] = int(count)

    def total(*, kind: str | None = None, state: str | None = None) -> int:
        return sum(n for (k, s), n in counts.items() if kind in (None, k) and state in (None, s))

    return ActivityWindow(
        key=key,
        from_ms=from_ms,
        to_ms=as_of_ms,
        window_ms=as_of_ms - from_ms,
        observed_from_ms=observed_from_ms,
        covered_ms=covered_ms(
            ((s, e) for state, s, e in intervals if state == "covered"), observed_from_ms, as_of_ms
        ),
        gap_count=gap_count(
            ((s, e) for state, s, e in intervals if state == "gap"), observed_from_ms, as_of_ms
        ),
        bot_turns_started=total(kind=BOT_TURN),
        workers_started=total(kind=WORKER),
        sample_size=total(),
        ended=total(state="ended"),
        still_open=total(state="working"),
        unknown=total(state="unknown"),
    )


def attempts_page(
    store: Store, binding_id: str, *, cursor: str | None, limit: int, as_of_ms: int
) -> AttemptsResult:
    """One bot's attempts, newest first, with 24 h and 7 d activity; one read transaction.

    `as_of_ms` is the only clock. Raises `UnknownBinding` for any id the store does not hold.
    """
    if not isinstance(binding_id, str):
        raise StoreUsageError("binding_id must be a string")
    if not is_time_ms(as_of_ms) or as_of_ms < 1:
        raise StoreUsageError("as_of_ms must be a positive integer")
    size = clamp_limit(limit, maximum=MAX_ATTEMPTS_PAGE)
    after_ms, after_id = _after(cursor)
    with translate_errors(), store.read() as conn:
        binding = conn.execute(
            "SELECT first_seen_ms FROM bot_binding WHERE binding_id = ?", (binding_id,)
        ).fetchone()
        if binding is None:
            raise UnknownBinding
        feed = feed_coverage(conn, as_of_ms)
        cut = staleness_cut(feed)
        fetched = conn.execute(
            _PAGE_SQL,
            {
                "binding": binding_id,
                "after_ms": after_ms,
                "after_id": after_id,
                "n": size + 1,
            },
        ).fetchall()
        widest_from = max(0, as_of_ms - max(length for _, length in WINDOWS))
        # History a purge removed is a gap (reason `purged`), never covered time with no activity.
        intervals = with_purged_gap(
            (
                (str(state), int(start), _effective_end(state, start, end, heartbeat, as_of_ms))
                for state, start, end, heartbeat in conn.execute(
                    _INTERVAL_SQL, {"from": widest_from, "to": as_of_ms}
                )
            ),
            purge_horizon(conn),
        )
        activity = tuple(
            _window(
                conn,
                key,
                length,
                binding_id=binding_id,
                first_seen_ms=int(binding[0]),
                as_of_ms=as_of_ms,
                cut=cut,
                intervals=intervals,
            )
            for key, length in WINDOWS
        )
        revision = int(conn.execute("SELECT revision FROM collector_setting").fetchone()[0])
    views = [_view(row, feed) for row in fetched]
    return AttemptsResult(
        binding_id=binding_id,
        page=build_page(views, size, lambda v: (v.started_ms, v.attempt_id)),
        activity=activity,
        revision=revision,
    )


def _view(row: Any, feed: Feed) -> AttemptView:
    state, reason = attempt_state(bool(row[5]), row[4], row[6], feed)
    return AttemptView(
        attempt_id=str(row[0]),
        kind=str(row[1]),
        started_ms=int(row[2]),
        ended_ms=None if row[3] is None else int(row[3]),
        end_signal=None if row[4] is None else str(row[4]),
        state=state,
        reason=reason,
    )
