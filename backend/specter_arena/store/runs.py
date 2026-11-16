from __future__ import annotations

import json
import sqlite3

from .bindings import store_id
from .errors import StoreUsageError, UnknownRun
from .guard import translate_errors
from .records import COVERAGE_REASONS, CoverageMark, KnownBinding, Outcome, RunStart
from .store import Store
from .validate import is_run_id, is_time_ms


def bump_revision(conn: sqlite3.Connection) -> None:
    conn.execute("UPDATE collector_setting SET revision = revision + 1 WHERE singleton = 1")


def run_is_live(conn: sqlite3.Connection, run_id: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM collector_run WHERE run_id = ? AND ended_ms IS NULL", (run_id,)
    ).fetchone()
    return row is not None


def _open_interval(conn: sqlite3.Connection, run_id: str, state: str) -> tuple[int, int] | None:
    row = conn.execute(
        "SELECT interval_id, start_ms FROM coverage_interval"
        " WHERE run_id = ? AND state = ? AND end_ms IS NULL",
        (run_id, state),
    ).fetchone()
    return None if row is None else (int(row[0]), int(row[1]))


def _close_interval(conn: sqlite3.Connection, interval_id: int, start_ms: int, at_ms: int) -> int:
    end_ms = max(at_ms, start_ms)
    conn.execute(
        "UPDATE coverage_interval SET end_ms = ? WHERE interval_id = ?", (end_ms, interval_id)
    )
    return end_ms


def _insert_interval(
    conn: sqlite3.Connection,
    run_id: str,
    state: str,
    start_ms: int,
    end_ms: int | None,
    reason: str | None,
    dropped: dict[str, int] | None = None,
    source_from_ms: int | None = None,
    source_to_ms: int | None = None,
) -> None:
    conn.execute(
        "INSERT INTO coverage_interval (run_id, state, start_ms, end_ms, reason, dropped_json,"
        " source_from_ms, source_to_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (
            run_id,
            state,
            start_ms,
            end_ms,
            reason,
            json.dumps(dropped, sort_keys=True, separators=(",", ":")) if dropped else None,
            source_from_ms,
            source_to_ms,
        ),
    )


def _recover(conn: sqlite3.Connection, now_ms: int) -> tuple[int, int | None]:
    """Close what earlier runs left open; returns (crashed runs recovered, previous end).

    A crashed run's covered interval ends at its last heartbeat and never later, and a `restart`
    gap spans the silence up to `now_ms`. An open gap just continues until the new run starts.
    """
    previous_end: int | None = None
    recovered = 0
    rows = conn.execute(
        "SELECT run_id, last_heartbeat_ms, ended_ms FROM collector_run ORDER BY started_ms, rowid"
    ).fetchall()
    for run_id, heartbeat_ms, ended_ms in rows:
        covered = _open_interval(conn, run_id, "covered")
        gap = _open_interval(conn, run_id, "gap")
        if ended_ms is None:
            recovered += 1
            if covered is not None:
                end_ms = _close_interval(conn, covered[0], covered[1], heartbeat_ms)
                _insert_interval(conn, run_id, "gap", end_ms, max(now_ms, end_ms), "restart")
            if gap is not None:
                _close_interval(conn, gap[0], gap[1], now_ms)
            conn.execute(
                "UPDATE collector_run SET ended_ms = ?, end_reason = 'restart' WHERE run_id = ?",
                (heartbeat_ms, run_id),
            )
            previous_end = heartbeat_ms
        else:
            if gap is not None:
                _close_interval(conn, gap[0], gap[1], now_ms)
            previous_end = ended_ms
    return recovered, previous_end


def _known_bindings(conn: sqlite3.Connection, installation_id: str) -> tuple[KnownBinding, ...]:
    rows = conn.execute(
        "SELECT b.binding_id, b.binding_seq, b.dm_key, b.member_id, b.memory_store,"
        " (SELECT o.turn FROM observation o WHERE o.binding_id = b.binding_id"
        "  AND o.turn IS NOT NULL ORDER BY o.seq DESC LIMIT 1),"
        " (SELECT o.turn_gen FROM observation o WHERE o.binding_id = b.binding_id"
        "  AND o.turn_gen IS NOT NULL ORDER BY o.seq DESC LIMIT 1)"
        " FROM bot_binding b WHERE b.installation_id = ? ORDER BY b.binding_seq",
        (installation_id,),
    ).fetchall()
    return tuple(KnownBinding(*row) for row in rows)


def start_run(store: Store, *, run_id: str, now_ms: int) -> RunStart:
    if not is_run_id(run_id) or not is_time_ms(now_ms):
        raise StoreUsageError("run id or time")
    with translate_errors(), store.write() as conn:
        if conn.execute("SELECT 1 FROM collector_run WHERE run_id = ?", (run_id,)).fetchone():
            raise StoreUsageError("run id already used")
        recovered, previous_end = _recover(conn, now_ms)
        conn.execute(
            "INSERT INTO collector_run (run_id, started_ms, last_heartbeat_ms) VALUES (?, ?, ?)",
            (run_id, now_ms, now_ms),
        )
        bump_revision(conn)
        installation_id = store_id(conn)
        newest_gen = conn.execute(
            "SELECT turn_gen FROM observation WHERE turn_gen IS NOT NULL ORDER BY seq DESC LIMIT 1"
        ).fetchone()
        paused = conn.execute("SELECT paused FROM collector_setting").fetchone()
        return RunStart(
            installation_id=installation_id,
            run_id=run_id,
            bindings=_known_bindings(conn, installation_id),
            last_turn_gen=None if newest_gen is None else str(newest_gen[0]),
            paused=bool(paused[0]),
            recovered_runs=recovered,
            previous_ended_ms=previous_end,
        )


def heartbeat(store: Store, *, run_id: str, now_ms: int) -> None:
    if not is_time_ms(now_ms):
        raise StoreUsageError("time")
    with translate_errors(), store.write() as conn:
        if not run_is_live(conn, run_id):
            raise UnknownRun
        conn.execute(
            "UPDATE collector_run SET last_heartbeat_ms = max(last_heartbeat_ms, ?)"
            " WHERE run_id = ?",
            (now_ms, run_id),
        )


def end_run(store: Store, *, run_id: str, now_ms: int, reason: str) -> None:
    if reason not in COVERAGE_REASONS or not is_time_ms(now_ms):
        raise StoreUsageError("reason or time")
    with translate_errors(), store.write() as conn:
        row = conn.execute(
            "SELECT ended_ms, end_reason, last_heartbeat_ms FROM collector_run WHERE run_id = ?",
            (run_id,),
        ).fetchone()
        if row is None:
            raise UnknownRun
        if row[0] is not None:
            if row[1] == reason:
                return
            raise StoreUsageError("run already ended with another reason")
        ended_ms = max(now_ms, row[2])
        covered = _open_interval(conn, run_id, "covered")
        if covered is not None:
            _close_interval(conn, covered[0], covered[1], ended_ms)
        if _open_interval(conn, run_id, "gap") is None:
            _insert_interval(conn, run_id, "gap", ended_ms, None, reason)
        conn.execute(
            "UPDATE collector_run SET ended_ms = ?, end_reason = ? WHERE run_id = ?",
            (ended_ms, reason, run_id),
        )
        bump_revision(conn)


def set_paused(store: Store, paused: bool, now_ms: int) -> None:
    """The flag only; the collector sends the `paused` coverage close itself."""
    if not isinstance(paused, bool) or not is_time_ms(now_ms):
        raise StoreUsageError("paused flag or time")
    with translate_errors(), store.write() as conn:
        current = conn.execute("SELECT paused FROM collector_setting").fetchone()
        if bool(current[0]) == paused:
            return
        conn.execute(
            "UPDATE collector_setting SET paused = ?, changed_at_ms = ?, revision = revision + 1",
            (int(paused), now_ms),
        )


def is_paused(store: Store) -> bool:
    with translate_errors(), store.read() as conn:
        return bool(conn.execute("SELECT paused FROM collector_setting").fetchone()[0])


def apply_coverage_mark(
    conn: sqlite3.Connection, run_id: str, mark: CoverageMark
) -> tuple[Outcome, str | None]:
    covered = _open_interval(conn, run_id, "covered")
    if mark.action == "open-covered":
        if covered is not None:
            return "deduplicated", None
        gap = _open_interval(conn, run_id, "gap")
        if gap is not None:
            if mark.at_ms < gap[1]:
                return "rejected", "bad-coverage-mark"
            _close_interval(conn, gap[0], gap[1], mark.at_ms)
        _insert_interval(conn, run_id, "covered", mark.at_ms, None, None)
        return "persisted", None
    if covered is None:
        return "deduplicated", None
    if mark.action == "close":
        if mark.at_ms < covered[1]:
            return "rejected", "bad-coverage-mark"
        _close_interval(conn, covered[0], covered[1], mark.at_ms)
        _insert_interval(conn, run_id, "gap", mark.at_ms, None, mark.reason)
        return "persisted", None
    from_ms = mark.at_ms if mark.from_ms is None else mark.from_ms
    if from_ms < covered[1]:
        return "rejected", "bad-coverage-mark"
    dropped = dict(mark.dropped)
    if from_ms == mark.at_ms:
        _insert_interval(
            conn,
            run_id,
            "gap",
            from_ms,
            from_ms,
            mark.reason,
            dropped,
            mark.source_from_ms,
            mark.source_to_ms,
        )
        return "persisted", None
    _close_interval(conn, covered[0], covered[1], from_ms)
    _insert_interval(
        conn,
        run_id,
        "gap",
        from_ms,
        mark.at_ms,
        mark.reason,
        dropped,
        mark.source_from_ms,
        mark.source_to_ms,
    )
    _insert_interval(conn, run_id, "covered", mark.at_ms, None, None)
    return "persisted", None


ROSTER_UNAVAILABLE = "roster-unavailable"


def record_roster_check(
    conn: sqlite3.Connection, run_id: str, success: bool, reason: str | None, polled_at_ms: int
) -> bool:
    """Note the newest poll on the run; True when its outcome (ok flag or reason) changed.

    The poll time moves on every poll, so it alone does not count as a change.
    """
    stored_reason = None if success else (reason or ROSTER_UNAVAILABLE)
    before = conn.execute(
        "SELECT roster_ok, roster_reason FROM collector_run WHERE run_id = ?", (run_id,)
    ).fetchone()
    conn.execute(
        "UPDATE collector_run SET roster_checked_ms = ?, roster_ok = ?, roster_reason = ?"
        " WHERE run_id = ?",
        (polled_at_ms, int(success), stored_reason, run_id),
    )
    return tuple(before) != (int(success), stored_reason)
