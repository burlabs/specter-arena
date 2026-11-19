from __future__ import annotations

import secrets
import sqlite3

from .dmkey import build_dm_key
from .errors import StoreUsageError
from .guard import translate_errors
from .records import BindingRecord, BindingRef, DmKey, RosterPoll, RosterRowIn
from .roster import binding_record
from .specters import assign_hero
from .store import Store

MAX_REBIND_NOTE_CHARS = 200


def new_binding_id() -> str:
    return "bnd_" + secrets.token_hex(12)


def store_id(conn: sqlite3.Connection) -> str:
    row = conn.execute("SELECT store_id FROM store_meta WHERE singleton = 1").fetchone()
    return str(row[0])


def insert_binding(
    conn: sqlite3.Connection, installation_id: str, key: DmKey, seen_at_ms: int
) -> BindingRef | str:
    """The binding for `key`, creating it on first sight; a rejection reason on a store clash.

    One memory store belongs to one DM key per installation: the same store under a different
    key is `ambiguous-store`, never a merge. A new binding gets its hero in the same transaction
    (and, under `ingest`, the same savepoint); a known binding or a clash gets none.
    """
    dm_key = build_dm_key(key)
    known = conn.execute(
        "SELECT binding_id, binding_seq FROM bot_binding WHERE installation_id = ? AND dm_key = ?",
        (installation_id, dm_key),
    ).fetchone()
    if known is not None:
        return BindingRef(known[0], known[1], dm_key, key.memory_store, created=False)
    clash = conn.execute(
        "SELECT 1 FROM bot_binding WHERE installation_id = ? AND memory_store = ?",
        (installation_id, key.memory_store),
    ).fetchone()
    if clash is not None:
        return "ambiguous-store"
    binding_id = new_binding_id()
    cursor = conn.execute(
        "INSERT INTO bot_binding"
        " (binding_id, installation_id, dm_key, member_id, memory_store, first_seen_ms)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        (binding_id, installation_id, dm_key, key.member_id, key.memory_store, seen_at_ms),
    )
    assign_hero(conn, binding_id, seen_at_ms)
    return BindingRef(binding_id, int(cursor.lastrowid or 0), dm_key, key.memory_store, True)


def _newest_revision(
    conn: sqlite3.Connection, binding_id: str
) -> tuple[int, str, str | None, str | None, str | None] | None:
    row = conn.execute(
        "SELECT revision_no, name, display_name, avatar_kind, avatar_ref"
        " FROM bot_display_revision WHERE binding_id = ? ORDER BY revision_no DESC LIMIT 1",
        (binding_id,),
    ).fetchone()
    return None if row is None else (row[0], row[1], row[2], row[3], row[4])


def _newest_presence(conn: sqlite3.Connection, binding_id: str) -> str | None:
    row = conn.execute(
        "SELECT state FROM bot_presence WHERE binding_id = ? ORDER BY presence_id DESC LIMIT 1",
        (binding_id,),
    ).fetchone()
    return None if row is None else str(row[0])


def _record_revision(
    conn: sqlite3.Connection, binding_id: str, row: RosterRowIn, observed_ms: int
) -> bool:
    newest = _newest_revision(conn, binding_id)
    fields = (row.name, row.display_name, row.avatar_kind, row.avatar_ref)
    if newest is not None and newest[1:] == fields:
        return False
    revision_no = 1 if newest is None else newest[0] + 1
    conn.execute(
        "INSERT INTO bot_display_revision"
        " (binding_id, revision_no, name, display_name, avatar_kind, avatar_ref, observed_ms)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        (binding_id, revision_no, *fields, observed_ms),
    )
    return True


def _record_presence(conn: sqlite3.Connection, binding_id: str, state: str, since_ms: int) -> bool:
    if _newest_presence(conn, binding_id) == state:
        return False
    conn.execute(
        "INSERT INTO bot_presence (binding_id, state, since_ms) VALUES (?, ?, ?)",
        (binding_id, state, since_ms),
    )
    return True


def apply_roster_poll(
    conn: sqlite3.Connection, installation_id: str, poll: RosterPoll
) -> tuple[bool, int]:
    """Write display revisions and presence transitions from one successful poll.

    A failed poll says nothing about presence, so it writes nothing. Returns whether any row was
    written and how many roster rows matched no binding. Rows without a memory store are ignored.
    """
    if not poll.success:
        return False, 0
    rows = {row.memory_store: row for row in poll.rows if row.memory_store != ""}
    bindings = conn.execute(
        "SELECT binding_id, memory_store FROM bot_binding"
        " WHERE installation_id = ? AND memory_store <> '' ORDER BY binding_seq",
        (installation_id,),
    ).fetchall()
    changed = False
    matched: set[str] = set()
    for binding_id, memory_store in bindings:
        row = rows.get(memory_store)
        if row is None:
            changed |= _record_presence(conn, binding_id, "absent", poll.polled_at_ms)
            continue
        matched.add(memory_store)
        changed |= _record_revision(conn, binding_id, row, poll.polled_at_ms)
        changed |= _record_presence(conn, binding_id, "present", poll.polled_at_ms)
    return changed, len(rows) - len(matched)


def get_binding(store: Store, binding_id: str) -> BindingRecord | None:
    with translate_errors(), store.read() as conn:
        return binding_record(conn, binding_id)


def record_rebind(
    store: Store,
    *,
    from_binding_id: str,
    to_binding_id: str,
    decided_at_ms: int,
    note: str | None,
) -> None:
    """Record an owner decision that one binding replaces another. History is never moved."""
    if from_binding_id == to_binding_id:
        raise StoreUsageError("rebind needs two different bindings")
    if note is not None and len(note) > MAX_REBIND_NOTE_CHARS:
        raise StoreUsageError("rebind note too long")
    if decided_at_ms < 0:
        raise StoreUsageError("rebind time")
    with translate_errors(), store.write() as conn:
        found = conn.execute(
            "SELECT count(*) FROM bot_binding WHERE binding_id IN (?, ?)",
            (from_binding_id, to_binding_id),
        ).fetchone()
        if found[0] != 2:
            raise StoreUsageError("rebind names an unknown binding")
        taken = conn.execute(
            "SELECT 1 FROM binding_rebind WHERE from_binding_id = ?", (from_binding_id,)
        ).fetchone()
        if taken is not None:
            raise StoreUsageError("binding already rebound")
        conn.execute(
            "INSERT INTO binding_rebind (from_binding_id, to_binding_id, decided_at_ms, note)"
            " VALUES (?, ?, ?, ?)",
            (from_binding_id, to_binding_id, decided_at_ms, note),
        )
