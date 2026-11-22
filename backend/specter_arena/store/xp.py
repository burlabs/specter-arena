from __future__ import annotations

import re
import secrets
import sqlite3
from collections.abc import Mapping
from dataclasses import dataclass

from .errors import InvalidCursor, StoreUsageError, UnknownBinding
from .guard import translate_errors
from .paging import MAX_LIMIT, Page, build_page, clamp_limit, decode_cursor
from .store import Store
from .xp_policy import LEVEL_TABLE_VERSION, POLICY_VERSION, TASK_POLICY_VERSION, level_for

MAX_SUMMARIES = 500
MAX_HISTORY_PAGE = 50
MAX_SUMMARY_PAGE = MAX_LIMIT
AWARD = "award"
CORRECTION = "correction"
REINSTATEMENT = "reinstatement"

_BINDING_ID = re.compile(r"bnd_[0-9a-f]{24}")
_ENTRY_ID = re.compile(r"xpe_[0-9a-f]{24}")


@dataclass(frozen=True, slots=True)
class XpSummary:
    """One binding's progression, derived from ledger entries at read time (never stored)."""

    binding_id: str
    total_xp: int
    level: int
    level_floor_xp: int
    next_level_xp: int | None
    accepted_work_count: int
    policy_version: str
    level_table_version: str


@dataclass(frozen=True, slots=True)
class XpSummaryV2:
    """One binding's progression over both ledgers (`xp-policy-1` entries and `xp-policy-2` task
    awards), derived at read time. `accepted_work_count` counts legacy work only."""

    binding_id: str
    total_xp: int
    level: int
    level_floor_xp: int
    next_level_xp: int | None
    accepted_work_count: int
    credited_task_count: int
    policy_version: str
    level_table_version: str


@dataclass(frozen=True, slots=True)
class XpEntryView:
    entry_id: str
    work_id: str
    work_title: str
    kind: str
    amount: int
    policy_version: str
    decision_id: str
    created_ms: int


@dataclass(frozen=True, slots=True)
class XpHistory:
    summary: XpSummary
    page: Page[XpEntryView]


def new_entry_id() -> str:
    return "xpe_" + secrets.token_hex(12)


def _summary(binding_id: str, total: int, accepted: int) -> XpSummary:
    level, floor, following = level_for(total)
    return XpSummary(
        binding_id=binding_id,
        total_xp=total,
        level=level,
        level_floor_xp=floor,
        next_level_xp=following,
        accepted_work_count=accepted,
        policy_version=POLICY_VERSION,
        level_table_version=LEVEL_TABLE_VERSION,
    )


_ACCEPTED_COUNT_SQL = (
    "SELECT count(*) FROM (SELECT work_id FROM xp_entry WHERE binding_id = ?"
    " GROUP BY work_id HAVING sum(amount) > 0)"
)


def _binding_summary(conn: sqlite3.Connection, binding_id: str) -> XpSummary:
    known = conn.execute("SELECT 1 FROM bot_binding WHERE binding_id = ?", (binding_id,)).fetchone()
    if known is None:
        raise UnknownBinding
    total = conn.execute(
        "SELECT COALESCE(sum(amount), 0) FROM xp_entry WHERE binding_id = ?", (binding_id,)
    ).fetchone()[0]
    accepted = conn.execute(_ACCEPTED_COUNT_SQL, (binding_id,)).fetchone()[0]
    return _summary(binding_id, int(total), int(accepted))


def _need_binding(binding_id: object) -> str:
    if not isinstance(binding_id, str) or _BINDING_ID.fullmatch(binding_id) is None:
        raise StoreUsageError("binding id")
    return binding_id


def xp_summary(store: Store, binding_id: str) -> XpSummary:
    """Totals for one binding; a binding with no entries is level 1 with 0 XP."""
    _need_binding(binding_id)
    with translate_errors(), store.read() as conn:
        return _binding_summary(conn, binding_id)


def xp_summaries(store: Store) -> tuple[XpSummary, ...]:
    """Bindings with at least one ledger entry, ordered by binding id, at most 500."""
    with translate_errors(), store.read() as conn:
        rows = conn.execute(
            "SELECT e.binding_id, sum(e.amount),"
            " (SELECT count(*) FROM (SELECT work_id FROM xp_entry WHERE binding_id = e.binding_id"
            "  GROUP BY work_id HAVING sum(amount) > 0))"
            " FROM xp_entry e GROUP BY e.binding_id ORDER BY e.binding_id LIMIT ?",
            (MAX_SUMMARIES,),
        ).fetchall()
    return tuple(_summary(str(b), int(total), int(count)) for b, total, count in rows)


def _summary_after(cursor: str | None) -> str | None:
    if cursor is None:
        return None
    (binding_id,) = decode_cursor(cursor, 1)
    if not isinstance(binding_id, str) or _BINDING_ID.fullmatch(binding_id) is None:
        raise InvalidCursor
    return binding_id


_SUMMARIES_PAGE_SQL = """
SELECT e.binding_id, sum(e.amount),
  (SELECT count(*) FROM (SELECT work_id FROM xp_entry WHERE binding_id = e.binding_id
   GROUP BY work_id HAVING sum(amount) > 0))
FROM xp_entry e
WHERE (:after IS NULL OR e.binding_id > :after)
GROUP BY e.binding_id
ORDER BY e.binding_id
LIMIT :n
"""


def xp_summaries_page(store: Store, *, cursor: str | None, limit: int | None) -> Page[XpSummary]:
    """Bindings with at least one ledger entry, ascending by binding id, `MAX_SUMMARY_PAGE` a
    page at most. Same membership and values as `xp_summaries`, with no 500 cap: a binding
    whose id sorts after the cursor is always on a later page."""
    size = clamp_limit(limit, default=MAX_SUMMARY_PAGE, maximum=MAX_SUMMARY_PAGE)
    after = _summary_after(cursor)
    with translate_errors(), store.read() as conn:
        rows = conn.execute(_SUMMARIES_PAGE_SQL, {"after": after, "n": size + 1}).fetchall()
    views = [_summary(str(b), int(total), int(count)) for b, total, count in rows]
    return build_page(views, size, lambda v: (v.binding_id,))


def _summary_v2(binding_id: str, total: int, accepted: int, credited_tasks: int) -> XpSummaryV2:
    level, floor, following = level_for(total)
    return XpSummaryV2(
        binding_id=binding_id,
        total_xp=total,
        level=level,
        level_floor_xp=floor,
        next_level_xp=following,
        accepted_work_count=accepted,
        credited_task_count=credited_tasks,
        policy_version=TASK_POLICY_VERSION,
        level_table_version=LEVEL_TABLE_VERSION,
    )


# Bindings with an entry in either ledger. `acc` counts legacy work with net XP above zero;
# the two totals add because a task award is never negative and never corrected.
_SUMMARIES_V2_SQL = """
WITH members AS (
  SELECT binding_id FROM xp_entry UNION SELECT binding_id FROM task_xp_entry
)
SELECT m.binding_id,
  COALESCE((SELECT sum(amount) FROM xp_entry WHERE binding_id = m.binding_id), 0)
    + COALESCE((SELECT sum(amount) FROM task_xp_entry WHERE binding_id = m.binding_id), 0),
  (SELECT count(*) FROM (SELECT work_id FROM xp_entry WHERE binding_id = m.binding_id
   GROUP BY work_id HAVING sum(amount) > 0)),
  (SELECT count(*) FROM task_xp_entry WHERE binding_id = m.binding_id)
FROM members m
WHERE (:after IS NULL OR m.binding_id > :after)
ORDER BY m.binding_id
LIMIT :n
"""


def xp_summaries_v2_page(
    store: Store, *, cursor: str | None, limit: int | None
) -> Page[XpSummaryV2]:
    """Bindings with at least one entry in either ledger, ascending by binding id,
    `MAX_SUMMARY_PAGE` a page at most, totals over both ledgers (`xp-summaries.v3`)."""
    size = clamp_limit(limit, default=MAX_SUMMARY_PAGE, maximum=MAX_SUMMARY_PAGE)
    after = _summary_after(cursor)
    with translate_errors(), store.read() as conn:
        rows = conn.execute(_SUMMARIES_V2_SQL, {"after": after, "n": size + 1}).fetchall()
    views = [_summary_v2(str(b), int(total), int(acc), int(tasks)) for b, total, acc, tasks in rows]
    return build_page(views, size, lambda v: (v.binding_id,))


def _after(cursor: str | None) -> tuple[int | None, str | None]:
    if cursor is None:
        return None, None
    created_ms, entry_id = decode_cursor(cursor, 2)
    if (
        not isinstance(created_ms, int)
        or created_ms < 0
        or not isinstance(entry_id, str)
        or _ENTRY_ID.fullmatch(entry_id) is None
    ):
        raise InvalidCursor
    return created_ms, entry_id


_HISTORY_SQL = """
SELECT e.entry_id, e.work_id, w.title, e.kind, e.amount, e.policy_version, e.decision_id,
       e.created_ms
FROM xp_entry e JOIN work_item w ON w.work_id = e.work_id
WHERE e.binding_id = :binding
  AND (:after_ms IS NULL OR e.created_ms < :after_ms
       OR (e.created_ms = :after_ms AND e.entry_id < :after_id))
ORDER BY e.created_ms DESC, e.entry_id DESC
LIMIT :n
"""


def xp_history(
    store: Store, binding_id: str, *, cursor: str | None, limit: int | None
) -> XpHistory:
    """The binding's ledger entries newest first, with the summary read in the same snapshot."""
    _need_binding(binding_id)
    size = clamp_limit(limit, default=MAX_HISTORY_PAGE, maximum=MAX_HISTORY_PAGE)
    after_ms, after_id = _after(cursor)
    with translate_errors(), store.read() as conn:
        summary = _binding_summary(conn, binding_id)
        rows = conn.execute(
            _HISTORY_SQL,
            {"binding": binding_id, "after_ms": after_ms, "after_id": after_id, "n": size + 1},
        ).fetchall()
    views = [
        XpEntryView(
            str(r[0]), str(r[1]), str(r[2]), str(r[3]), int(r[4]), str(r[5]), str(r[6]), int(r[7])
        )
        for r in rows
    ]
    return XpHistory(summary, build_page(views, size, lambda v: (v.created_ms, v.entry_id)))


def _insert(
    conn: sqlite3.Connection,
    *,
    work_id: str,
    binding_id: str,
    seq: int,
    kind: str,
    amount: int,
    decision_id: str,
    at_ms: int,
) -> None:
    conn.execute(
        "INSERT INTO xp_entry (entry_id, work_id, binding_id, seq, kind, amount, policy_version,"
        " decision_id, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            new_entry_id(),
            work_id,
            binding_id,
            seq,
            kind,
            amount,
            POLICY_VERSION,
            decision_id,
            at_ms,
        ),
    )


def last_entries(conn: sqlite3.Connection, work_id: str) -> dict[str, tuple[int, str, int]]:
    """binding id -> (seq, kind, amount) of that binding's newest entry for the item."""
    rows = conn.execute(
        "SELECT e.binding_id, e.seq, e.kind, e.amount FROM xp_entry e WHERE e.work_id = ?"
        " AND e.seq = (SELECT max(seq) FROM xp_entry WHERE work_id = e.work_id"
        " AND binding_id = e.binding_id) ORDER BY e.binding_id",
        (work_id,),
    ).fetchall()
    return {str(b): (int(s), str(k), int(a)) for b, s, k, a in rows}


def has_awards(conn: sqlite3.Connection, work_id: str) -> bool:
    return (
        conn.execute(
            "SELECT 1 FROM xp_entry WHERE work_id = ? AND kind = 'award' LIMIT 1", (work_id,)
        ).fetchone()
        is not None
    )


def write_awards(
    conn: sqlite3.Connection,
    *,
    work_id: str,
    decision_id: str,
    shares: Mapping[str, int],
    at_ms: int,
) -> int:
    """One `award` per contributor with a positive share, in sorted binding order."""
    written = 0
    for binding_id in sorted(shares):
        if shares[binding_id] > 0:
            _insert(
                conn,
                work_id=work_id,
                binding_id=binding_id,
                seq=1,
                kind=AWARD,
                amount=shares[binding_id],
                decision_id=decision_id,
                at_ms=at_ms,
            )
            written += 1
    return written


def write_reinstatements(
    conn: sqlite3.Connection, *, work_id: str, decision_id: str, at_ms: int
) -> int:
    """Re-accepting writes the original award back for every contributor whose last entry is a
    correction. It never writes a new amount."""
    written = 0
    for binding_id, (seq, kind, _amount) in last_entries(conn, work_id).items():
        if kind != CORRECTION:
            continue
        original = conn.execute(
            "SELECT amount FROM xp_entry WHERE work_id = ? AND binding_id = ? AND seq = 1",
            (work_id, binding_id),
        ).fetchone()[0]
        _insert(
            conn,
            work_id=work_id,
            binding_id=binding_id,
            seq=seq + 1,
            kind=REINSTATEMENT,
            amount=int(original),
            decision_id=decision_id,
            at_ms=at_ms,
        )
        written += 1
    return written


def write_corrections(
    conn: sqlite3.Connection, *, work_id: str, decision_id: str, at_ms: int
) -> int:
    """Reopening an accepted item takes back exactly what each contributor holds (net > 0)."""
    written = 0
    for binding_id, (seq, kind, amount) in last_entries(conn, work_id).items():
        if kind in (AWARD, REINSTATEMENT):
            _insert(
                conn,
                work_id=work_id,
                binding_id=binding_id,
                seq=seq + 1,
                kind=CORRECTION,
                amount=-amount,
                decision_id=decision_id,
                at_ms=at_ms,
            )
            written += 1
    return written
