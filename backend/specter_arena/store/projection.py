from __future__ import annotations

import json
import sqlite3
from collections.abc import Mapping
from typing import Any

from .errors import StoreUsageError
from .fold import (
    BOT_TURN,
    CHAT_DONE,
    ROW_IDLE,
    WORKER,
    AttemptRow,
    BotStateRow,
    FoldObs,
    bot_turn_step,
    fold_event,
    fold_row,
    worker_step,
)
from .guard import translate_errors
from .records import ObservationIn, RebuildReport
from .runs import bump_revision
from .store import Store
from .validate import is_time_ms

_STATE_COLUMNS = (
    "binding_id, dm_slot_key, running, turn, turn_gen, pending_approval, needs_input,"
    " has_options, waiting_for_input, interrupted, last_activity_ms, row_observed_ms,"
    " event_observed_ms, last_terminal_turn, last_terminal_gen, extra_facts, row_digest,"
    " observed_seq"
)
_ATTEMPT_COLUMNS = (
    "attempt_id, binding_id, kind, slot_key, started_ms, started_seq, ended_ms, ended_seq,"
    " end_signal, running"
)


def _flag_out(value: bool | None) -> int | None:
    return None if value is None else int(value)


def _flag_in(value: object) -> bool | None:
    return None if value is None else bool(value)


def _load_state(conn: sqlite3.Connection, binding_id: str) -> BotStateRow | None:
    row = conn.execute(
        f"SELECT {_STATE_COLUMNS} FROM bot_state WHERE binding_id = ?", (binding_id,)
    ).fetchone()
    if row is None:
        return None
    return BotStateRow(
        binding_id=row[0],
        dm_slot_key=row[1],
        running=_flag_in(row[2]),
        turn=row[3],
        turn_gen=row[4],
        pending_approval=_flag_in(row[5]),
        needs_input=_flag_in(row[6]),
        has_options=_flag_in(row[7]),
        waiting_for_input=_flag_in(row[8]),
        interrupted=_flag_in(row[9]),
        last_activity_ms=row[10],
        row_observed_ms=row[11],
        event_observed_ms=row[12],
        last_terminal_turn=row[13],
        last_terminal_gen=row[14],
        extra_facts=json.loads(row[15]),
        row_digest=row[16],
        observed_seq=row[17],
    )


def _save_state(conn: sqlite3.Connection, state: BotStateRow) -> None:
    extra = json.dumps(state.extra_facts or {}, sort_keys=True, separators=(",", ":"))
    conn.execute(
        f"INSERT OR REPLACE INTO bot_state ({_STATE_COLUMNS})"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            state.binding_id,
            state.dm_slot_key,
            _flag_out(state.running),
            state.turn,
            state.turn_gen,
            _flag_out(state.pending_approval),
            _flag_out(state.needs_input),
            _flag_out(state.has_options),
            _flag_out(state.waiting_for_input),
            _flag_out(state.interrupted),
            state.last_activity_ms,
            state.row_observed_ms,
            state.event_observed_ms,
            state.last_terminal_turn,
            state.last_terminal_gen,
            extra,
            state.row_digest,
            state.observed_seq,
        ),
    )


def _attempt_from(row: tuple[Any, ...] | None) -> AttemptRow | None:
    if row is None:
        return None
    return AttemptRow(
        attempt_id=str(row[0]),
        binding_id=str(row[1]),
        kind=str(row[2]),
        slot_key=str(row[3]),
        started_ms=int(row[4]),
        started_seq=int(row[5]),
        ended_ms=None if row[6] is None else int(row[6]),
        ended_seq=None if row[7] is None else int(row[7]),
        end_signal=None if row[8] is None else str(row[8]),
        running=bool(row[9]),
    )


def _open_bot_turn(conn: sqlite3.Connection, binding_id: str) -> AttemptRow | None:
    row = conn.execute(
        f"SELECT {_ATTEMPT_COLUMNS} FROM attempt"
        " WHERE binding_id = ? AND kind = ? AND running = 1 ORDER BY started_seq DESC LIMIT 1",
        (binding_id, BOT_TURN),
    ).fetchone()
    return _attempt_from(None if row is None else tuple(row))


def _worker_attempt(conn: sqlite3.Connection, binding_id: str, slot_key: str) -> AttemptRow | None:
    row = conn.execute(
        f"SELECT {_ATTEMPT_COLUMNS} FROM attempt"
        " WHERE binding_id = ? AND kind = ? AND slot_key = ? ORDER BY started_seq DESC LIMIT 1",
        (binding_id, WORKER, slot_key),
    ).fetchone()
    return _attempt_from(None if row is None else tuple(row))


def _save_attempt(conn: sqlite3.Connection, attempt: AttemptRow) -> None:
    conn.execute(
        f"INSERT OR REPLACE INTO attempt ({_ATTEMPT_COLUMNS})"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            attempt.attempt_id,
            attempt.binding_id,
            attempt.kind,
            attempt.slot_key,
            attempt.started_ms,
            attempt.started_seq,
            attempt.ended_ms,
            attempt.ended_seq,
            attempt.end_signal,
            int(attempt.running),
        ),
    )


def apply_observation(conn: sqlite3.Connection, obs: FoldObs) -> None:
    """Fold one stored observation into `bot_state`, `attempt`; shared by ingest and rebuild."""
    if obs.kind == "row-change":
        _apply_row(conn, obs)
    else:
        _apply_event(conn, obs)


def _apply_row(conn: sqlite3.Connection, obs: FoldObs) -> None:
    if not obs.is_bot_slot:
        _save_attempt(conn, worker_step(_worker_attempt(conn, obs.binding_id, obs.slot_key), obs))
        return
    folded = fold_row(_load_state(conn, obs.binding_id), obs)
    if folded is None:
        return
    _save_state(conn, folded)
    step = bot_turn_step(_open_bot_turn(conn, obs.binding_id), obs, folded.running, ROW_IDLE)
    if step is not None:
        _save_attempt(conn, step)


def _apply_event(conn: sqlite3.Connection, obs: FoldObs) -> None:
    if not obs.is_bot_slot:
        return
    folded, terminal = fold_event(_load_state(conn, obs.binding_id), obs)
    _save_state(conn, folded)
    if terminal:
        open_attempt = _open_bot_turn(conn, obs.binding_id)
        if open_attempt is not None:
            step = bot_turn_step(open_attempt, obs, None, CHAT_DONE)
            if step is not None:
                _save_attempt(conn, step)


def touch_slot_seen(
    conn: sqlite3.Connection,
    binding_id: str,
    slot_key: str,
    seen_ms: int,
    activity_ms: int | None,
) -> None:
    """Volatile liveness: newest receive time and newest activity time per slot."""
    conn.execute(
        "INSERT INTO slot_seen (binding_id, slot_key, last_seen_ms, last_activity_ms)"
        " VALUES (?, ?, ?, ?) ON CONFLICT (binding_id, slot_key) DO UPDATE SET"
        " last_seen_ms = max(last_seen_ms, excluded.last_seen_ms),"
        " last_activity_ms = CASE WHEN excluded.last_activity_ms IS NULL THEN last_activity_ms"
        " WHEN last_activity_ms IS NULL THEN excluded.last_activity_ms"
        " ELSE max(last_activity_ms, excluded.last_activity_ms) END",
        (binding_id, slot_key, seen_ms, activity_ms),
    )


def _activity_of(payload: Mapping[str, bool | int | str]) -> int | None:
    value = payload.get("lastActivityMs")
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def fold_inserted(conn: sqlite3.Connection, binding_id: str, item: ObservationIn, seq: int) -> None:
    apply_observation(
        conn,
        FoldObs(
            seq=seq,
            binding_id=binding_id,
            dm_key=item.dm_key,
            slot_key=item.slot_key,
            kind=item.kind,
            event_type=item.event_type,
            turn=item.turn,
            turn_gen=item.turn_gen,
            received_at_ms=item.received_at_ms,
            fact_digest=item.fact_digest,
            payload=item.payload,
        ),
    )
    touch_slot_seen(
        conn, binding_id, item.slot_key, item.received_at_ms, _activity_of(item.payload)
    )


def touch_duplicate(conn: sqlite3.Connection, binding_id: str, item: ObservationIn) -> None:
    touch_slot_seen(
        conn, binding_id, item.slot_key, item.received_at_ms, _activity_of(item.payload)
    )


def rebuild_projection(store: Store, *, as_of_ms: int) -> RebuildReport:
    """Empty `bot_state` and `attempt` and refold every stored observation in `seq` order.

    Reads only the store; `as_of_ms` is echoed and never used by the fold. `slot_seen` and the
    run and coverage tables are bookkeeping that cannot be recomputed and are left alone.
    """
    if not is_time_ms(as_of_ms):
        raise StoreUsageError("as_of_ms must be a non-negative integer")
    with translate_errors(), store.write() as conn:
        conn.execute("DELETE FROM attempt")
        conn.execute("DELETE FROM bot_state")
        rows = conn.execute(
            "SELECT o.seq, o.binding_id, b.dm_key, o.slot_key, o.kind, o.event_type, o.turn,"
            " o.turn_gen, o.received_at_ms, o.fact_digest, o.payload FROM observation o"
            " JOIN bot_binding b ON b.binding_id = o.binding_id ORDER BY o.seq"
        ).fetchall()
        last_seq: int | None = None
        for row in rows:
            apply_observation(
                conn,
                FoldObs(
                    seq=row[0],
                    binding_id=row[1],
                    dm_key=row[2],
                    slot_key=row[3],
                    kind=row[4],
                    event_type=row[5],
                    turn=row[6],
                    turn_gen=row[7],
                    received_at_ms=row[8],
                    fact_digest=row[9],
                    payload=json.loads(row[10]),
                ),
            )
            last_seq = row[0]
        counts = conn.execute(
            "SELECT (SELECT count(*) FROM bot_state), (SELECT count(*) FROM attempt)"
        ).fetchone()
        bump_revision(conn)
        return RebuildReport(
            as_of_ms=as_of_ms,
            observations_folded=len(rows),
            bot_states=counts[0],
            attempts=counts[1],
            last_seq=last_seq,
        )
