"""Real-thread tests: racing decisions, replays and creates give one outcome (FP-09-AC01,
FP-08-AC03). Threads are released together behind a barrier; results are collected as values."""

import threading
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from backend.specter_arena.store import (
    AttemptAlreadyLinked,
    IngestBatch,
    Store,
    StoreError,
    StoreUnavailable,
    VersionConflict,
    WorkDecisionResult,
    WorkRecord,
    create_work,
    decide_work,
    get_work,
    ingest,
    link_attempt,
    open_store,
    xp_summary,
)
from backend.specter_arena.store.dmkey import build_dm_key

from .work_fakes import (
    RUN,
    T0,
    Seeded,
    bot_turn_attempt,
    decide,
    dm_key_of,
    installation,
    invariants,
    ledger_hash,
    make_work,
    observe,
    open_seeded,
    query,
    run_threads,
    submit_and_accept,
    token,
)


@pytest.fixture
def ledger(tmp_path: Path) -> Iterator[tuple[Store, Seeded]]:
    opened, seeded = open_seeded(tmp_path, bots=4, per_bot=6)
    try:
        yield opened, seeded
    finally:
        opened.close()


def submitted_item(store: Store, seeded: Seeded, bots: int = 3) -> WorkRecord:
    record = make_work(store, [seeded.attempts[b][0] for b in range(bots)])
    return decide(store, record, "submit", 1, at=T0 + 2000)


def accept_call(
    store: Store, record: WorkRecord, label: str, at: int = T0 + 3000
) -> WorkDecisionResult:
    return decide_work(
        store,
        record.work_id,
        action="accept",
        expected_version=record.version,
        request_token=token("accept", int(label)),
        evidence_revision=record.evidence_revision,
        note=None,
        now_ms=at,
    )


def test_eight_concurrent_accepts_with_distinct_tokens_make_one_award(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    submitted = submitted_item(store, seeded)
    results = run_threads(*(lambda n=n: accept_call(store, submitted, str(n)) for n in range(8)))
    winners = [r for r in results if isinstance(r, WorkDecisionResult)]
    losers = [r for r in results if isinstance(r, VersionConflict)]
    assert (len(winners), len(losers)) == (1, 7), results
    assert winners[0].replayed is False
    assert query(store, "SELECT count(*) FROM xp_entry") == [(3,)]
    assert query(store, "SELECT sum(amount) FROM xp_entry") == [(100,)]
    assert query(store, "SELECT count(*) FROM work_decision WHERE action = 'accept'") == [(1,)]
    invariants(store, "concurrent accepts")


def test_eight_concurrent_replays_of_one_token_make_one_write(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    submitted = submitted_item(store, seeded)
    results = run_threads(*(lambda: accept_call(store, submitted, "1") for _ in range(8)))
    assert all(isinstance(r, WorkDecisionResult) for r in results), results
    assert sorted(r.replayed for r in results) == [False] + [True] * 7
    assert len({r.record.version for r in results}) == 1
    assert query(store, "SELECT count(*) FROM work_decision WHERE action = 'accept'") == [(1,)]
    assert query(store, "SELECT count(*) FROM xp_entry") == [(3,)]
    invariants(store, "concurrent replays")


def test_concurrent_creates_with_one_token_make_one_item(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    attempt = seeded.attempts[0][0]

    def create() -> Any:
        return create_work(
            store,
            request_token=token("create", 1),
            title="Same objective",
            acceptance_condition="Same condition",
            rewardable=True,
            parent_id=None,
            attempt_ids=[attempt],
            milestones=["one"],
            now_ms=T0 + 1000,
        )

    results = run_threads(*(create for _ in range(6)))
    assert all(not isinstance(r, Exception) for r in results), results
    assert sorted(r.created for r in results) == [False] * 5 + [True]
    assert len({r.record.work_id for r in results}) == 1
    assert query(store, "SELECT count(*) FROM work_item") == [(1,)]
    assert query(store, "SELECT count(*) FROM work_attempt") == [(1,)]


def test_one_attempt_linked_to_two_items_at_once_has_one_owner(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    shared = seeded.attempts[0][0]

    def create(n: int) -> Any:
        return create_work(
            store,
            request_token=token("create", n),
            title=f"Objective {n}",
            acceptance_condition="Condition",
            rewardable=True,
            parent_id=None,
            attempt_ids=[shared],
            milestones=[],
            now_ms=T0 + 1000,
        )

    results = run_threads(lambda: create(1), lambda: create(2), lambda: create(3))
    made = [r for r in results if not isinstance(r, Exception)]
    refused = [r for r in results if isinstance(r, AttemptAlreadyLinked)]
    assert (len(made), len(refused)) == (1, 2), results
    assert query(store, "SELECT count(*) FROM work_attempt WHERE attempt_id = ?", shared) == [(1,)]
    assert query(store, "SELECT count(*) FROM work_item") == [(1,)]


def test_concurrent_reopen_reopen_and_link_leave_a_consistent_ledger(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[0][0], seeded.attempts[1][0]])
    accepted = submit_and_accept(store, record, 1, at=T0 + 2000)

    def reopen(n: int) -> Any:
        return decide_work(
            store,
            accepted.work_id,
            action="reopen",
            expected_version=accepted.version,
            request_token=token("reopen", n),
            evidence_revision=None,
            note=None,
            now_ms=T0 + 3000,
        )

    def link() -> Any:
        return link_attempt(
            store,
            accepted.work_id,
            expected_version=accepted.version,
            attempt_id=seeded.attempts[0][1],
            now_ms=T0 + 3000,
        )

    results = run_threads(lambda: reopen(1), lambda: reopen(2), link)
    outcomes = [r for r in results if not isinstance(r, Exception)]
    assert len(outcomes) == 1, results
    assert all(
        isinstance(r, StoreError) and not isinstance(r, StoreUnavailable)
        for r in results
        if isinstance(r, Exception)
    ), results
    invariants(store, "reopen race")
    final = get_work(store, accepted.work_id)
    assert final.state in ("accepted", "reopened")
    assert sum(c.xp_net for c in final.contributors) == (100 if final.state == "accepted" else 0)


def test_a_reader_never_sees_an_accepted_item_without_its_xp(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    submitted = submitted_item(store, seeded)
    stop = threading.Event()
    seen: list[tuple[str, int]] = []
    failures: list[BaseException] = []

    def read_loop() -> None:
        try:
            while not stop.is_set():
                with store.read() as conn:
                    state = conn.execute("SELECT state FROM work_item").fetchone()[0]
                    xp = conn.execute("SELECT COALESCE(sum(amount), 0) FROM xp_entry").fetchone()[0]
                seen.append((str(state), int(xp)))
                record = get_work(store, submitted.work_id)
                assert (record.state == "accepted") == (
                    sum(c.xp_net for c in record.contributors) == 100
                )
                xp_summary(store, seeded.bindings[0])
        except BaseException as error:  # noqa: BLE001 - reported after the join
            failures.append(error)

    reader = threading.Thread(target=read_loop)
    reader.start()
    try:
        for _ in range(3):
            if seen:
                break
            stop.wait(0.01)
        accept_call(store, submitted, "1")
        stop.wait(0.05)
    finally:
        stop.set()
        reader.join()
    assert failures == []
    assert seen, "the reader never ran"
    assert all((state == "accepted") == (xp == 100) for state, xp in seen)


def test_four_handles_accepting_at_once_make_one_award(tmp_path: Path) -> None:
    first, seeded = open_seeded(tmp_path, bots=3, per_bot=2)
    handles = [first]
    try:
        submitted = submitted_item(first, seeded)
        handles.extend(open_store(tmp_path / "data") for _ in range(3))
        results = run_threads(
            *(lambda h=h, n=n: accept_call(h, submitted, str(n)) for n, h in enumerate(handles))
        )
        winners = [r for r in results if isinstance(r, WorkDecisionResult)]
        assert len(winners) == 1, results
        assert all(isinstance(r, VersionConflict) for r in results if r not in winners), results
        assert query(first, "SELECT count(*) FROM xp_entry") == [(3,)]
        invariants(first, "four handles")
    finally:
        for handle in handles:
            handle.close()


def test_a_replayed_collector_batch_changes_neither_the_revision_nor_the_xp(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    ended = bot_turn_attempt(store, 0, end="chat-done", turn=4, ms=T0 + 700)
    worker = seeded.attempts[1][0]
    record = make_work(store, [ended, worker])
    accepted = submit_and_accept(store, record, 1, at=T0 + 2000)
    before = ledger_hash(store)
    bot_key = build_dm_key(dm_key_of(0))
    worker_key = build_dm_key(dm_key_of(1))
    number = 100
    facts = {"createdBy": worker_key, "createdMs": 7 + number}
    slot = f"chat-{number}-{1_794_779_966 + number}"
    replayed = [
        observe(store, bot_key, T0 + 700, turn=4, turnGen="ab04", lastActivityMs=T0 + 700),
        *(
            observe(store, worker_key, T0 + 1015 + extra, slot=slot, running=False, **facts)
            for extra in (0, 0, 40)
        ),
    ]
    for item in replayed:
        result = ingest(store, IngestBatch(RUN, installation(store), (item,)))
        assert result.counts["observation"].persisted == 0
        assert result.counts["observation"].deduplicated == 1
    again = get_work(store, accepted.work_id)
    assert again.evidence_revision == accepted.evidence_revision
    assert (again.state, again.version) == ("accepted", accepted.version)
    assert ledger_hash(store) == before
    assert query(store, "SELECT sum(amount) FROM xp_entry") == [(100,)]
