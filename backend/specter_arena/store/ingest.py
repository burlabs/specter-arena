from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field

from .bindings import apply_roster_poll, insert_binding, store_id
from .errors import StoreUsageError
from .guard import translate_errors
from .observations import insert_observation, insert_quarantine
from .records import (
    ITEM_KINDS,
    MAX_BATCH_ITEMS,
    BindingRef,
    BindingSeen,
    CoverageMark,
    IngestBatch,
    IngestItem,
    IngestResult,
    ItemKind,
    ObservationIn,
    Outcome,
    OutcomeCounts,
    QuarantineIn,
    Rejection,
    RosterPoll,
)
from .runs import apply_coverage_mark, bump_revision, record_roster_check, run_is_live
from .store import Store
from .tasks import sweep_guarded
from .validate import (
    binding_seen_reason,
    coverage_mark_reason,
    observation_reason,
    quarantine_reason,
    roster_poll_reason,
)


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
    last_seq: int | None = None
    latest_observed_ms: int | None = None

    def record(self, index: int, kind: ItemKind, outcome: Outcome, reason: str | None) -> None:
        self.counts[kind][outcome] += 1
        if outcome == "rejected":
            self.rejections.append(Rejection(index, kind, reason or "constraint"))

    def persisted_any(self) -> bool:
        return any(by_outcome["persisted"] for by_outcome in self.counts.values())

    def result(self) -> IngestResult:
        return IngestResult(
            counts={kind: OutcomeCounts(**self.counts[kind]) for kind in ITEM_KINDS},
            rejections=tuple(self.rejections),
            bindings=tuple(self.bindings),
            roster_unmatched=self.roster_unmatched,
            last_seq=self.last_seq,
        )


def _kind_of(item: IngestItem) -> ItemKind:
    if isinstance(item, BindingSeen):
        return "binding"
    if isinstance(item, RosterPoll):
        return "roster"
    if isinstance(item, ObservationIn):
        return "observation"
    if isinstance(item, CoverageMark):
        return "coverage"
    if isinstance(item, QuarantineIn):
        return "quarantine"
    raise StoreUsageError("unknown item type")


def _validate(item: IngestItem, installation_id: str) -> str | None:
    if isinstance(item, BindingSeen):
        return binding_seen_reason(item)
    if isinstance(item, RosterPoll):
        return roster_poll_reason(item)
    if isinstance(item, ObservationIn):
        return observation_reason(item, installation_id)
    if isinstance(item, CoverageMark):
        return coverage_mark_reason(item)
    return quarantine_reason(item)


def _apply(
    conn: sqlite3.Connection,
    run_id: str,
    installation_id: str,
    item: IngestItem,
    acc: _Accumulator,
) -> tuple[Outcome, str | None]:
    if isinstance(item, BindingSeen):
        made = insert_binding(conn, installation_id, item.key, item.seen_at_ms)
        if isinstance(made, str):
            return "rejected", made
        acc.bindings.append(made)
        return ("persisted" if made.created else "deduplicated"), None
    if isinstance(item, ObservationIn):
        outcome, reason, seq = insert_observation(conn, installation_id, item)
        if seq is not None:
            acc.last_seq = seq if acc.last_seq is None else max(acc.last_seq, seq)
        if outcome == "persisted":
            seen = item.received_at_ms
            acc.latest_observed_ms = (
                seen if acc.latest_observed_ms is None else max(acc.latest_observed_ms, seen)
            )
        return outcome, reason
    if not run_is_live(conn, run_id):
        return "rejected", "unknown-run"
    if isinstance(item, RosterPoll):
        changed, unmatched = apply_roster_poll(conn, installation_id, item)
        run_changed = record_roster_check(
            conn, run_id, item.success, item.reason, item.polled_at_ms
        )
        acc.roster_unmatched += unmatched
        return ("persisted" if changed or run_changed else "deduplicated"), None
    if isinstance(item, CoverageMark):
        return apply_coverage_mark(conn, run_id, item)
    insert_quarantine(conn, run_id, item)
    return "quarantined", None


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
            reason = (
                "wrong-installation" if wrong_installation else _validate(item, installation_id)
            )
            if reason is not None:
                acc.record(index, kind, "rejected", reason)
                continue
            conn.execute("SAVEPOINT item")
            try:
                outcome, reason = _apply(conn, batch.run_id, installation_id, item, acc)
            except sqlite3.IntegrityError:
                conn.execute("ROLLBACK TO item")
                outcome, reason = "rejected", "constraint"
            conn.execute("RELEASE item")
            acc.record(index, kind, outcome, reason)
        if acc.persisted_any():
            bump_revision(conn)
        if acc.latest_observed_ms is not None:
            # Tasks follow the projection this batch just changed, in the same transaction.
            sweep_guarded(conn, acc.latest_observed_ms)
        return acc.result()
