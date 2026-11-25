from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from backend.specter_arena.store import (
    LEVEL_FLOORS,
    InvalidCursor,
    Store,
    StoreUsageError,
    UnknownBinding,
    WorkRecord,
    encode_cursor,
    get_work,
    level_for,
    xp_history,
    xp_summaries,
    xp_summary,
)
from backend.specter_arena.store import work as work_module
from backend.specter_arena.store import xp as xp_module

from .work_fakes import (
    T0,
    Seeded,
    decide,
    make_work,
    open_seeded,
    query,
    submit_and_accept,
    worker_attempt,
)


@pytest.fixture
def ledger(tmp_path: Path) -> Iterator[tuple[Store, Seeded]]:
    opened, seeded = open_seeded(tmp_path, bots=4, per_bot=8)
    try:
        yield opened, seeded
    finally:
        opened.close()


def entries(store: Store, work_id: str | None = None) -> list[tuple[Any, ...]]:
    sql = (
        "SELECT binding_id, seq, kind, amount, policy_version, decision_id, created_ms FROM"
        " xp_entry"
    )
    if work_id is None:
        return query(store, sql + " ORDER BY created_ms, binding_id, seq")
    return query(store, sql + " WHERE work_id = ? ORDER BY created_ms, binding_id, seq", work_id)


def three_bot_item(store: Store, seeded: Seeded, n: int = 1, rewardable: bool = True) -> WorkRecord:
    chosen = [seeded.attempts[b][n] for b in range(3)]
    return make_work(store, chosen, n, rewardable=rewardable)


def test_accept_awards_the_split_to_the_contributors(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    record = three_bot_item(store, seeded)
    accepted = submit_and_accept(store, record, 1, at=T0 + 2000)
    ordered = sorted(seeded.bindings[:3])
    rows = entries(store, record.work_id)
    assert [(r[0], r[1], r[2], r[3]) for r in rows] == [
        (ordered[0], 1, "award", 34),
        (ordered[1], 1, "award", 33),
        (ordered[2], 1, "award", 33),
    ]
    accept_decision = accepted.decisions[-1]
    assert {r[5] for r in rows} == {accept_decision.decision_id}
    assert {r[4] for r in rows} == {"xp-policy-1"}
    assert {r[6] for r in rows} == {accept_decision.at_ms}
    assert {c.binding_id: c.xp_net for c in accepted.contributors} == {
        ordered[0]: 34,
        ordered[1]: 33,
        ordered[2]: 33,
    }


def test_a_non_rewardable_item_earns_nothing(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    record = three_bot_item(store, seeded, rewardable=False)
    accepted = submit_and_accept(store, record, 1, at=T0 + 2000)
    assert accepted.state == "accepted"
    assert (accepted.bounty_xp, entries(store), xp_summaries(store)) == (0, [], ())
    reopened = decide(store, accepted, "reopen", 2, at=T0 + 3000)
    again = submit_and_accept(store, reopened, 3, at=T0 + 4000)
    assert (again.state, entries(store)) == ("accepted", [])


def test_a_container_earns_nothing_and_each_child_earns_once(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    parent = make_work(store, [], 1)
    first = make_work(store, [seeded.attempts[0][0]], 2, parent_id=parent.work_id)
    second = make_work(store, [seeded.attempts[1][0]], 3, parent_id=parent.work_id)
    submit_and_accept(store, first, 1, at=T0 + 2000)
    submit_and_accept(store, second, 2, at=T0 + 3000)
    done = submit_and_accept(store, get_work(store, parent.work_id), 3, at=T0 + 4000)
    assert done.state == "accepted"
    assert entries(store, parent.work_id) == []
    assert sum(r[3] for r in entries(store)) == 200
    assert [r[2] for r in entries(store)] == ["award", "award"]
    assert done.contributors == ()


def test_submit_reject_block_unblock_cancel_write_no_xp(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[0][0]], 1)
    for action in ("submit", "reject", "reopen", "block", "unblock", "submit"):
        record = decide(store, record, action, ord(action[0]) + len(action), at=T0 + 2000)
        assert entries(store) == [], action
    cancelled = decide(store, record, "cancel", 77, at=T0 + 3000)
    assert (cancelled.state, entries(store)) == ("cancelled", [])


def test_reopen_writes_exact_corrections(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    record = three_bot_item(store, seeded)
    accepted = submit_and_accept(store, record, 1, at=T0 + 2000)
    awards = {r[0]: r[3] for r in entries(store)}
    reopened = decide(store, accepted, "reopen", 3, at=T0 + 3000)
    rows = entries(store, record.work_id)
    corrections = [r for r in rows if r[2] == "correction"]
    assert {r[0]: r[3] for r in corrections} == {b: -a for b, a in awards.items()}
    assert {r[1] for r in corrections} == {2}
    assert {r[5] for r in corrections} == {reopened.decisions[-1].decision_id}
    assert [c.xp_net for c in reopened.contributors] == [0, 0, 0]


def test_reaccept_writes_exact_reinstatements_not_a_new_award(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    record = three_bot_item(store, seeded)
    accepted = submit_and_accept(store, record, 1, at=T0 + 2000)
    original = {r[0]: r[3] for r in entries(store)}
    reopened = decide(store, accepted, "reopen", 3, at=T0 + 3000)
    again = submit_and_accept(store, reopened, 4, at=T0 + 4000)
    rows = entries(store, record.work_id)
    assert [r[2] for r in rows].count("award") == 3
    reinstated = [r for r in rows if r[2] == "reinstatement"]
    assert {r[0]: r[3] for r in reinstated} == original
    assert {r[1] for r in reinstated} == {3}
    assert {c.binding_id: c.xp_net for c in again.contributors} == original


def test_five_reopen_reaccept_cycles_leave_net_100_and_three_awards(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    record = submit_and_accept(store, three_bot_item(store, seeded), 1, at=T0 + 2000)
    for cycle in range(5):
        base = T0 + 3000 + cycle * 10
        record = decide(store, record, "reopen", 10 + cycle, at=base)
        record = decide(store, record, "submit", 10 + cycle, at=base + 1)
        record = decide(store, record, "accept", 10 + cycle, at=base + 2)
    rows = entries(store, record.work_id)
    assert len(rows) == 3 + 5 * 6
    assert [r[2] for r in rows].count("award") == 3
    assert sum(r[3] for r in rows) == 100
    assert xp_summaries(store)[0].accepted_work_count == 1
    assert sum(s.total_xp for s in xp_summaries(store)) == 100


def test_reopen_from_rejected_writes_nothing(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[0][0]])
    submitted = decide(store, record, "submit", 1, at=T0 + 2000)
    rejected = decide(store, submitted, "reject", 2, at=T0 + 2100)
    reopened = decide(store, rejected, "reopen", 3, at=T0 + 2200)
    assert (reopened.state, entries(store)) == ("reopened", [])
    accepted = submit_and_accept(store, reopened, 4, at=T0 + 3000)
    assert [r[2] for r in entries(store)] == ["award"]
    assert accepted.contributors[0].xp_net == 100


def test_a_later_policy_cannot_make_the_same_work_pay_again(
    ledger: tuple[Store, Seeded], monkeypatch: pytest.MonkeyPatch
) -> None:
    store, seeded = ledger
    old = submit_and_accept(store, make_work(store, [seeded.attempts[0][0]], 1), 1, at=T0 + 2000)
    for module in (work_module, xp_module):
        monkeypatch.setattr(module, "POLICY_VERSION", "xp-policy-2")
    monkeypatch.setattr(work_module, "BOUNTY_XP", 50)
    reopened = decide(store, old, "reopen", 5, at=T0 + 3000)
    again = submit_and_accept(store, reopened, 6, at=T0 + 4000)
    assert (again.bounty_xp, again.policy_version) == (100, "xp-policy-1")
    assert [(r[2], r[3], r[4]) for r in entries(store, old.work_id)] == [
        ("award", 100, "xp-policy-1"),
        ("correction", -100, "xp-policy-2"),
        ("reinstatement", 100, "xp-policy-2"),
    ]
    fresh = make_work(store, [seeded.attempts[1][0]], 2, at=T0 + 5000)
    assert (fresh.bounty_xp, fresh.policy_version) == (50, "xp-policy-2")
    submit_and_accept(store, fresh, 7, at=T0 + 6000)
    assert [(r[2], r[3], r[4]) for r in entries(store, fresh.work_id)] == [
        ("award", 50, "xp-policy-2")
    ]
    assert sum(s.total_xp for s in xp_summaries(store)) == 150


def test_summary_derives_level_and_accepted_count_at_each_floor(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    binding = seeded.bindings[0]
    seen_levels = {xp_summary(store, binding).level}
    for n in range(1, 34):
        attempt = worker_attempt(store, 0, 5000 + n)
        record = make_work(store, [attempt], 100 + n, at=T0 + 1000 * n)
        submit_and_accept(store, record, n, at=T0 + 1000 * n + 100)
        summary = xp_summary(store, binding)
        level, floor, following = level_for(100 * n)
        assert (summary.total_xp, summary.accepted_work_count) == (100 * n, n)
        assert (summary.level, summary.level_floor_xp, summary.next_level_xp) == (
            level,
            floor,
            following,
        )
        assert (summary.policy_version, summary.level_table_version) == (
            "xp-policy-1",
            "levels-1",
        )
        seen_levels.add(summary.level)
    assert seen_levels == set(range(1, len(LEVEL_FLOORS) + 1))
    assert (summary.level, summary.next_level_xp) == (10, None)


def test_a_binding_without_entries_is_level_one_with_zero(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    summary = xp_summary(store, seeded.bindings[2])
    assert (summary.total_xp, summary.level, summary.level_floor_xp) == (0, 1, 0)
    assert (summary.next_level_xp, summary.accepted_work_count) == (100, 0)


def test_accepted_count_follows_net_xp_through_a_reopen(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    binding = seeded.bindings[0]
    accepted = submit_and_accept(store, make_work(store, [seeded.attempts[0][0]]), 1, at=T0 + 2000)
    assert xp_summary(store, binding).accepted_work_count == 1
    reopened = decide(store, accepted, "reopen", 3, at=T0 + 3000)
    assert (
        xp_summary(store, binding).total_xp,
        xp_summary(store, binding).accepted_work_count,
    ) == (
        0,
        0,
    )
    submit_and_accept(store, reopened, 4, at=T0 + 4000)
    assert xp_summary(store, binding).accepted_work_count == 1


def test_summaries_list_only_bindings_with_entries_in_id_order(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    assert xp_summaries(store) == ()
    for number, bot in enumerate((3, 1, 2), start=1):
        record = make_work(store, [seeded.attempts[bot][0]], number)
        submit_and_accept(store, record, number, at=T0 + 2000 * number)
    listed = [s.binding_id for s in xp_summaries(store)]
    assert listed == sorted(seeded.bindings[b] for b in (1, 2, 3))
    assert seeded.bindings[0] not in listed
    assert all(s.total_xp == 100 for s in xp_summaries(store))


def test_summary_of_an_unknown_binding_raises(ledger: tuple[Store, Seeded]) -> None:
    store, _ = ledger
    with pytest.raises(UnknownBinding):
        xp_summary(store, "bnd_" + "0" * 24)
    with pytest.raises(UnknownBinding):
        xp_history(store, "bnd_" + "0" * 24, cursor=None, limit=None)
    for bad in ("bnd_x", "", 5):
        with pytest.raises(StoreUsageError):
            xp_summary(store, bad)  # type: ignore[arg-type]


def accept_for_bot_zero(store: Store, seeded: Seeded, count: int) -> list[WorkRecord]:
    records = []
    for n in range(1, count + 1):
        record = make_work(
            store,
            [seeded.attempts[0][n]],
            n,
            at=T0 + 1000 * n,
            title=f"Work number {n}",
        )
        records.append(submit_and_accept(store, record, n, at=T0 + 1000 * n + 100))
    return records


def test_history_is_newest_first_pages_and_carries_policy_decision_and_title(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    records = accept_for_bot_zero(store, seeded, 3)
    reopened = decide(store, records[0], "reopen", 9, at=T0 + 9000)
    binding = seeded.bindings[0]
    first = xp_history(store, binding, cursor=None, limit=2)
    assert len(first.page.items) == 2 and first.page.next_cursor is not None
    second = xp_history(store, binding, cursor=first.page.next_cursor, limit=2)
    assert second.page.next_cursor is None
    listed = [*first.page.items, *second.page.items]
    assert [e.kind for e in listed] == ["correction", "award", "award", "award"]
    assert [e.work_title for e in listed] == [
        "Work number 1",
        "Work number 3",
        "Work number 2",
        "Work number 1",
    ]
    assert listed[0].decision_id == reopened.decisions[-1].decision_id
    assert listed[0].amount == -100
    assert {e.policy_version for e in listed} == {"xp-policy-1"}
    order = [(e.created_ms, e.entry_id) for e in listed]
    assert order == sorted(order, reverse=True)
    assert first.summary == second.summary == xp_summary(store, binding)


def test_history_amounts_sum_to_the_summary_total(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    records = accept_for_bot_zero(store, seeded, 4)
    reopened = decide(store, records[1], "reopen", 9, at=T0 + 9000)
    submit_and_accept(store, reopened, 10, at=T0 + 9100)
    decide(store, records[2], "reopen", 11, at=T0 + 9200)
    history = xp_history(store, seeded.bindings[0], cursor=None, limit=50)
    assert sum(e.amount for e in history.page.items) == history.summary.total_xp == 300
    level, floor, following = level_for(history.summary.total_xp)
    assert (history.summary.level, history.summary.level_floor_xp) == (level, floor)
    assert history.summary.next_level_xp == following


def test_history_of_a_bot_with_no_entries_is_empty(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    history = xp_history(store, seeded.bindings[3], cursor=None, limit=None)
    assert history.page.items == () and history.page.next_cursor is None
    assert history.summary.total_xp == 0


def test_history_cursor_and_limit_validation(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    accept_for_bot_zero(store, seeded, 3)
    binding = seeded.bindings[0]
    for bad in (
        "not-a-cursor",
        encode_cursor([5]),
        encode_cursor([5, "xpe_nope"]),
        encode_cursor([-1, "xpe_" + "a" * 24]),
        encode_cursor(["5", "xpe_" + "a" * 24]),
    ):
        with pytest.raises(InvalidCursor):
            xp_history(store, binding, cursor=bad, limit=None)
    assert len(xp_history(store, binding, cursor=None, limit=0).page.items) == 1
    assert len(xp_history(store, binding, cursor=None, limit=500).page.items) == 3
    good = encode_cursor([T0 + 1_000_000, "xpe_" + "f" * 24])
    assert len(xp_history(store, binding, cursor=good, limit=None).page.items) == 3
    assert (
        xp_history(
            store, binding, cursor=encode_cursor([0, "xpe_" + "0" * 24]), limit=None
        ).page.items
        == ()
    )
    with pytest.raises(StoreUsageError):
        xp_history(store, "bnd_x", cursor=None, limit=None)


def test_direct_ledger_writes_skip_zero_shares_and_refuse_nothing_else(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[0][0], seeded.attempts[1][0]])
    submitted = decide(store, record, "submit", 1, at=T0 + 2000)
    with store.write() as conn:
        assert xp_module.has_awards(conn, record.work_id) is False
        assert xp_module.last_entries(conn, record.work_id) == {}
        written = xp_module.write_awards(
            conn,
            work_id=record.work_id,
            decision_id="dec_" + "0" * 24,
            shares={seeded.bindings[0]: 0},
            at_ms=T0,
        )
        assert written == 0
    assert submitted.state == "awaiting-review"


def test_reinstating_skips_a_contributor_whose_last_entry_is_not_a_correction(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    accepted = submit_and_accept(store, make_work(store, [seeded.attempts[0][0]]), 1, at=T0 + 2000)
    with store.write() as conn:
        written = xp_module.write_reinstatements(
            conn, work_id=accepted.work_id, decision_id="dec_" + "0" * 24, at_ms=T0 + 3000
        )
    assert written == 0
    assert [r[2] for r in entries(store, accepted.work_id)] == ["award"]
