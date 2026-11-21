from __future__ import annotations

import sqlite3
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Literal

from .errors import LifecycleBusy, StoreUsageError
from .guard import translate_errors
from .store import Store
from .validate import is_time_ms

RunKind = Literal["purge", "asset-cleanup"]
RunState = Literal["running", "completed", "interrupted", "failed"]

DAY_MS = 86_400_000
RETENTION_CHOICES: tuple[int, ...] = (30, 90, 180, 365)
PURGE_BATCH = 500
CLEANUP_BATCH = 20
UNUSED_UPLOAD_MIN_AGE_MS = 3_600_000
PURGED_REASON = "purged"

_KINDS = ("purge", "asset-cleanup")


@dataclass(frozen=True, slots=True)
class Retention:
    retention_days: int | None
    changed_at_ms: int | None
    revision: int


@dataclass(frozen=True, slots=True)
class PurgePreview:
    """What a purge at this cutoff would delete right now."""

    cutoff_ms: int
    observations: int
    quarantine: int
    attempts: int


@dataclass(frozen=True, slots=True)
class RunRecord:
    run_id: int
    kind: RunKind
    state: RunState
    cutoff_ms: int
    started_ms: int
    ended_ms: int | None
    observations: int
    quarantine: int
    attempts: int
    assets: int


@dataclass(frozen=True, slots=True)
class LifecycleRuns:
    running: RunRecord | None
    last_purge: RunRecord | None
    last_cleanup: RunRecord | None


# ---- what a purge may delete ----------------------------------------------------------------
#
# An observation is deleted only when it is older than the cutoff and a later `rebuild_projection`
# or collector start does not need it. Kept, whatever its age:
#   1. on each binding's DM slot, the newest observation of each kind (the newest row is what
#      `observations._is_duplicate` compares and what `bot_state` folds; the newest event sets
#      `event_observed_ms`) and the newest `chat_done` (`last_terminal_turn`, `_gen`). Other slots
#      belong to worker attempts only, so they need no standing row;
#   2. the newest observation with a turn, and the newest with a turn generation, of each binding
#      (`runs._known_bindings`, `runs.start_run`);
#   3. the observation `bot_state.observed_seq` names;
#   4. the observation that opened each running attempt;
#   5. every observation from a linked attempt's start to its end on its own slot (the evidence
#      the inspector and a re-accept read; an open end runs to the newest).
_OBSERVATION_CANDIDATES = """
WITH keepers AS MATERIALIZED (
  SELECT binding_id, slot_key, started_seq, ended_seq, running,
    attempt_id IN (SELECT attempt_id FROM work_attempt) AS linked
  FROM attempt
  WHERE running = 1 OR attempt_id IN (SELECT attempt_id FROM work_attempt)
)
SELECT o.seq FROM observation o
WHERE o.received_at_ms < :cutoff AND o.seq > :after
  AND o.seq NOT IN (
    SELECT max(d.seq) FROM observation d JOIN bot_binding b
      ON b.binding_id = d.binding_id AND d.slot_key = b.dm_key
    GROUP BY d.binding_id, d.kind
  )
  AND o.seq NOT IN (
    SELECT max(d.seq) FROM observation d JOIN bot_binding b
      ON b.binding_id = d.binding_id AND d.slot_key = b.dm_key
    WHERE d.event_type = 'chat_done' GROUP BY d.binding_id
  )
  AND o.seq NOT IN (SELECT max(seq) FROM observation WHERE turn IS NOT NULL GROUP BY binding_id)
  AND o.seq NOT IN (SELECT max(seq) FROM observation WHERE turn_gen IS NOT NULL GROUP BY binding_id)
  AND o.seq NOT IN (SELECT observed_seq FROM bot_state)
  AND NOT EXISTS (
    SELECT 1 FROM keepers k
    WHERE k.binding_id = o.binding_id AND k.slot_key = o.slot_key
      AND (
        (k.running = 1 AND o.seq = k.started_seq)
        OR (k.linked AND o.seq >= k.started_seq AND (k.ended_seq IS NULL OR o.seq <= k.ended_seq))
      )
  )
"""

# A running attempt is kept as is; a linked one is evidence. Only ended, unlinked attempts go.
_ATTEMPT_CANDIDATES = """
SELECT attempt_id FROM attempt
WHERE running = 0 AND started_ms < :cutoff AND coalesce(ended_ms, started_ms) < :cutoff
  AND attempt_id NOT IN (SELECT attempt_id FROM work_attempt)
"""

_QUARANTINE_CANDIDATES = "SELECT seq FROM quarantine WHERE received_at_ms < :cutoff"

_UNUSED_UPLOADS = """
SELECT asset_id FROM asset
WHERE origin = 'uploaded' AND created_ms < :cutoff
  AND NOT EXISTS (SELECT 1 FROM avatar_revision v WHERE v.asset_id = asset.asset_id)
"""

_RUN_COLUMNS = (
    "run_id, kind, state, cutoff_ms, started_ms, ended_ms, deleted_observations,"
    " deleted_quarantine, deleted_attempts, deleted_assets"
)


def _need_time(value: object) -> int:
    if not is_time_ms(value):
        raise StoreUsageError("time")
    assert isinstance(value, int)
    return value


def _run(row: Iterable[object]) -> RunRecord:
    values = tuple(row)
    return RunRecord(
        run_id=int(values[0]),  # type: ignore[call-overload]
        kind="purge" if values[1] == "purge" else "asset-cleanup",
        state=_state(values[2]),
        cutoff_ms=int(values[3]),  # type: ignore[call-overload]
        started_ms=int(values[4]),  # type: ignore[call-overload]
        ended_ms=None if values[5] is None else int(values[5]),  # type: ignore[call-overload]
        observations=int(values[6]),  # type: ignore[call-overload]
        quarantine=int(values[7]),  # type: ignore[call-overload]
        attempts=int(values[8]),  # type: ignore[call-overload]
        assets=int(values[9]),  # type: ignore[call-overload]
    )


def _state(value: object) -> RunState:
    if value == "running":
        return "running"
    if value == "completed":
        return "completed"
    return "interrupted" if value == "interrupted" else "failed"


# ---- retention setting ----------------------------------------------------------------------


def get_retention(store: Store) -> Retention:
    with translate_errors(), store.read() as conn:
        return _retention(conn)


def _retention(conn: sqlite3.Connection) -> Retention:
    row = conn.execute(
        "SELECT retention_days, changed_at_ms, revision FROM retention_setting"
    ).fetchone()
    return Retention(
        None if row[0] is None else int(row[0]),
        None if row[1] is None else int(row[1]),
        int(row[2]),
    )


def set_retention(store: Store, retention_days: int | None, now_ms: int) -> Retention:
    """Save the retention window (30, 90, 180, 365 days, or None for keep everything). Setting the
    value already saved changes nothing and keeps the revision. Deletes nothing."""
    _need_time(now_ms)
    if retention_days is not None and (
        isinstance(retention_days, bool) or retention_days not in RETENTION_CHOICES
    ):
        raise StoreUsageError("retention days")
    with translate_errors(), store.write() as conn:
        current = _retention(conn)
        if current.retention_days == retention_days:
            return current
        conn.execute(
            "UPDATE retention_setting SET retention_days = ?, changed_at_ms = ?,"
            " revision = revision + 1",
            (retention_days, now_ms),
        )
        return _retention(conn)


def cutoff_for(retention_days: int, now_ms: int) -> int:
    return max(0, _need_time(now_ms) - retention_days * DAY_MS)


# ---- reads ----------------------------------------------------------------------------------


def purge_horizon(conn: sqlite3.Connection) -> int | None:
    """The largest cutoff of any purge run that deleted a row, running or finished. History
    before it may be missing, so a read reports that span as unknown, never as no activity."""
    row = conn.execute(
        "SELECT max(cutoff_ms) FROM lifecycle_run WHERE kind = 'purge'"
        " AND deleted_observations + deleted_quarantine + deleted_attempts > 0"
    ).fetchone()
    return None if row[0] is None else int(row[0])


def with_purged_gap(
    intervals: Iterable[tuple[str, int, int]], horizon_ms: int | None
) -> list[tuple[str, int, int]]:
    """Coverage intervals `(state, start, end)` with everything before the horizon replaced by one
    gap (reason `purged`): covered time before it is no longer backed by stored activity."""
    if horizon_ms is None:
        return list(intervals)
    out: list[tuple[str, int, int]] = [("gap", 0, horizon_ms)]
    for state, start, end in intervals:
        if end > horizon_ms:
            out.append((state, max(start, horizon_ms), end))
    return out


def read_horizon(store: Store) -> int | None:
    with translate_errors(), store.read() as conn:
        return purge_horizon(conn)


def purge_preview(store: Store, cutoff_ms: int) -> PurgePreview:
    _need_time(cutoff_ms)
    with translate_errors(), store.read() as conn:
        return _preview(conn, cutoff_ms)


def _preview(conn: sqlite3.Connection, cutoff_ms: int) -> PurgePreview:
    params = {"cutoff": cutoff_ms, "after": 0}
    return PurgePreview(
        cutoff_ms,
        _count(conn, _OBSERVATION_CANDIDATES, params),
        _count(conn, _QUARANTINE_CANDIDATES, params),
        _count(conn, _ATTEMPT_CANDIDATES, params),
    )


def _count(conn: sqlite3.Connection, candidates: str, params: dict[str, int]) -> int:
    names = {name: value for name, value in params.items() if f":{name}" in candidates}
    return int(conn.execute(f"SELECT count(*) FROM ({candidates})", names).fetchone()[0])


def unused_upload_count(store: Store, now_ms: int) -> int:
    with translate_errors(), store.read() as conn:
        return _count(
            conn, _UNUSED_UPLOADS, {"cutoff": _need_time(now_ms) - UNUSED_UPLOAD_MIN_AGE_MS}
        )


def uploaded_asset_count(store: Store) -> int:
    with translate_errors(), store.read() as conn:
        return int(
            conn.execute("SELECT count(*) FROM asset WHERE origin = 'uploaded'").fetchone()[0]
        )


def read_runs(store: Store) -> LifecycleRuns:
    with translate_errors(), store.read() as conn:
        return LifecycleRuns(
            running=_one_run(conn, "state = 'running'"),
            last_purge=_one_run(conn, "kind = 'purge' AND state <> 'running'"),
            last_cleanup=_one_run(conn, "kind = 'asset-cleanup' AND state <> 'running'"),
        )


def _one_run(conn: sqlite3.Connection, where: str) -> RunRecord | None:
    row = conn.execute(
        f"SELECT {_RUN_COLUMNS} FROM lifecycle_run WHERE {where} ORDER BY run_id DESC LIMIT 1"
    ).fetchone()
    return None if row is None else _run(row)


# ---- runs -----------------------------------------------------------------------------------


def begin_run(store: Store, kind: RunKind, cutoff_ms: int, now_ms: int) -> int:
    """Open a run: from here until it ends, the SQL guards let rows older than `cutoff_ms` go.
    Raises `LifecycleBusy` when another run is open."""
    if kind not in _KINDS:
        raise StoreUsageError("run kind")
    _need_time(cutoff_ms)
    _need_time(now_ms)
    with translate_errors(), store.write() as conn:
        if conn.execute("SELECT 1 FROM lifecycle_run WHERE state = 'running'").fetchone():
            raise LifecycleBusy
        cursor = conn.execute(
            "INSERT INTO lifecycle_run (kind, state, cutoff_ms, started_ms)"
            " VALUES (?, 'running', ?, ?)",
            (kind, cutoff_ms, now_ms),
        )
        return int(cursor.lastrowid or 0)


def end_run(store: Store, run_id: int, state: RunState, now_ms: int) -> RunRecord:
    """Close a run; the guards refuse every delete from then on. Safe to repeat."""
    _need_time(now_ms)
    with translate_errors(), store.write() as conn:
        conn.execute(
            "UPDATE lifecycle_run SET state = ?, ended_ms = max(started_ms, ?)"
            " WHERE run_id = ? AND state = 'running'",
            (state, now_ms, run_id),
        )
        row = conn.execute(
            f"SELECT {_RUN_COLUMNS} FROM lifecycle_run WHERE run_id = ?", (run_id,)
        ).fetchone()
        return _run(row)


def purge_observations(store: Store, run_id: int, cutoff_ms: int, batch: int = PURGE_BATCH) -> int:
    """Delete the purgeable observations, `batch` rows per transaction, so a collector write waits
    for at most one batch. Returns how many were deleted."""
    total = 0
    after = 0
    while True:
        with translate_errors(), store.write() as conn:
            found = [
                int(row[0])
                for row in conn.execute(
                    _OBSERVATION_CANDIDATES + " ORDER BY o.seq LIMIT :n",
                    {"cutoff": cutoff_ms, "after": after, "n": batch},
                )
            ]
            for seq in found:
                conn.execute("DELETE FROM observation WHERE seq = ?", (seq,))
            if found:
                conn.execute(
                    "UPDATE lifecycle_run SET deleted_observations = deleted_observations + ?"
                    " WHERE run_id = ?",
                    (len(found), run_id),
                )
        total += len(found)
        if len(found) < batch:
            return total
        after = found[-1]


def purge_quarantine(store: Store, run_id: int, cutoff_ms: int, batch: int = PURGE_BATCH) -> int:
    total = 0
    while True:
        with translate_errors(), store.write() as conn:
            found = [
                int(row[0])
                for row in conn.execute(
                    _QUARANTINE_CANDIDATES + " ORDER BY seq LIMIT :n",
                    {"cutoff": cutoff_ms, "n": batch},
                )
            ]
            for seq in found:
                conn.execute("DELETE FROM quarantine WHERE seq = ?", (seq,))
            if found:
                conn.execute(
                    "UPDATE lifecycle_run SET deleted_quarantine = deleted_quarantine + ?"
                    " WHERE run_id = ?",
                    (len(found), run_id),
                )
        total += len(found)
        if len(found) < batch:
            return total


def purge_attempts(store: Store, run_id: int, cutoff_ms: int, batch: int = PURGE_BATCH) -> int:
    total = 0
    while True:
        with translate_errors(), store.write() as conn:
            found = [
                str(row[0])
                for row in conn.execute(
                    _ATTEMPT_CANDIDATES + " ORDER BY attempt_id LIMIT :n",
                    {"cutoff": cutoff_ms, "n": batch},
                )
            ]
            for attempt_id in found:
                conn.execute("DELETE FROM attempt WHERE attempt_id = ?", (attempt_id,))
            if found:
                conn.execute(
                    "UPDATE lifecycle_run SET deleted_attempts = deleted_attempts + ?"
                    " WHERE run_id = ?",
                    (len(found), run_id),
                )
        total += len(found)
        if len(found) < batch:
            return total


def run_purge(
    store: Store,
    cutoff_ms: int,
    clock: Callable[[], int],
    *,
    batch: int = PURGE_BATCH,
) -> RunRecord:
    """Open a purge run, delete in bounded batches, close the run. The caller has already taken
    the pre-purge backup. A failure marks the run `failed` (or leaves it for `open_store` to close
    as `interrupted` after a crash) and re-raises; rows already deleted stay deleted."""
    run_id = begin_run(store, "purge", cutoff_ms, clock())
    try:
        purge_observations(store, run_id, cutoff_ms, batch)
        purge_attempts(store, run_id, cutoff_ms, batch)
        purge_quarantine(store, run_id, cutoff_ms, batch)
    except BaseException:
        end_run(store, run_id, "failed", clock())
        raise
    return end_run(store, run_id, "completed", clock())


def run_asset_cleanup(
    store: Store, clock: Callable[[], int], *, batch: int = CLEANUP_BATCH
) -> RunRecord:
    """Delete uploaded assets no avatar revision references and older than one hour. The SQL
    guard repeats both conditions and refuses every bundled asset."""
    now = clock()
    cutoff = max(0, now - UNUSED_UPLOAD_MIN_AGE_MS)
    run_id = begin_run(store, "asset-cleanup", cutoff, now)
    try:
        while True:
            with translate_errors(), store.write() as conn:
                found = [
                    str(row[0])
                    for row in conn.execute(
                        _UNUSED_UPLOADS + " ORDER BY created_ms, asset_id LIMIT :n",
                        {"cutoff": cutoff, "n": batch},
                    )
                ]
                for asset_id in found:
                    conn.execute("DELETE FROM asset WHERE asset_id = ?", (asset_id,))
                if found:
                    conn.execute(
                        "UPDATE lifecycle_run SET deleted_assets = deleted_assets + ?"
                        " WHERE run_id = ?",
                        (len(found), run_id),
                    )
            if len(found) < batch:
                break
    except BaseException:
        end_run(store, run_id, "failed", clock())
        raise
    return end_run(store, run_id, "completed", clock())
