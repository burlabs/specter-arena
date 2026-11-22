from __future__ import annotations

import hashlib
import json
import logging
import re
import sqlite3
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from .attempts import AttemptState, _effective_end, attempt_state, covered_ms, gap_count
from .errors import InvalidCursor, StoreUsageError, UnknownTask
from .fold import BOT_TURN, CHAT_DONE, ROW_IDLE, WORKER
from .guard import translate_errors
from .lifecycle import purge_horizon, with_purged_gap
from .paging import Page, build_page, clamp_limit, decode_cursor
from .roster import Feed, feed_coverage
from .store import Store
from .validate import is_time_ms
from .xp_policy import BOT_TURN_TASK_MIN_MS, TASK_POLICY_VERSION, size_class, task_bounty

_LOG = logging.getLogger("specter_arena.store.tasks")

MAX_TASKS_PAGE = 25
STATES = ("open", "credited", "not-credited")
CREDITED = "credited"
NOT_CREDITED = "not-credited"
OPEN = "open"
CLEAN_END = "clean-end"
UNKNOWN_TERMINAL = "unknown-terminal"
COVERAGE_GAP = "coverage-gap"
WAITING_AT_END = "waiting-at-end"

# The end signals that are a known terminal state for each attempt kind (`fold`).
KNOWN_TERMINALS: Mapping[str, frozenset[str]] = {
    BOT_TURN: frozenset({ROW_IDLE, CHAT_DONE}),
    WORKER: frozenset({ROW_IDLE}),
}
# Row facts that mean the source was waiting on the owner when the row was stored.
PENDING_KEYS = ("pendingApproval", "needsInput", "waitingForInput")

_TASK_ID = re.compile(r"tsk_[0-9a-f]{24}")


def task_id_for(attempt_id: str) -> str:
    """`tsk_` plus 24 hex of a hash of the attempt id, so a rebuild of the projection keeps it."""
    return "tsk_" + hashlib.sha256(f"task|{attempt_id}".encode()).hexdigest()[:24]


def entry_id_for(task_id: str) -> str:
    return "txe_" + hashlib.sha256(f"txe|{task_id}".encode()).hexdigest()[:24]


@dataclass(frozen=True, slots=True)
class _Candidate:
    """One attempt that needs a task written or brought up to date, with the task it has."""

    attempt_id: str
    binding_id: str
    kind: str
    slot_key: str
    started_ms: int
    ended_ms: int | None
    ended_seq: int | None
    end_signal: str | None
    running: bool
    task_id: str | None
    task_state: str | None


# Which attempts are tasks. A bot turn must be the binding's own DM slot, a worker must not be,
# so a slot that is neither (a summoning or other app-internal chat never reaches `attempt`, and
# would not match here either) never becomes a task. Only attempts with no task, or whose task
# disagrees with them on running or end time, come back: a sweep after an ordinary batch reads a
# handful of rows.
_CANDIDATES = """
SELECT a.attempt_id, a.binding_id, a.kind, a.slot_key, a.started_ms, a.ended_ms, a.ended_seq,
       a.end_signal, a.running, t.task_id, t.state
FROM attempt a
JOIN bot_binding b ON b.binding_id = a.binding_id
LEFT JOIN task t ON t.attempt_id = a.attempt_id
WHERE ((a.kind = 'bot-turn' AND a.slot_key = b.dm_key)
       OR (a.kind = 'worker' AND a.slot_key <> b.dm_key))
  AND (a.kind = 'worker' OR coalesce(a.ended_ms, :now) - a.started_ms >= :min)
  AND (t.task_id IS NULL OR t.running <> a.running OR t.ended_ms IS NOT a.ended_ms)
ORDER BY a.started_seq, a.attempt_id
"""

_INTERVALS = """
SELECT ci.state, ci.start_ms, ci.end_ms, r.last_heartbeat_ms
FROM coverage_interval ci JOIN collector_run r ON r.run_id = ci.run_id
WHERE ci.end_ms IS NULL OR ci.end_ms >= :from
"""

_LAST_ROW = (
    "SELECT payload FROM observation WHERE binding_id = ? AND slot_key = ?"
    " AND kind = 'row-change' AND seq <= ? ORDER BY seq DESC LIMIT 1"
)


class _Coverage:
    """Coverage intervals as they read at `now_ms`, with purged history counted as a gap."""

    def __init__(self, conn: sqlite3.Connection, from_ms: int, now_ms: int) -> None:
        raw = (
            (str(state), int(start), _effective_end(state, int(start), end, int(beat), now_ms))
            for state, start, end, beat in conn.execute(_INTERVALS, {"from": from_ms})
        )
        spans = with_purged_gap(raw, purge_horizon(conn))
        self._gaps = [(start, end) for state, start, end in spans if state == "gap"]
        self._covered = [(start, end) for state, start, end in spans if state == "covered"]

    def broken(self, start_ms: int, end_ms: int) -> bool:
        """True when a gap overlaps `[start_ms, end_ms]` or coverage does not span all of it."""
        if gap_count(self._gaps, start_ms, end_ms) > 0:
            return True
        if end_ms == start_ms:
            return not any(start <= start_ms <= end for start, end in self._covered)
        return covered_ms(self._covered, start_ms, end_ms) < end_ms - start_ms


def _waiting_at_end(conn: sqlite3.Connection, found: _Candidate) -> bool | None:
    """Whether the last stored row of the attempt's slot, up to its end, shows an approval or a
    question pending. None when that row is gone (a purge) or unreadable."""
    if found.ended_seq is None:
        return None
    row = conn.execute(_LAST_ROW, (found.binding_id, found.slot_key, found.ended_seq)).fetchone()
    if row is None:
        return None
    payload = json.loads(row[0])
    if not isinstance(payload, dict):
        return None
    return any(payload.get(key) is True for key in PENDING_KEYS)


def close_reason_for(kind: str, end_signal: str | None, waiting: bool | None, broken: bool) -> str:
    """The close-out rule. `clean-end` credits; the other three never do. An unknown terminal
    (or evidence that is gone) is judged first, then a coverage gap, then a pending approval or
    question at the end."""
    if end_signal not in KNOWN_TERMINALS.get(kind, frozenset()) or waiting is None:
        return UNKNOWN_TERMINAL
    if broken:
        return COVERAGE_GAP
    return WAITING_AT_END if waiting else CLEAN_END


def _insert_open(conn: sqlite3.Connection, found: _Candidate, event_ms: int) -> str:
    task_id = task_id_for(found.attempt_id)
    ended = None if found.running else _ended_ms(found)
    conn.execute(
        "INSERT INTO task (task_id, attempt_id, binding_id, kind, started_ms, ended_ms, running,"
        " end_signal, state, created_ms, updated_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)",
        (
            task_id,
            found.attempt_id,
            found.binding_id,
            found.kind,
            found.started_ms,
            ended,
            int(found.running),
            None if found.running else found.end_signal,
            event_ms,
            event_ms,
        ),
    )
    return task_id


def _ended_ms(found: _Candidate) -> int:
    ended = found.started_ms if found.ended_ms is None else found.ended_ms
    return max(ended, found.started_ms)


def _reopen_running(conn: sqlite3.Connection, task_id: str, now_ms: int) -> None:
    """The attempt runs again. A `credited` task keeps its close-out; a `not-credited` one opens
    and is judged again at its next end."""
    conn.execute(
        "UPDATE task SET running = 1, ended_ms = NULL, end_signal = NULL,"
        " updated_ms = max(updated_ms, ?),"
        " state = CASE WHEN state = 'not-credited' THEN 'open' ELSE state END,"
        " close_reason = CASE WHEN state = 'not-credited' THEN NULL ELSE close_reason END,"
        " closed_ms = CASE WHEN state = 'not-credited' THEN NULL ELSE closed_ms END,"
        " waiting_at_end = CASE WHEN state = 'not-credited' THEN NULL ELSE waiting_at_end END,"
        " gap_overlap = CASE WHEN state = 'not-credited' THEN NULL ELSE gap_overlap END"
        " WHERE task_id = ?",
        (now_ms, task_id),
    )


def _record_end(conn: sqlite3.Connection, task_id: str, found: _Candidate, ended: int) -> None:
    """Store the attempt's end on its task and put any task that is not `credited` back to open
    for judging. A `credited` task keeps its close-out and moves only its times."""
    conn.execute(
        "UPDATE task SET running = 0, ended_ms = ?, end_signal = ?,"
        " updated_ms = max(updated_ms, ?),"
        " state = CASE WHEN state = 'credited' THEN state ELSE 'open' END,"
        " close_reason = CASE WHEN state = 'credited' THEN close_reason ELSE NULL END,"
        " closed_ms = CASE WHEN state = 'credited' THEN closed_ms ELSE NULL END,"
        " waiting_at_end = CASE WHEN state = 'credited' THEN waiting_at_end ELSE NULL END,"
        " gap_overlap = CASE WHEN state = 'credited' THEN gap_overlap ELSE NULL END"
        " WHERE task_id = ?",
        (ended, found.end_signal, ended, task_id),
    )


def _close_out(
    conn: sqlite3.Connection, task_id: str, found: _Candidate, ended: int, cover: _Coverage
) -> None:
    waiting = _waiting_at_end(conn, found)
    broken = cover.broken(found.started_ms, ended)
    reason = close_reason_for(found.kind, found.end_signal, waiting, broken)
    if reason == CLEAN_END:
        conn.execute(
            "INSERT INTO task_xp_entry (entry_id, task_id, binding_id, amount, policy_version,"
            " created_ms) VALUES (?, ?, ?, ?, ?, ?)",
            (
                entry_id_for(task_id),
                task_id,
                found.binding_id,
                task_bounty(ended - found.started_ms),
                TASK_POLICY_VERSION,
                ended,
            ),
        )
    conn.execute(
        "UPDATE task SET state = ?, close_reason = ?, closed_ms = ?, waiting_at_end = ?,"
        " gap_overlap = ?, updated_ms = max(updated_ms, ?) WHERE task_id = ?",
        (
            CREDITED if reason == CLEAN_END else NOT_CREDITED,
            reason,
            ended,
            None if waiting is None else int(waiting),
            int(broken),
            ended,
            task_id,
        ),
    )


def sweep_tasks(conn: sqlite3.Connection, now_ms: int) -> int:
    """Create, update and close tasks from the `attempt` projection; the number of tasks touched.

    Idempotent: a second sweep over the same store with the same clock writes nothing. It runs on
    the caller's connection and transaction (after an applied ingest batch, on a heartbeat, and
    at boot), reads only the store, and does nothing while the collector is paused.
    """
    paused = conn.execute("SELECT paused FROM collector_setting").fetchone()
    if paused is not None and paused[0]:
        return 0
    found = [
        _Candidate(
            attempt_id=str(r[0]),
            binding_id=str(r[1]),
            kind=str(r[2]),
            slot_key=str(r[3]),
            started_ms=int(r[4]),
            ended_ms=None if r[5] is None else int(r[5]),
            ended_seq=None if r[6] is None else int(r[6]),
            end_signal=None if r[7] is None else str(r[7]),
            running=bool(r[8]),
            task_id=None if r[9] is None else str(r[9]),
            task_state=None if r[10] is None else str(r[10]),
        )
        for r in conn.execute(_CANDIDATES, {"now": now_ms, "min": BOT_TURN_TASK_MIN_MS})
    ]
    if not found:
        return 0
    cover = _Coverage(conn, min(item.started_ms for item in found), now_ms)
    for item in found:
        _apply(conn, item, now_ms, cover)
    return len(found)


def _apply(conn: sqlite3.Connection, item: _Candidate, now_ms: int, cover: _Coverage) -> None:
    if item.running:
        if item.task_id is None:
            _insert_open(conn, item, max(now_ms, item.started_ms))
        else:
            _reopen_running(conn, item.task_id, max(now_ms, item.started_ms))
        return
    ended = _ended_ms(item)
    task_id = item.task_id or _insert_open(conn, item, ended)
    if item.task_id is not None:
        _record_end(conn, task_id, item, ended)
    if item.task_state != CREDITED:
        _close_out(conn, task_id, item, ended, cover)


def sweep_guarded(conn: sqlite3.Connection, now_ms: int) -> None:
    """`sweep_tasks` under a savepoint: a failing sweep rolls back only itself, so it can never
    lose the ingest batch or heartbeat it rides on. Logged by exception type only."""
    conn.execute("SAVEPOINT task_sweep")
    try:
        sweep_tasks(conn, now_ms)
    except (sqlite3.Error, ValueError) as error:
        conn.execute("ROLLBACK TO task_sweep")
        _LOG.warning("task sweep failed: %s", type(error).__name__)
    conn.execute("RELEASE task_sweep")


def run_sweep(store: Store, now_ms: int) -> int:
    """One sweep in its own write transaction (boot, and tests); the number of tasks touched."""
    if not is_time_ms(now_ms):
        raise StoreUsageError("time")
    with translate_errors(), store.write() as conn:
        return sweep_tasks(conn, now_ms)


# ---- reads ----------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class TaskView:
    """One task as the wire needs it: the stored close-out plus the clock-dependent fields."""

    task_id: str
    binding_id: str
    attempt_id: str
    kind: str
    state: str
    attempt_state: AttemptState
    close_reason: str | None
    started_ms: int
    ended_ms: int | None
    closed_ms: int | None
    updated_ms: int
    run_ms: int
    size_class: str
    xp_credited: int | None
    policy_version: str


_SELECT = """
SELECT t.task_id, t.binding_id, t.attempt_id, t.kind, t.state, t.close_reason, t.started_ms,
       t.ended_ms, t.closed_ms, t.updated_ms, t.running, x.amount, k.last_seen_ms
FROM task t
LEFT JOIN task_xp_entry x ON x.task_id = t.task_id
LEFT JOIN attempt a ON a.attempt_id = t.attempt_id
LEFT JOIN slot_seen k ON k.binding_id = t.binding_id AND k.slot_key = a.slot_key
"""

_PAGE_SQL = (
    _SELECT
    + """
WHERE (:state IS NULL OR t.state = :state) AND (:binding IS NULL OR t.binding_id = :binding)
  AND (:after_ms IS NULL OR t.updated_ms < :after_ms
       OR (t.updated_ms = :after_ms AND t.task_id < :after_id))
ORDER BY t.updated_ms DESC, t.task_id DESC
LIMIT :n
"""
)


def _view(row: Any, feed: Feed, as_of_ms: int) -> TaskView:
    started = int(row[6])
    ended = None if row[7] is None else int(row[7])
    now_state: AttemptState = "ended"
    if row[10]:
        seen = None if row[12] is None else int(row[12])
        now_state, _ = attempt_state(True, None, seen, feed)
    run_ms = max(0, (as_of_ms if ended is None else ended) - started)
    return TaskView(
        task_id=str(row[0]),
        binding_id=str(row[1]),
        attempt_id=str(row[2]),
        kind=str(row[3]),
        state=str(row[4]),
        attempt_state=now_state,
        close_reason=None if row[5] is None else str(row[5]),
        started_ms=started,
        ended_ms=ended,
        closed_ms=None if row[8] is None else int(row[8]),
        updated_ms=int(row[9]),
        run_ms=run_ms,
        size_class=size_class(run_ms),
        xp_credited=None if row[11] is None else int(row[11]),
        policy_version=TASK_POLICY_VERSION,
    )


def _after(cursor: str | None) -> tuple[int | None, str | None]:
    if cursor is None:
        return None, None
    updated_ms, task_id = decode_cursor(cursor, 2)
    if (
        not isinstance(updated_ms, int)
        or updated_ms < 0
        or not isinstance(task_id, str)
        or _TASK_ID.fullmatch(task_id) is None
    ):
        raise InvalidCursor
    return updated_ms, task_id


def task_page(
    store: Store,
    *,
    state: str | None,
    binding_id: str | None,
    cursor: str | None,
    limit: int | None,
    as_of_ms: int,
) -> Page[TaskView]:
    """Tasks newest `updated_ms` first, one read transaction; `as_of_ms` is the only clock."""
    if state is not None and state not in STATES:
        raise StoreUsageError("state")
    if not is_time_ms(as_of_ms) or as_of_ms < 1:
        raise StoreUsageError("as_of_ms must be a positive integer")
    size = clamp_limit(limit, default=MAX_TASKS_PAGE, maximum=MAX_TASKS_PAGE)
    after_ms, after_id = _after(cursor)
    with translate_errors(), store.read() as conn:
        feed = feed_coverage(conn, as_of_ms)
        rows = conn.execute(
            _PAGE_SQL,
            {
                "state": state,
                "binding": binding_id,
                "after_ms": after_ms,
                "after_id": after_id,
                "n": size + 1,
            },
        ).fetchall()
    views = [_view(row, feed, as_of_ms) for row in rows]
    return build_page(views, size, lambda v: (v.updated_ms, v.task_id))


def get_task(store: Store, task_id: str, *, as_of_ms: int) -> TaskView:
    """One task, or `UnknownTask`."""
    if not isinstance(task_id, str) or _TASK_ID.fullmatch(task_id) is None:
        raise UnknownTask
    if not is_time_ms(as_of_ms) or as_of_ms < 1:
        raise StoreUsageError("as_of_ms must be a positive integer")
    with translate_errors(), store.read() as conn:
        feed = feed_coverage(conn, as_of_ms)
        row = conn.execute(_SELECT + " WHERE t.task_id = ?", (task_id,)).fetchone()
    if row is None:
        raise UnknownTask
    return _view(row, feed, as_of_ms)
