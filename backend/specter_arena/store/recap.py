from __future__ import annotations

import sqlite3
from collections.abc import Iterable
from dataclasses import dataclass

from .attempts import _effective_end
from .errors import StoreUsageError
from .guard import translate_errors
from .lifecycle import purge_horizon
from .roster import feed_coverage
from .store import Store
from .tasks import _SELECT, TaskView, _view
from .validate import is_time_ms

RECAP_TASK_CAP = 1000

COVERED = "covered"
NOT_COLLECTED = "not-collected"
COLLECTING = "collecting"
PAUSED = "paused"
COLLECTOR_GAP = "collector-gap"
NO_COLLECTOR = "no-collector"
BEFORE_FIRST_RUN = "before-first-run"
PURGED = "purged"

# (state, reason, from_ms, to_ms)
Span = tuple[str, str, int, int]

# A task overlaps the period when it starts before the period ends and either is still running,
# ends after the period starts, or starts inside the period (a task of zero length on the
# boundary belongs to the period that starts there).
_TASKS_WHERE = """
WHERE t.started_ms < :to
  AND (t.ended_ms IS NULL OR t.ended_ms > :from OR t.started_ms >= :from)
"""
_TASKS_SQL = _SELECT + _TASKS_WHERE + "ORDER BY t.started_ms, t.task_id LIMIT :n"
_COUNT_SQL = "SELECT count(*) FROM task t" + _TASKS_WHERE

_INTERVALS = """
SELECT ci.state, ci.start_ms, ci.end_ms, ci.reason, r.last_heartbeat_ms
FROM coverage_interval ci JOIN collector_run r ON r.run_id = ci.run_id
WHERE ci.start_ms < :to AND (ci.end_ms IS NULL OR ci.end_ms >= :from)
"""


@dataclass(frozen=True, slots=True)
class RecapResult:
    as_of_ms: int
    from_ms: int
    to_ms: int
    tasks: list[TaskView]
    truncated: bool
    omitted: int
    first_run_ms: int | None
    purge_horizon_ms: int | None
    spans: list[Span]


def gap_reason(stored: str | None) -> str:
    """The wire reason for a stored gap reason. Only a pause is named; every other stored reason,
    whatever its text, reads as `collector-gap`, so stored free text never reaches the wire."""
    return PAUSED if stored == "paused" else COLLECTOR_GAP


def _inside(spans: Iterable[tuple[int, int]], start: int, end: int) -> bool:
    return any(s <= start and end <= e for s, e in spans)


def _classify(
    start: int,
    end: int,
    first_run_ms: int | None,
    horizon_ms: int | None,
    covered: list[tuple[int, int]],
    gaps: list[tuple[int, int, str]],
) -> tuple[str, str]:
    if horizon_ms is not None and end <= horizon_ms:
        return NOT_COLLECTED, PURGED
    if first_run_ms is not None and end <= first_run_ms:
        return NOT_COLLECTED, BEFORE_FIRST_RUN
    reasons = {reason for s, e, reason in gaps if s <= start and end <= e}
    if PAUSED in reasons:
        return NOT_COLLECTED, PAUSED
    if reasons:
        return NOT_COLLECTED, COLLECTOR_GAP
    if _inside(covered, start, end):
        return COVERED, COLLECTING
    return NOT_COLLECTED, NO_COLLECTOR


def partition_spans(
    from_ms: int,
    to_ms: int,
    *,
    first_run_ms: int | None,
    horizon_ms: int | None,
    covered: list[tuple[int, int]],
    gaps: list[tuple[int, int, str]],
) -> list[Span]:
    """Split `[from_ms, to_ms]` into consecutive spans that are covered or not collected, with no
    gap and no overlap. Precedence: purged, before the first run, a pause, another gap, covered,
    and otherwise no collector. Neighbouring spans with the same state and reason are merged."""
    cuts = {from_ms, to_ms}
    for edge in (horizon_ms, first_run_ms):
        if edge is not None:
            cuts.add(edge)
    for s, e in covered:
        cuts.update((s, e))
    for s, e, _ in gaps:
        cuts.update((s, e))
    points = sorted(point for point in cuts if from_ms <= point <= to_ms)
    spans: list[Span] = []
    for start, end in zip(points, points[1:], strict=False):
        state, reason = _classify(start, end, first_run_ms, horizon_ms, covered, gaps)
        if spans and spans[-1][:2] == (state, reason):
            spans[-1] = (state, reason, spans[-1][2], end)
        else:
            spans.append((state, reason, start, end))
    return spans


def _intervals(
    conn: sqlite3.Connection, from_ms: int, to_ms: int, as_of_ms: int
) -> tuple[list[tuple[int, int]], list[tuple[int, int, str]]]:
    covered: list[tuple[int, int]] = []
    gaps: list[tuple[int, int, str]] = []
    for state, start, end, stored, beat in conn.execute(_INTERVALS, {"from": from_ms, "to": to_ms}):
        stop = _effective_end(str(state), int(start), end, int(beat), as_of_ms)
        if stop <= int(start):
            continue
        if state == "gap":
            gaps.append((int(start), stop, gap_reason(stored)))
        else:
            covered.append((int(start), stop))
    return covered, gaps


def recap_tasks(store: Store, from_ms: int, to_ms: int, as_of_ms: int) -> RecapResult:
    """The tasks that overlap `[from_ms, to_ms]` (earliest start first, at most `RECAP_TASK_CAP`)
    and what the collector covered in that period, from one read transaction. Writes nothing."""
    if not all(is_time_ms(value) for value in (from_ms, to_ms, as_of_ms)):
        raise StoreUsageError("time")
    if not from_ms < to_ms <= as_of_ms:
        raise StoreUsageError("period")
    params = {"from": from_ms, "to": to_ms}
    with translate_errors(), store.read() as conn:
        feed = feed_coverage(conn, as_of_ms)
        rows = conn.execute(_TASKS_SQL, {**params, "n": RECAP_TASK_CAP + 1}).fetchall()
        omitted = 0
        if len(rows) > RECAP_TASK_CAP:
            omitted = int(conn.execute(_COUNT_SQL, params).fetchone()[0]) - RECAP_TASK_CAP
            rows = rows[:RECAP_TASK_CAP]
        first = conn.execute("SELECT min(started_ms) FROM collector_run").fetchone()[0]
        first_run_ms = None if first is None else int(first)
        horizon_ms = purge_horizon(conn)
        covered, gaps = _intervals(conn, from_ms, to_ms, as_of_ms)
    return RecapResult(
        as_of_ms=as_of_ms,
        from_ms=from_ms,
        to_ms=to_ms,
        tasks=[_view(row, feed, as_of_ms) for row in rows],
        truncated=omitted > 0,
        omitted=omitted,
        first_run_ms=first_run_ms,
        purge_horizon_ms=horizon_ms,
        spans=partition_spans(
            from_ms,
            to_ms,
            first_run_ms=first_run_ms,
            horizon_ms=horizon_ms,
            covered=covered,
            gaps=gaps,
        ),
    )
