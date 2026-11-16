from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field

from .bindings import apply_roster_poll, insert_binding, store_id
from .errors import StoreUsageError
from .guard import translate_errors
from .records import (
    ITEM_KINDS,
    MAX_BATCH_ITEMS,
    BindingRef,
    BindingSeen,
    IngestBatch,
    IngestItem,
    IngestResult,
    ItemKind,
    Outcome,
    OutcomeCounts,
    Rejection,
    RosterPoll,
)
from .store import Store
from .validate import binding_seen_reason, roster_poll_reason


@dataclass
class _Accumulator:
    counts: dict[ItemKind, dict[Outcome, int]] = field(
        default_factory=lambda: {
            kind: {"persisted": 0, "deduplicated": 0, "quarantined": 0, "rejected": 0}
            for kind in ITEM_KINDS
        }
    )
    rejections: list[Rejection] = field(default_factory=list)
    bindings: list[BindingRef] = field(default_factory=list)
    roster_unmatched: int = 0

    def record(self, index: int, kind: ItemKind, outcome: Outcome, reason: str | None) -> None:
        self.counts[kind][outcome] += 1
        if outcome == "rejected":
            self.rejections.append(Rejection(index, kind, reason or "constraint"))

    def result(self) -> IngestResult:
        return IngestResult(
            counts={kind: OutcomeCounts(**self.counts[kind]) for kind in ITEM_KINDS},
            rejections=tuple(self.rejections),
            bindings=tuple(self.bindings),
            roster_unmatched=self.roster_unmatched,
            last_seq=None,
        )


def _kind_of(item: IngestItem) -> ItemKind:
    if isinstance(item, BindingSeen):
        return "binding"
    if isinstance(item, RosterPoll):
        return "roster"
    raise StoreUsageError("item kind is not supported yet")


def _validate(item: IngestItem) -> str | None:
    if isinstance(item, BindingSeen):
        return binding_seen_reason(item)
    if isinstance(item, RosterPoll):
        return roster_poll_reason(item)
    raise StoreUsageError("item kind is not supported yet")


def _apply(
    conn: sqlite3.Connection, installation_id: str, item: IngestItem, acc: _Accumulator
) -> tuple[Outcome, str | None]:
    if isinstance(item, BindingSeen):
        made = insert_binding(conn, installation_id, item.key, item.seen_at_ms)
        if isinstance(made, str):
            return "rejected", made
        acc.bindings.append(made)
        return ("persisted" if made.created else "deduplicated"), None
    if isinstance(item, RosterPoll):
        changed, unmatched = apply_roster_poll(conn, installation_id, item)
        acc.roster_unmatched += unmatched
        return ("persisted" if changed else "deduplicated"), None
    raise StoreUsageError("item kind is not supported yet")


def ingest(store: Store, batch: IngestBatch) -> IngestResult:
    """Apply one batch in a single transaction; a bad item is rejected without losing its peers.

    Each item runs under its own savepoint, so a constraint failure rolls back that item only.
    A driver failure rolls back the whole batch and raises `StoreUnavailable`, which makes a retry
    of the same batch safe.
    """
    if not 1 <= len(batch.items) <= MAX_BATCH_ITEMS:
        raise StoreUsageError("batch size")
    with translate_errors(), store.write() as conn:
        acc = _Accumulator()
        installation_id = store_id(conn)
        wrong_installation = batch.installation_id != installation_id
        for index, item in enumerate(batch.items):
            kind = _kind_of(item)
            reason = "wrong-installation" if wrong_installation else _validate(item)
            if reason is not None:
                acc.record(index, kind, "rejected", reason)
                continue
            conn.execute("SAVEPOINT item")
            try:
                outcome, reason = _apply(conn, installation_id, item, acc)
            except sqlite3.IntegrityError:
                conn.execute("ROLLBACK TO item")
                outcome, reason = "rejected", "constraint"
            conn.execute("RELEASE item")
            acc.record(index, kind, outcome, reason)
        return acc.result()
