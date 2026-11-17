from __future__ import annotations

import sqlite3

from .projection import fold_inserted, touch_duplicate
from .records import ObservationIn, Outcome, QuarantineIn
from .validate import canonical_payload, quarantine_frame_type


def _binding_id(conn: sqlite3.Connection, installation_id: str, dm_key: str) -> str | None:
    row = conn.execute(
        "SELECT binding_id FROM bot_binding WHERE installation_id = ? AND dm_key = ?",
        (installation_id, dm_key),
    ).fetchone()
    return None if row is None else str(row[0])


def _is_duplicate(conn: sqlite3.Connection, binding_id: str, item: ObservationIn) -> bool:
    """An event repeats when its dedup key was stored; a row repeats only its newest digest.

    Comparing against the newest row digest (not every digest) keeps a state that recurs, such
    as approval pending, cleared, pending again, from being dropped as a duplicate.
    """
    if item.kind == "event":
        if item.dedup_key is None:
            return False
        found = conn.execute(
            "SELECT 1 FROM observation WHERE binding_id = ? AND event_type = ? AND dedup_key = ?",
            (binding_id, item.event_type, item.dedup_key),
        ).fetchone()
        return found is not None
    newest = conn.execute(
        "SELECT fact_digest FROM observation"
        " WHERE binding_id = ? AND slot_key = ? AND kind = 'row-change'"
        " ORDER BY seq DESC LIMIT 1",
        (binding_id, item.slot_key),
    ).fetchone()
    return newest is not None and newest[0] == item.fact_digest


def insert_observation(
    conn: sqlite3.Connection, installation_id: str, item: ObservationIn
) -> tuple[Outcome, str | None, int | None]:
    """Store one validated observation: outcome, reject reason and the new `seq`."""
    binding_id = _binding_id(conn, installation_id, item.dm_key)
    if binding_id is None:
        return "rejected", "unknown-binding", None
    if item.binding_id is not None and item.binding_id != binding_id:
        return "rejected", "binding-mismatch", None
    if _is_duplicate(conn, binding_id, item):
        touch_duplicate(conn, binding_id, item)
        return "deduplicated", None, None
    cursor = conn.execute(
        "INSERT INTO observation (binding_id, kind, event_type, source, slot_key, turn, turn_gen,"
        " tool_call_id, dedup_key, fact_digest, received_at_ms, source_time_ms, origin,"
        " contract_version, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            binding_id,
            item.kind,
            item.event_type,
            item.source,
            item.slot_key,
            item.turn,
            item.turn_gen,
            item.tool_call_id,
            item.dedup_key,
            item.fact_digest,
            item.received_at_ms,
            item.source_time_ms,
            item.origin,
            item.contract_version,
            canonical_payload(item.payload),
        ),
    )
    seq = int(cursor.lastrowid or 0)
    fold_inserted(conn, binding_id, item, seq)
    return "persisted", None, seq


def insert_quarantine(conn: sqlite3.Connection, run_id: str, item: QuarantineIn) -> None:
    """The frame itself is never stored: only its type, size, count and optional digest."""
    first = item.received_at_ms if item.first_received_at_ms is None else item.first_received_at_ms
    conn.execute(
        "INSERT INTO quarantine (run_id, received_at_ms, reason, frame_type, size_bytes, digest,"
        " count, first_received_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (
            run_id,
            item.received_at_ms,
            item.reason,
            quarantine_frame_type(item.frame_type),
            item.size_bytes,
            item.digest,
            item.count,
            first,
        ),
    )
