"""Shared seeding for the work and XP store tests: bots, ended attempts and racing threads.

Attempts enter the store the way they do in production, through `ingest` of slot-row
observations, so `attempt` holds real projection rows. Test-time only."""

from __future__ import annotations

import hashlib
import threading
from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from backend.specter_arena.store import (
    BindingSeen,
    DmKey,
    IngestBatch,
    ObservationIn,
    Store,
    WorkRecord,
    create_work,
    decide_work,
    ingest,
    open_store,
    row_fact_digest,
    split_bounty,
    start_run,
)
from backend.specter_arena.store.dmkey import build_dm_key

T0 = 1_800_000_000_000
RUN = "run-00000001"
LEDGER_TABLES = ("work_item", "work_attempt", "work_milestone", "work_decision", "xp_entry")


@dataclass(frozen=True, slots=True)
class Seeded:
    """Bindings in creation order, and for each the ids of its ended worker attempts."""

    bindings: tuple[str, ...]
    attempts: tuple[tuple[str, ...], ...]

    def flat(self) -> list[str]:
        return [a for per_bot in self.attempts for a in per_bot]


def installation(store: Store) -> str:
    with store.read() as conn:
        return str(conn.execute("SELECT store_id FROM store_meta").fetchone()[0])


def dm_key_of(index: int) -> DmKey:
    return DmKey(f"bot{index}-0123456789ab", f"memory-bot{index}")


def observe(
    store: Store, key: str, ms: int, slot: str | None = None, **facts: Any
) -> ObservationIn:
    payload: dict[str, Any] = {"running": True, **facts}
    return ObservationIn(
        installation_id=installation(store),
        dm_key=key,
        slot_key=slot or key,
        kind="row-change",
        event_type="slot-row",
        received_at_ms=ms,
        payload=payload,
        turn=payload.get("turn"),
        turn_gen=payload.get("turnGen"),
        fact_digest=row_fact_digest(payload),
    )


def send(store: Store, *items: Any) -> None:
    ingest(store, IngestBatch(RUN, installation(store), tuple(items)))


def worker_attempt(
    store: Store, bot_index: int, number: int, *, ended: bool = True, ms: int | None = None
) -> str:
    """One worker attempt for the bot, ended unless `ended` is False; returns its id."""
    key = build_dm_key(dm_key_of(bot_index))
    slot = f"chat-{number}-{1_794_779_966 + number}"
    at = T0 + 10 + number * 10 if ms is None else ms
    facts: dict[str, Any] = {"createdBy": key, "createdMs": 7 + number}
    send(store, observe(store, key, at, slot=slot, **facts))
    if ended:
        send(store, observe(store, key, at + 5, slot=slot, running=False, **facts))
    with store.read() as conn:
        found = conn.execute(
            "SELECT a.attempt_id FROM attempt a JOIN bot_binding b ON b.binding_id = a.binding_id"
            " WHERE b.dm_key = ? AND a.slot_key = ?",
            (key, slot),
        ).fetchone()
    return str(found[0])


def bot_turn_attempt(
    store: Store, bot_index: int, *, end: str | None = "row-idle", turn: int = 1, ms: int = T0 + 500
) -> str:
    """One bot-turn attempt. `end` is "row-idle", "chat-done" or None (still running)."""
    key = build_dm_key(dm_key_of(bot_index))
    gen = f"ab{turn:02x}"
    send(store, observe(store, key, ms, turn=turn, turnGen=gen, lastActivityMs=ms))
    if end == "row-idle":
        send(
            store,
            observe(
                store, key, ms + 5, turn=turn, turnGen=gen, lastActivityMs=ms + 5, running=False
            ),
        )
    elif end == "chat-done":
        send(
            store,
            ObservationIn(
                installation_id=installation(store),
                dm_key=key,
                slot_key=key,
                kind="event",
                event_type="chat_done",
                received_at_ms=ms + 5,
                payload={"continuing": False},
                turn=turn,
                turn_gen=gen,
                dedup_key=f"chat_done:{gen}:{turn}",
            ),
        )
    with store.read() as conn:
        found = conn.execute(
            "SELECT a.attempt_id FROM attempt a JOIN bot_binding b ON b.binding_id = a.binding_id"
            " WHERE b.dm_key = ? AND a.kind = 'bot-turn' ORDER BY a.started_seq DESC LIMIT 1",
            (key,),
        ).fetchone()
    return str(found[0])


def open_seeded(root: Path, *, bots: int = 4, per_bot: int = 8) -> tuple[Store, Seeded]:
    """A store with `bots` bindings and `per_bot` ended worker attempts for each of them."""
    store = open_store(root / "data")
    start_run(store, run_id=RUN, now_ms=T0 - 1)
    send(store, *(BindingSeen(dm_key_of(i), T0) for i in range(bots)))
    with store.read() as conn:
        bindings = tuple(
            str(
                conn.execute(
                    "SELECT binding_id FROM bot_binding WHERE dm_key = ?",
                    (build_dm_key(dm_key_of(i)),),
                ).fetchone()[0]
            )
            for i in range(bots)
        )
    attempts = tuple(
        tuple(worker_attempt(store, b, b * 100 + n) for n in range(per_bot)) for b in range(bots)
    )
    return store, Seeded(bindings, attempts)


def token(label: str, n: int = 0) -> str:
    """A 8..64 character request token from letters, digits and hyphens."""
    return f"{label}-{n:08d}"


def make_work(
    store: Store,
    attempts: Sequence[str],
    n: int = 1,
    *,
    at: int = T0 + 1000,
    rewardable: bool = True,
    parent_id: str | None = None,
    milestones: Sequence[str] = (),
    title: str = "Write the release notes",
    condition: str = "The owner read them and agrees.",
) -> WorkRecord:
    return create_work(
        store,
        request_token=token("create", n),
        title=title,
        acceptance_condition=condition,
        rewardable=rewardable,
        parent_id=parent_id,
        attempt_ids=list(attempts),
        milestones=list(milestones),
        now_ms=at,
    ).record


def decide(
    store: Store,
    record: WorkRecord,
    action: str,
    n: int,
    *,
    at: int,
    note: str | None = None,
    revision: str | None = None,
) -> WorkRecord:
    """Apply `action` to the record's current version, echoing its revision for accept/reject."""
    needs_revision = action in ("accept", "reject")
    return decide_work(
        store,
        record.work_id,
        action=action,
        expected_version=record.version,
        request_token=token(action, n),
        evidence_revision=(revision or record.evidence_revision) if needs_revision else None,
        note=note,
        now_ms=at,
    ).record


def submit_and_accept(store: Store, record: WorkRecord, n: int, *, at: int) -> WorkRecord:
    """Move an open (or reopened) record to accepted with two decisions."""
    submitted = decide(store, record, "submit", n, at=at)
    return decide(store, submitted, "accept", n, at=at + 1)


def query(store: Store, sql: str, *params: object) -> list[tuple[Any, ...]]:
    with store.read() as conn:
        return [tuple(r) for r in conn.execute(sql, params)]


def table_hash(store: Store, table: str) -> str:
    digest = hashlib.sha256()
    for line in sorted(repr(row) for row in query(store, f"SELECT * FROM {table}")):
        digest.update(line.encode("utf-8"))
    return digest.hexdigest()


def ledger_hash(store: Store) -> dict[str, str]:
    """A digest of each ledger table and of `attempt`; equal before and after means unchanged."""
    return {name: table_hash(store, name) for name in (*LEDGER_TABLES, "attempt")}


def run_threads(*targets: Callable[[], Any]) -> list[Any]:
    """Run every target at once behind a barrier; an exception comes back as the result value."""
    results: list[Any] = [None] * len(targets)
    barrier = threading.Barrier(len(targets))

    def wrap(index: int, target: Callable[[], Any]) -> None:
        barrier.wait()
        try:
            results[index] = target()
        except Exception as error:  # noqa: BLE001 - the test inspects the type
            results[index] = error

    threads = [threading.Thread(target=wrap, args=(i, t)) for i, t in enumerate(targets)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    return results


def invariants(store: Store, note: str) -> None:
    items = query(store, "SELECT work_id, state, rewardable, bounty_xp FROM work_item")
    credit = 0
    for work_id, state, rewardable, bounty in items:
        entries = query(
            store,
            "SELECT binding_id, seq, kind, amount FROM xp_entry WHERE work_id = ?"
            " ORDER BY binding_id, seq",
            work_id,
        )
        children = query(store, "SELECT count(*) FROM work_item WHERE parent_id = ?", work_id)[0][0]
        net_by: Counter[str] = Counter()
        awards: dict[str, int] = {}
        for binding, _seq, kind, amount in entries:
            net_by[binding] += amount
            if kind == "award":
                awards[binding] = amount
        net = sum(net_by.values())
        assert net <= bounty, (note, "over the bounty", work_id)
        assert all(v in (0, awards[b]) for b, v in net_by.items()), (note, "net", work_id)
        if children:
            assert not entries, (note, "container has xp", work_id)
        if entries:
            assert sum(awards.values()) == bounty, (note, "awards not conserved", work_id)
            people = [
                str(r[0])
                for r in query(
                    store,
                    "SELECT DISTINCT binding_id FROM work_attempt WHERE work_id = ? ORDER BY 1",
                    work_id,
                )
            ]
            expected = {b: v for b, v in split_bounty(bounty, people).items() if v > 0}
            assert awards == expected, (note, "allocation is not split_bounty", work_id)
        leaf_accepted = state == "accepted" and rewardable and not children
        if leaf_accepted:
            assert net == bounty, (note, "accepted leaf not at its bounty", work_id, net)
            credit += bounty
        else:
            assert net == 0, (note, "net xp on an item that is not an accepted leaf", work_id)
        last = query(
            store,
            "SELECT to_state FROM work_decision WHERE work_id = ? ORDER BY seq DESC LIMIT 1",
            work_id,
        )
        assert (last[0][0] if last else "open") == state, (note, "state != latest decision")
        contributors = {
            str(r[0])
            for r in query(store, "SELECT binding_id FROM work_attempt WHERE work_id = ?", work_id)
        }
        assert {str(e[0]) for e in entries} <= contributors, (note, "xp for a non contributor")
    twice = query(
        store,
        "SELECT count(*) FROM (SELECT attempt_id FROM work_attempt GROUP BY attempt_id"
        " HAVING count(*) > 1)",
    )
    assert twice[0][0] == 0, (note, "an attempt sits on two items")
    total = query(store, "SELECT COALESCE(sum(amount), 0) FROM xp_entry")[0][0]
    assert total == credit, (note, "total credit != accepted leaf bounties", total, credit)
