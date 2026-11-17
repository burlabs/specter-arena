from __future__ import annotations

import sqlite3
from typing import Any, Literal

from .errors import InvalidCursor, StoreUsageError
from .guard import translate_errors
from .paging import Page, build_page, clamp_limit, decode_cursor
from .records import (
    HEARTBEAT_STALE_MS,
    BindingRecord,
    BotFacts,
    CoverageView,
    Presence,
    QuarantineRecord,
    RosterRow,
)
from .store import Store
from .validate import is_time_ms

CoverageState = Literal["covered", "gap", "unknown"]
HEARTBEAT_STALE_REASON = "heartbeat-stale"


def roster_revision(store: Store) -> int:
    """The roster change counter. Read it before `roster_page`, so the page is at least as new."""
    with translate_errors(), store.read() as conn:
        return int(conn.execute("SELECT revision FROM collector_setting").fetchone()[0])


class _Feed:
    """The collector feed's coverage at `as_of_ms`, from its newest run (read rule 1)."""

    __slots__ = ("covered_since_ms", "open_gap_count", "reason", "since_ms", "state")

    def __init__(
        self,
        state: CoverageState,
        reason: str | None,
        since_ms: int | None,
        open_gap_count: int,
        covered_since_ms: int | None,
    ) -> None:
        self.state = state
        self.reason = reason
        self.since_ms = since_ms
        self.open_gap_count = open_gap_count
        self.covered_since_ms = covered_since_ms

    def view(self) -> CoverageView:
        return CoverageView(self.state, self.reason, self.since_ms, self.open_gap_count)


def _feed_coverage(conn: sqlite3.Connection, as_of_ms: int) -> _Feed:
    run = conn.execute(
        "SELECT run_id, last_heartbeat_ms, (SELECT count(*) FROM collector_run) FROM collector_run"
        " ORDER BY started_ms DESC, rowid DESC LIMIT 1"
    ).fetchone()
    if run is None:
        return _Feed("unknown", None, None, 0, None)
    run_id, heartbeat_ms, run_count = run
    covered = conn.execute(
        "SELECT start_ms FROM coverage_interval"
        " WHERE run_id = ? AND state = 'covered' AND end_ms IS NULL",
        (run_id,),
    ).fetchone()
    if covered is not None:
        if as_of_ms - heartbeat_ms > HEARTBEAT_STALE_MS:
            return _Feed("unknown", HEARTBEAT_STALE_REASON, heartbeat_ms, 0, None)
        return _Feed("covered", None, covered[0], 0, covered[0])
    gap = conn.execute(
        "SELECT start_ms, reason FROM coverage_interval"
        " WHERE run_id = ? AND state = 'gap' AND end_ms IS NULL",
        (run_id,),
    ).fetchone()
    if gap is not None:
        return _Feed("gap", gap[1], gap[0], 1, None)
    return _Feed("unknown", "restart" if run_count > 1 else None, None, 0, None)


def _bot_coverage(feed: _Feed, last_seen_ms: int | None) -> CoverageView:
    """Read rules 2 and 3: a covered feed still has to have shown this bot's DM slot."""
    if feed.state != "covered" or feed.covered_since_ms is None:
        return feed.view()
    if last_seen_ms is None:
        return CoverageView("unknown", "no-slot-yet", feed.covered_since_ms, 0)
    if last_seen_ms < feed.covered_since_ms:
        return CoverageView("unknown", "feed-absent", feed.covered_since_ms, 0)
    return CoverageView("covered", None, feed.covered_since_ms, 0)


_ROSTER_SQL = """
SELECT b.binding_seq, b.binding_id,
  (SELECT r.name FROM bot_display_revision r WHERE r.binding_id = b.binding_id
     ORDER BY r.revision_no DESC LIMIT 1),
  (SELECT r.display_name FROM bot_display_revision r WHERE r.binding_id = b.binding_id
     ORDER BY r.revision_no DESC LIMIT 1),
  (SELECT r.avatar_kind FROM bot_display_revision r WHERE r.binding_id = b.binding_id
     ORDER BY r.revision_no DESC LIMIT 1),
  (SELECT r.avatar_ref FROM bot_display_revision r WHERE r.binding_id = b.binding_id
     ORDER BY r.revision_no DESC LIMIT 1),
  (SELECT p.state FROM bot_presence p WHERE p.binding_id = b.binding_id
     ORDER BY p.presence_id DESC LIMIT 1),
  (SELECT p.since_ms FROM bot_presence p WHERE p.binding_id = b.binding_id
     ORDER BY p.presence_id DESC LIMIT 1),
  s.binding_id, s.running, s.turn, s.turn_gen, s.pending_approval, s.needs_input, s.has_options,
  s.waiting_for_input, s.interrupted, s.last_activity_ms, s.row_observed_ms, s.event_observed_ms,
  (SELECT k.last_seen_ms FROM slot_seen k
     WHERE k.binding_id = b.binding_id AND k.slot_key = b.dm_key),
  (SELECT count(*) FROM attempt a WHERE a.binding_id = b.binding_id AND a.kind = 'worker'),
  (SELECT count(*) FROM attempt a JOIN slot_seen k
       ON k.binding_id = a.binding_id AND k.slot_key = a.slot_key
     WHERE a.binding_id = b.binding_id AND a.kind = 'worker' AND a.running = 1
       AND k.last_seen_ms >= ?)
FROM bot_binding b LEFT JOIN bot_state s ON s.binding_id = b.binding_id
WHERE b.binding_seq > ? ORDER BY b.binding_seq LIMIT ?
"""


def _flag(value: object) -> bool | None:
    return None if value is None else bool(value)


def _facts(row: tuple[Any, ...]) -> BotFacts | None:
    """Facts exist once a DM row has been stored; events alone say nothing about `running`."""
    if row[18] is None:
        return None
    return BotFacts(
        running=_flag(row[9]),
        turn=row[10],
        turn_gen=row[11],
        pending_approval=_flag(row[12]),
        needs_input=_flag(row[13]),
        has_options=_flag(row[14]),
        waiting_for_input=_flag(row[15]),
        interrupted=_flag(row[16]),
        last_activity_ms=row[17],
        row_observed_ms=row[18],
        event_observed_ms=row[19],
    )


def _presence(state: object) -> Presence:
    if state is None:
        return "unknown"
    return "present" if state == "present" else "absent"


def _last_observed(row: tuple[Any, ...]) -> int | None:
    seen = [value for value in (row[18], row[19]) if isinstance(value, int)]
    return max(seen) if seen else None


def roster_page(store: Store, *, cursor: str | None, limit: int, as_of_ms: int) -> Page[RosterRow]:
    """One page of bots with stored facts and coverage, ordered by `binding_seq`.

    `as_of_ms` is the only clock: heartbeat staleness is judged against it, so a caller (and a
    test) controls time. The page is built inside one read transaction.
    """
    if not is_time_ms(as_of_ms):
        raise StoreUsageError("as_of_ms must be a non-negative integer")
    size = clamp_limit(limit)
    after = 0
    if cursor is not None:
        (value,) = decode_cursor(cursor, 1)
        if not isinstance(value, int):
            raise InvalidCursor
        after = value
    with translate_errors(), store.read() as conn:
        feed = _feed_coverage(conn, as_of_ms)
        covered_since = feed.covered_since_ms if feed.state == "covered" else 2**62
        fetched = [
            tuple(row) for row in conn.execute(_ROSTER_SQL, (covered_since, after, size + 1))
        ]
    rows = [
        RosterRow(
            binding_id=str(row[1]),
            binding_seq=int(row[0]),
            display_name=row[3],
            name=row[2],
            avatar_kind=row[4],
            avatar_ref=row[5],
            presence=_presence(row[6]),
            presence_since_ms=row[7],
            facts=_facts(row),
            coverage=_bot_coverage(feed, row[20]),
            last_observed_ms=_last_observed(row),
            workers_running=int(row[22]) if feed.state == "covered" else 0,
            workers_seen=int(row[21]),
        )
        for row in fetched
    ]
    return build_page(rows, size, lambda r: (r.binding_seq,))


def recent_quarantine(store: Store, *, limit: int) -> tuple[QuarantineRecord, ...]:
    """The newest quarantine rows first. The frame body is never stored, so none is returned."""
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 200:
        raise StoreUsageError("limit must be 1 to 200")
    with translate_errors(), store.read() as conn:
        installation = conn.execute("SELECT store_id FROM store_meta").fetchone()[0]
        rows = conn.execute(
            "SELECT reason, frame_type, size_bytes, digest, count, first_received_at_ms,"
            " received_at_ms FROM quarantine ORDER BY seq DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return tuple(QuarantineRecord(installation, *row) for row in rows)


def binding_record(conn: sqlite3.Connection, binding_id: str) -> BindingRecord | None:
    row = conn.execute(
        "SELECT installation_id, member_id, memory_store, first_seen_ms,"
        " (SELECT r.display_name FROM bot_display_revision r WHERE r.binding_id = b.binding_id"
        "   ORDER BY r.revision_no DESC LIMIT 1),"
        " (SELECT p.state FROM bot_presence p WHERE p.binding_id = b.binding_id"
        "   ORDER BY p.presence_id DESC LIMIT 1),"
        " (SELECT max(k.last_seen_ms) FROM slot_seen k WHERE k.binding_id = b.binding_id)"
        " FROM bot_binding b WHERE b.binding_id = ?",
        (binding_id,),
    ).fetchone()
    if row is None:
        return None
    return BindingRecord(
        binding_id=binding_id,
        installation_id=row[0],
        member_id=row[1],
        memory_store=row[2],
        display_name=row[4],
        presence=_presence(row[5]),
        created_at_ms=row[3],
        last_seen_ms=row[6],
    )
