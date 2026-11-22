"""Seeding for the automatic-task tests: a store whose collector covers the whole timeline, and
helpers that write worker and bot-turn rows the way the collector does. Test-time only."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from backend.specter_arena.store import (
    BindingSeen,
    CoverageMark,
    ObservationIn,
    Store,
    heartbeat,
    open_store,
    start_run,
)
from backend.specter_arena.store.dmkey import build_dm_key

from .work_fakes import RUN, T0, dm_key_of, installation, observe, query, send

MIN = 60_000


def covered_store(root: Path, *, bots: int = 2, covered: bool = True) -> tuple[Store, list[str]]:
    """A store with `bots` bindings and a run covered from T0 - 1, so a clean attempt can be
    credited. `covered=False` leaves the feed without any coverage."""
    store = open_store(root / "data")
    start_run(store, run_id=RUN, now_ms=T0 - 1)
    send(store, *(BindingSeen(dm_key_of(i), T0) for i in range(bots)))
    if covered:
        send(store, CoverageMark("open-covered", T0 - 1))
    ids = [
        str(row[0])
        for row in query(store, "SELECT binding_id FROM bot_binding ORDER BY binding_seq")
    ]
    return store, ids


def beat(store: Store, ms: int) -> None:
    """A collector heartbeat at `ms`, so the covered interval stays fresh up to it."""
    heartbeat(store, run_id=RUN, now_ms=ms)


def worker_slot(number: int) -> str:
    return f"chat-{number}-{1_794_779_966 + number}"


def worker_row(
    store: Store, bot: int, number: int, ms: int, *, running: bool, **facts: Any
) -> None:
    key = build_dm_key(dm_key_of(bot))
    base: dict[str, Any] = {"createdBy": key, "createdMs": 7 + number, **facts}
    send(store, observe(store, key, ms, slot=worker_slot(number), running=running, **base))


def run_worker(
    store: Store, bot: int, number: int, start_ms: int, end_ms: int, **end_facts: Any
) -> None:
    """A worker that starts at `start_ms` and ends (row idle) at `end_ms`."""
    beat(store, start_ms)
    worker_row(store, bot, number, start_ms, running=True)
    beat(store, end_ms)
    worker_row(store, bot, number, end_ms, running=False, **end_facts)


def bot_turn_rows(
    store: Store,
    bot: int,
    turn: int,
    start_ms: int,
    end_ms: int | None,
    end: str = "row-idle",
    **end_facts: Any,
) -> None:
    """A bot turn from `start_ms`; closed at `end_ms` by an idle row or a `chat_done` event."""
    key = build_dm_key(dm_key_of(bot))
    gen = f"cd{turn:02x}"
    beat(store, start_ms)
    send(store, observe(store, key, start_ms, turn=turn, turnGen=gen, lastActivityMs=start_ms))
    if end_ms is None:
        return
    beat(store, end_ms)
    if end == "chat-done":
        send(
            store,
            ObservationIn(
                installation_id=installation(store),
                dm_key=key,
                slot_key=key,
                kind="event",
                event_type="chat_done",
                received_at_ms=end_ms,
                payload={"continuing": False},
                turn=turn,
                turn_gen=gen,
                dedup_key=f"chat_done:{gen}:{turn}",
            ),
        )
        return
    facts = {"turn": turn, "turnGen": gen, "lastActivityMs": end_ms, "running": False, **end_facts}
    send(store, observe(store, key, end_ms, **facts))


def tasks(store: Store) -> list[tuple[Any, ...]]:
    return query(
        store,
        "SELECT t.task_id, t.kind, t.state, t.close_reason, t.running, t.started_ms, t.ended_ms,"
        " t.closed_ms, x.amount FROM task t LEFT JOIN task_xp_entry x ON x.task_id = t.task_id"
        " ORDER BY t.started_ms, t.task_id",
    )


def award_total(store: Store) -> int:
    return int(query(store, "SELECT COALESCE(sum(amount), 0) FROM task_xp_entry")[0][0])


__all__ = [
    "MIN",
    "RUN",
    "T0",
    "award_total",
    "beat",
    "bot_turn_rows",
    "covered_store",
    "run_worker",
    "tasks",
    "worker_row",
    "worker_slot",
]
