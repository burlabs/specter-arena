"""A seeded store for the FP-19 lifecycle tests: old and new attempts, linked and unlinked, with
accepted and open work items. Test-time only."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from backend.specter_arena.store import QuarantineIn, Store, WorkRecord

from .work_fakes import (
    T0,
    bot_turn_attempt,
    decide,
    make_work,
    open_seeded,
    query,
    send,
    submit_and_accept,
)

OLD = T0 + 1_000
NEW = T0 + 20_000_000
CUT = T0 + 10_000_000
DAY_MS = 86_400_000
# A clock whose "now" puts a 30 day cutoff exactly at CUT.
NOW_FOR_30_DAYS = CUT + 30 * DAY_MS


@dataclass(frozen=True)
class Lifecycle:
    store: Store
    bindings: tuple[str, ...]
    unlinked_old: tuple[str, ...]  # ended, old, no work item: the purge deletes these
    kept_old: tuple[str, ...]  # old but linked or still running: the purge keeps these
    new: tuple[str, ...]
    accepted: WorkRecord
    open_item: WorkRecord


def attempt_ids(store: Store) -> set[str]:
    return {str(r[0]) for r in query(store, "SELECT attempt_id FROM attempt")}


def build(root: Path) -> Lifecycle:
    """Two bots. Old, ended and linked to no work item: bot 0's worker 1, bot 1's worker 5 and
    bot 1's chat-done bot turn. Old but kept: bot 0's linked worker 2 (accepted item, 100 XP),
    its linked bot turn 1 (open item) and its still-running worker 3. New: worker 4 and turn 2."""
    from .work_fakes import worker_attempt

    store, seeded = open_seeded(root, bots=2, per_bot=0)
    w1 = worker_attempt(store, 0, 1, ms=OLD + 100)
    w2 = worker_attempt(store, 0, 2, ms=OLD + 200)
    w3 = worker_attempt(store, 0, 3, ended=False, ms=OLD + 300)
    t1 = bot_turn_attempt(store, 0, turn=1, ms=OLD + 400)
    w4 = worker_attempt(store, 0, 4, ms=NEW)
    t2 = bot_turn_attempt(store, 0, turn=2, ms=NEW + 100)
    w5 = worker_attempt(store, 1, 5, ms=OLD + 500)
    c1 = bot_turn_attempt(store, 1, turn=1, end="chat-done", ms=OLD + 600)
    accepted = submit_and_accept(store, make_work(store, [w2], 1, at=OLD + 700), 1, at=OLD + 800)
    open_item = make_work(store, [t1], 2, at=OLD + 900, title="Review the old turn")
    quarantine: list[Any] = [
        QuarantineIn(OLD + 10, "unknown-event-type", "brand_new", 10, count=2),
        QuarantineIn(OLD + 20, "malformed-frame", "other", 5),
        QuarantineIn(OLD + 30, "unknown-event-type", "brand_new", 10),
        QuarantineIn(NEW + 10, "unknown-event-type", "brand_new", 10),
    ]
    send(store, *quarantine)
    return Lifecycle(
        store=store,
        bindings=seeded.bindings,
        unlinked_old=(w1, w5, c1),
        kept_old=(w2, t1, w3),
        new=(w4, t2),
        accepted=accepted,
        open_item=open_item,
    )


def decide_again(store: Store, record: WorkRecord, action: str, n: int, at: int) -> WorkRecord:
    return decide(store, record, action, n, at=at)
