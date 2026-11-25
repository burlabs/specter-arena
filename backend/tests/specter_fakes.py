"""Test doubles for the Specter service: a clock and real-store helpers.

The service tests run against the real work-ledger store (`store/specters.py` and migration 0007)
in a temp directory. Test-time only."""

from __future__ import annotations

from pathlib import Path

from backend.specter_arena.store import (
    HERO_IDS,
    BindingSeen,
    DmKey,
    IngestBatch,
    RosterPoll,
    RosterRowIn,
    Store,
    choose_hero,
    ingest,
    start_run,
)
from backend.specter_arena.store.bindings import store_id

START_MS = 1_800_000_000_000  # same epoch the store tests use
ALPHA = DmKey("alpha-0123456789ab", "memory-alpha")
BETA = DmKey("beta-0123456789ab", "memory-beta")


class FakeClock:
    def __init__(self, start_ms: int = START_MS) -> None:
        self.now = start_ms

    def __call__(self) -> int:
        return self.now


def assign_unassigned(opened: Store, *, at_ms: int = START_MS) -> None:
    """Give every binding with no hero the next roster hero, in creation order.

    New bindings start unassigned (FP-23); this reproduces the FP-16 numbering for tests that
    want every bot to hold a hero.
    """
    with opened.read() as conn:
        bare = [
            str(r[0])
            for r in conn.execute(
                "SELECT b.binding_id FROM bot_binding b WHERE NOT EXISTS"
                " (SELECT 1 FROM hero_assignment h WHERE h.binding_id = b.binding_id)"
                " ORDER BY b.binding_seq"
            )
        ]
        given = int(conn.execute("SELECT count(*) FROM hero_assignment").fetchone()[0])
    for offset, binding_id in enumerate(bare):
        choose_hero(opened, binding_id, 0, HERO_IDS[(given + offset) % len(HERO_IDS)], at_ms)


def bind(
    opened: Store, key: DmKey, display: str, *, at_ms: int = START_MS, assign: bool = True
) -> str:
    """Create (or update the display name of) a bot binding through the real ingest path.

    A new binding is given the next roster hero unless `assign` is False."""
    with opened.read() as conn:
        started = conn.execute("SELECT count(*) FROM collector_run").fetchone()[0]
        installation = store_id(conn)
    if not started:
        start_run(opened, run_id="run-00000001", now_ms=at_ms - 1)
    poll = RosterPoll(
        True, at_ms + 1, (RosterRowIn(key.memory_store, display, display, None, None),)
    )
    result = ingest(
        opened, IngestBatch("run-00000001", installation, (BindingSeen(key, at_ms), poll))
    )
    if assign:
        assign_unassigned(opened, at_ms=at_ms)
    return result.bindings[0].binding_id


def table_counts(opened: Store, *, except_prefixes: tuple[str, ...]) -> dict[str, int]:
    """Row count of every table except the ones whose name starts with a given prefix."""
    with opened.read() as conn:
        names = [
            r[0]
            for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
            if not r[0].startswith("sqlite_") and not r[0].startswith(except_prefixes)
        ]
        return {n: conn.execute(f'SELECT count(*) FROM "{n}"').fetchone()[0] for n in names}


def data_dir(tmp_path: Path) -> Path:
    return tmp_path / "data"
